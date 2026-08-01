/**
 * Self-describing encrypted file format (*.enc).
 *
 * Header (33 bytes):
 *   0..3   magic "SVLT"
 *   4      format version (0x01)
 *   5..20  fileSalt (16 B, random per file; HKDF salt for the per-file subkey)
 *   21..27 noncePrefix (7 B, random per file)
 *   28..31 chunkSize (uint32 BE, plaintext bytes per chunk)
 *   32     reserved (0x00)
 *
 * Body: N chunks of AES-256-GCM output (chunk ciphertext || 16 B tag).
 *   IV_i  = noncePrefix(7) || chunkIndex(uint32 BE) || lastChunkFlag(1: 0x00|0x01)
 *   AAD_i = header(33) || utf8(itemId)
 *
 * The chunk counter defeats reordering, the last-chunk flag defeats
 * truncation, and the AAD binds every chunk to this header and to the owning
 * DB row (defeats file swapping). This mirrors Tink's AES-GCM-HKDF streaming
 * AEAD / age's STREAM construction.
 */

export const MAGIC = new Uint8Array([0x53, 0x56, 0x4c, 0x54]); // "SVLT"
export const FORMAT_VERSION = 1;
export const HEADER_LEN = 33;
export const FILE_SALT_LEN = 16;
export const NONCE_PREFIX_LEN = 7;
export const DEFAULT_CHUNK_SIZE = 1024 * 1024; // 1 MiB plaintext per chunk

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatError';
  }
}

export interface EncHeader {
  version: number;
  fileSalt: Uint8Array;
  noncePrefix: Uint8Array;
  chunkSize: number;
  /** The exact serialized header bytes — used as AAD. */
  raw: Uint8Array;
}

export function buildHeader(fileSalt: Uint8Array, noncePrefix: Uint8Array, chunkSize: number): EncHeader {
  if (fileSalt.length !== FILE_SALT_LEN) throw new FormatError('fileSalt uzunluğu hatalı');
  if (noncePrefix.length !== NONCE_PREFIX_LEN) throw new FormatError('noncePrefix uzunluğu hatalı');
  if (!Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize > 0xffffffff) {
    throw new FormatError('chunkSize geçersiz');
  }
  const raw = new Uint8Array(HEADER_LEN);
  raw.set(MAGIC, 0);
  raw[4] = FORMAT_VERSION;
  raw.set(fileSalt, 5);
  raw.set(noncePrefix, 21);
  new DataView(raw.buffer).setUint32(28, chunkSize, false);
  raw[32] = 0;
  return { version: FORMAT_VERSION, fileSalt, noncePrefix, chunkSize, raw };
}

export function parseHeader(raw: Uint8Array): EncHeader {
  if (raw.length !== HEADER_LEN) throw new FormatError('Header eksik');
  for (let i = 0; i < MAGIC.length; i++) {
    if (raw[i] !== MAGIC[i]) throw new FormatError('Dosya bir kasa dosyası değil (magic uyuşmuyor)');
  }
  const version = raw[4];
  if (version !== FORMAT_VERSION) throw new FormatError(`Desteklenmeyen format sürümü: ${version}`);
  const fileSalt = raw.slice(5, 5 + FILE_SALT_LEN);
  const noncePrefix = raw.slice(21, 21 + NONCE_PREFIX_LEN);
  const chunkSize = new DataView(raw.buffer, raw.byteOffset).getUint32(28, false);
  if (chunkSize <= 0) throw new FormatError('chunkSize geçersiz');
  return { version, fileSalt, noncePrefix, chunkSize, raw: raw.slice() };
}

/** IV for chunk i: noncePrefix(7) || index(4 BE) || lastFlag(1). */
export function chunkIv(noncePrefix: Uint8Array, chunkIndex: number, isLast: boolean): Uint8Array {
  const iv = new Uint8Array(12);
  iv.set(noncePrefix, 0);
  new DataView(iv.buffer).setUint32(NONCE_PREFIX_LEN, chunkIndex, false);
  iv[11] = isLast ? 1 : 0;
  return iv;
}
