import { File } from 'expo-file-system';

import { DEFAULT_CHUNK_SIZE, HEADER_LEN } from '../format';
import { GCM_TAG_LEN, IntegrityError, randomBytes } from '../primitives';
import {
  bytesReader,
  bytesWriter,
  decryptFile,
  decryptFileToBytes,
  decryptStream,
  encryptBytesToFile,
  encryptFile,
  encryptStream,
} from '../stream';
import {
  __forceShortRead as forceShortRead,
  __reset as resetFs,
  __writeFile as writeFile,
} from '../../../test/file-system-mock';

const CHUNK = 1024; // small chunk size so tests cover multi-chunk paths

async function encrypt(dek: Uint8Array, itemId: string, plain: Uint8Array): Promise<Uint8Array> {
  const writer = bytesWriter();
  await encryptStream({ dek, itemId, reader: bytesReader(plain), writer, chunkSize: CHUNK });
  return writer.toBytes();
}

async function decrypt(dek: Uint8Array, itemId: string, sealed: Uint8Array): Promise<Uint8Array> {
  const writer = bytesWriter();
  await decryptStream({ dek, itemId, reader: bytesReader(sealed), writer });
  return writer.toBytes();
}

describe('stream round-trip', () => {
  const dek = randomBytes(32);

  it.each([0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK + 517])('round-trips %i bytes', async (size) => {
    const plain = randomBytes(size);
    const sealed = await encrypt(dek, 'item-1', plain);
    expect(sealed.length).toBe(HEADER_LEN + Math.max(1, Math.ceil(size / CHUNK)) * GCM_TAG_LEN + size);
    const out = await decrypt(dek, 'item-1', sealed);
    expect(Buffer.from(out)).toEqual(Buffer.from(plain));
  });

  it('produces different ciphertexts for the same plaintext (random salt/nonce)', async () => {
    const plain = randomBytes(100);
    const a = await encrypt(dek, 'item-1', plain);
    const b = await encrypt(dek, 'item-1', plain);
    expect(Buffer.from(a)).not.toEqual(Buffer.from(b));
  });

  it('reports progress', async () => {
    const sizes: number[] = [];
    const writer = bytesWriter();
    await encryptStream({
      dek,
      itemId: 'item-1',
      reader: bytesReader(randomBytes(2 * CHUNK + 10)),
      writer,
      chunkSize: CHUNK,
      onProgress: (p) => sizes.push(p.processedBytes),
    });
    expect(sizes).toEqual([CHUNK, 2 * CHUNK, 2 * CHUNK + 10]);
  });
});

describe('stream tamper resistance', () => {
  const dek = randomBytes(32);

  it('rejects a flipped ciphertext byte', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(3 * CHUNK));
    sealed[HEADER_LEN + 5] ^= 0xff;
    await expect(decrypt(dek, 'item-1', sealed)).rejects.toThrow(IntegrityError);
  });

  it('rejects a flipped header byte (AAD binding)', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(CHUNK));
    sealed[HEADER_LEN - 1] ^= 0x01; // reserved byte is part of the AAD
    await expect(decrypt(dek, 'item-1', sealed)).rejects.toThrow(IntegrityError);
  });

  it('rejects reordered chunks', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(3 * CHUNK));
    const sealedChunk = CHUNK + GCM_TAG_LEN;
    const swapped = Uint8Array.from(sealed);
    swapped.set(sealed.subarray(HEADER_LEN + sealedChunk, HEADER_LEN + 2 * sealedChunk), HEADER_LEN);
    swapped.set(sealed.subarray(HEADER_LEN, HEADER_LEN + sealedChunk), HEADER_LEN + sealedChunk);
    await expect(decrypt(dek, 'item-1', swapped)).rejects.toThrow(IntegrityError);
  });

  it('rejects truncation at a chunk boundary', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(3 * CHUNK));
    const truncated = sealed.subarray(0, HEADER_LEN + 2 * (CHUNK + GCM_TAG_LEN));
    await expect(decrypt(dek, 'item-1', truncated)).rejects.toThrow(IntegrityError);
  });

  it('rejects mid-chunk truncation', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(2 * CHUNK));
    const truncated = sealed.subarray(0, sealed.length - 7);
    await expect(decrypt(dek, 'item-1', truncated)).rejects.toThrow(IntegrityError);
  });

  it('rejects appended garbage', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(CHUNK));
    const extended = Buffer.concat([sealed, randomBytes(CHUNK + GCM_TAG_LEN)]);
    await expect(decrypt(dek, 'item-1', Uint8Array.from(extended))).rejects.toThrow(IntegrityError);
  });

  it('rejects the wrong itemId (file-swap protection)', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(100));
    await expect(decrypt(dek, 'item-2', sealed)).rejects.toThrow(IntegrityError);
  });

  it('rejects the wrong DEK', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(100));
    await expect(decrypt(randomBytes(32), 'item-1', sealed)).rejects.toThrow(IntegrityError);
  });
});

/**
 * The expo-file-system adapters. Previously untestable and therefore at 0%
 * coverage — which is where an SDK bump would silently break the read loop or
 * the size fallback.
 */
describe('file adapters', () => {
  const dek = randomBytes(32);
  const src = 'file:///mock-document/src.bin';
  const enc = 'file:///mock-document/out.enc';
  const out = 'file:///mock-document/back.bin';

  const read = (uri: string): Uint8Array => {
    const handle = new File(uri).open();
    const bytes = handle.readBytes(handle.size ?? 0);
    handle.close();
    return bytes;
  };

  beforeEach(() => resetFs());

  it('round-trips a file through disk', async () => {
    const plain = randomBytes(3 * 1024 + 517);
    writeFile(src, plain);

    await encryptFile({ dek, itemId: 'item-1', sourceUri: src, destUri: enc });
    await decryptFile({ dek, itemId: 'item-1', sourceUri: enc, destUri: out });

    expect(Buffer.from(read(out))).toEqual(Buffer.from(plain));
  });

  it('writes exactly the length the ingest check expects', async () => {
    const plain = randomBytes(2 * 1024 * 1024 + 5); // spans three default chunks
    writeFile(src, plain);

    await encryptFile({ dek, itemId: 'item-1', sourceUri: src, destUri: enc });

    const chunks = Math.ceil(plain.length / DEFAULT_CHUNK_SIZE);
    expect(new File(enc).size).toBe(HEADER_LEN + plain.length + chunks * GCM_TAG_LEN);
  });

  it('survives a short read from the handle', async () => {
    const plain = randomBytes(4096);
    writeFile(src, plain);
    forceShortRead(); // the reader must loop, not seal a half chunk

    await encryptFile({ dek, itemId: 'item-1', sourceUri: src, destUri: enc });
    await decryptFile({ dek, itemId: 'item-1', sourceUri: enc, destUri: out });

    expect(Buffer.from(read(out))).toEqual(Buffer.from(plain));
  });

  it('round-trips an empty file', async () => {
    writeFile(src, new Uint8Array(0));

    await encryptFile({ dek, itemId: 'item-1', sourceUri: src, destUri: enc });
    // Even nothing is authenticated: one empty chunk plus its tag.
    expect(new File(enc).size).toBe(HEADER_LEN + GCM_TAG_LEN);

    await decryptFile({ dek, itemId: 'item-1', sourceUri: enc, destUri: out });
    expect(new File(out).size).toBe(0);
  });

  it('refuses a source whose size cannot be determined', async () => {
    await expect(
      encryptFile({ dek, itemId: 'item-1', sourceUri: 'file:///mock-document/missing.bin', destUri: enc }),
    ).rejects.toThrow();
  });

  it('round-trips in-memory helpers against the file ones', async () => {
    const plain = randomBytes(900);
    await encryptBytesToFile(dek, 'item-1', plain, enc);
    expect(Buffer.from(await decryptFileToBytes(dek, 'item-1', enc))).toEqual(Buffer.from(plain));
  });

  it('rejects a tampered file on disk', async () => {
    writeFile(src, randomBytes(2048));
    await encryptFile({ dek, itemId: 'item-1', sourceUri: src, destUri: enc });

    const sealed = read(enc);
    sealed[HEADER_LEN + 10] ^= 0x01;
    writeFile(enc, sealed);

    await expect(decryptFile({ dek, itemId: 'item-1', sourceUri: enc, destUri: out })).rejects.toThrow(IntegrityError);
  });
});
