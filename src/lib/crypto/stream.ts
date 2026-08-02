/**
 * Chunked (streaming) file encryption. See format.ts for the byte layout.
 *
 * The core operates on ByteReader/ByteWriter so it is unit-testable in jest
 * with in-memory buffers; encryptFile/decryptFile wire it to expo-file-system
 * FileHandles. Media never round-trips through base64 and is never loaded
 * into JS memory as a whole — peak memory is ~1 chunk regardless of file size.
 */
import { File, FileMode } from 'expo-file-system';

import {
  buildHeader,
  chunkIv,
  DEFAULT_CHUNK_SIZE,
  FILE_SALT_LEN,
  FormatError,
  HEADER_LEN,
  NONCE_PREFIX_LEN,
  parseHeader,
} from './format';
import { deriveFileKey } from './keys';
import { concatBytes, gcmOpen, gcmSeal, GCM_TAG_LEN, IntegrityError, randomBytes, utf8Encode, zeroize } from './primitives';

export interface ByteReader {
  /** Remaining bytes until EOF. */
  remaining(): number;
  /** Reads exactly min(length, remaining()) bytes. */
  read(length: number): Uint8Array;
  close(): void;
}

export interface ByteWriter {
  write(bytes: Uint8Array): void;
  close(): void;
}

export interface StreamProgress {
  processedBytes: number;
  totalBytes: number;
}

interface StreamOptions {
  dek: Uint8Array;
  /** DB row id of the owning item; bound into the AAD of every chunk. */
  itemId: string;
  reader: ByteReader;
  writer: ByteWriter;
  chunkSize?: number;
  onProgress?: (progress: StreamProgress) => void;
}

/** Lets the UI thread breathe between chunks during long operations. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function encryptStream(options: StreamOptions): Promise<void> {
  const { dek, itemId, reader, writer, onProgress } = options;
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const fileSalt = randomBytes(FILE_SALT_LEN);
  const noncePrefix = randomBytes(NONCE_PREFIX_LEN);
  const header = buildHeader(fileSalt, noncePrefix, chunkSize);
  const aad = concatBytes(header.raw, utf8Encode(itemId));
  const fileKey = deriveFileKey(dek, fileSalt);

  const totalBytes = reader.remaining();
  let processedBytes = 0;
  let chunkIndex = 0;
  try {
    writer.write(header.raw);
    // Empty input still produces one (empty) final chunk so that emptiness
    // itself is authenticated.
    do {
      const plain = reader.read(chunkSize);
      const isLast = reader.remaining() === 0;
      writer.write(gcmSeal(fileKey, chunkIv(noncePrefix, chunkIndex, isLast), plain, aad));
      processedBytes += plain.length;
      chunkIndex += 1;
      onProgress?.({ processedBytes, totalBytes });
      if (reader.remaining() > 0) await yieldToEventLoop();
    } while (reader.remaining() > 0);
  } finally {
    zeroize(fileKey);
    reader.close();
    writer.close();
  }
}

export async function decryptStream(options: Omit<StreamOptions, 'chunkSize'>): Promise<void> {
  const { dek, itemId, reader, writer, onProgress } = options;
  try {
    if (reader.remaining() < HEADER_LEN) throw new FormatError('Dosya header için çok kısa');
    const header = parseHeader(reader.read(HEADER_LEN));
    const aad = concatBytes(header.raw, utf8Encode(itemId));
    const fileKey = deriveFileKey(dek, header.fileSalt);
    const sealedChunkLen = header.chunkSize + GCM_TAG_LEN;

    const totalBytes = reader.remaining();
    let processedBytes = 0;
    let chunkIndex = 0;
    try {
      do {
        const sealed = reader.read(sealedChunkLen);
        if (sealed.length < GCM_TAG_LEN) throw new IntegrityError('Dosya kırpılmış (eksik chunk)');
        const isLast = reader.remaining() === 0;
        const plain = gcmOpen(fileKey, chunkIv(header.noncePrefix, chunkIndex, isLast), sealed, aad);
        writer.write(plain);
        processedBytes += sealed.length;
        chunkIndex += 1;
        onProgress?.({ processedBytes, totalBytes });
        if (reader.remaining() > 0) await yieldToEventLoop();
      } while (reader.remaining() > 0);
    } finally {
      zeroize(fileKey);
    }
  } finally {
    reader.close();
    writer.close();
  }
}

// ── In-memory adapters (tests, small payloads like thumbnails/photos) ───────

export function bytesReader(data: Uint8Array): ByteReader {
  let offset = 0;
  return {
    remaining: () => data.length - offset,
    read(length: number) {
      const end = Math.min(offset + length, data.length);
      const slice = data.subarray(offset, end);
      offset = end;
      return slice;
    },
    close() {},
  };
}

export function bytesWriter(): ByteWriter & { toBytes(): Uint8Array } {
  const parts: Uint8Array[] = [];
  return {
    write(bytes: Uint8Array) {
      parts.push(bytes.slice());
    },
    close() {},
    toBytes: () => concatBytes(...parts),
  };
}

// ── expo-file-system adapters ───────────────────────────────────────────────

function fileReader(uri: string): ByteReader {
  const file = new File(uri);
  const handle = file.open(FileMode.ReadOnly);
  const size = handle.size ?? file.size;
  // Both are nullable. Treating an unknown size as 0 would produce a
  // header-plus-empty-chunk file that passes every check and holds nothing.
  if (size == null) {
    handle.close();
    throw new IntegrityError('Kaynak dosyanın boyutu okunamadı');
  }
  let offset = 0;
  return {
    remaining: () => size - offset,
    read(length: number) {
      const toRead = Math.min(length, size - offset);
      if (toRead <= 0) return new Uint8Array(0);
      // readBytes may return fewer bytes than asked. A short non-final chunk
      // would be sealed at the wrong length and the file could never be
      // decrypted, so keep reading until the chunk is whole.
      const parts: Uint8Array[] = [];
      let got = 0;
      while (got < toRead) {
        const chunk = handle.readBytes(toRead - got);
        if (chunk.length === 0) break;
        parts.push(chunk);
        got += chunk.length;
      }
      offset += got;
      return parts.length === 1 ? parts[0]! : concatBytes(...parts);
    },
    close: () => handle.close(),
  };
}

function fileWriter(uri: string): ByteWriter {
  const file = new File(uri);
  file.create({ intermediates: true, overwrite: true });
  const handle = file.open(FileMode.Truncate);
  return {
    write: (bytes: Uint8Array) => handle.writeBytes(bytes),
    close: () => handle.close(),
  };
}

export interface FileCryptOptions {
  dek: Uint8Array;
  itemId: string;
  sourceUri: string;
  destUri: string;
  onProgress?: (progress: StreamProgress) => void;
}

export async function encryptFile(options: FileCryptOptions): Promise<void> {
  await encryptStream({
    dek: options.dek,
    itemId: options.itemId,
    reader: fileReader(options.sourceUri),
    writer: fileWriter(options.destUri),
    onProgress: options.onProgress,
  });
}

export async function decryptFile(options: FileCryptOptions): Promise<void> {
  await decryptStream({
    dek: options.dek,
    itemId: options.itemId,
    reader: fileReader(options.sourceUri),
    writer: fileWriter(options.destUri),
    onProgress: options.onProgress,
  });
}

/** Decrypts a small encrypted file (photo/thumbnail) fully into memory. */
export async function decryptFileToBytes(dek: Uint8Array, itemId: string, sourceUri: string): Promise<Uint8Array> {
  const writer = bytesWriter();
  await decryptStream({ dek, itemId, reader: fileReader(sourceUri), writer });
  return writer.toBytes();
}

/** Encrypts an in-memory payload (thumbnail) to an encrypted file. */
export async function encryptBytesToFile(dek: Uint8Array, itemId: string, data: Uint8Array, destUri: string): Promise<void> {
  await encryptStream({ dek, itemId, reader: bytesReader(data), writer: fileWriter(destUri) });
}
