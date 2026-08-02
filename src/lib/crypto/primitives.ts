/**
 * Thin typed wrapper around react-native-quick-crypto.
 *
 * Everything above this module works with plain Uint8Array so the rest of the
 * crypto layer is engine-agnostic (jest maps react-native-quick-crypto to a
 * node:crypto shim, see src/test/quick-crypto-node-shim.ts).
 */
import QuickCrypto from 'react-native-quick-crypto';

export class IntegrityError extends Error {
  constructor(message = 'Şifre çözme doğrulaması başarısız (veri bozulmuş veya anahtar yanlış)') {
    super(message);
    this.name = 'IntegrityError';
  }
}

export const GCM_IV_LEN = 12;
export const GCM_TAG_LEN = 16;
export const KEY_LEN = 32;

function toU8(buf: ArrayBufferLike | Uint8Array | { buffer: ArrayBufferLike; byteOffset: number; length: number }): Uint8Array {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  const view = buf as { buffer: ArrayBufferLike; byteOffset: number; length: number };
  return new Uint8Array(view.buffer, view.byteOffset, view.length);
}

export function randomBytes(length: number): Uint8Array {
  return Uint8Array.from(toU8(QuickCrypto.randomBytes(length)));
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export interface Argon2idParams {
  memoryKiB: number;
  passes: number;
  parallelism: number;
}

/**
 * Argon2id with a keyed `secret` (the device pepper). Runs off the JS thread.
 */
/**
 * Copies `source` and wipes the original.
 *
 * The native layer hands back a buffer we do not own and cannot track. Once
 * the value is copied into a buffer the caller can zeroize, the native one is
 * dead weight holding key material, so clear it here rather than leave a
 * second copy of a KEK or subkey lying in the heap.
 */
function takeAndWipe(source: Uint8Array): Uint8Array {
  const copy = Uint8Array.from(source);
  source.fill(0);
  return copy;
}

export function argon2id(
  password: Uint8Array,
  salt: Uint8Array,
  secret: Uint8Array,
  params: Argon2idParams,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    QuickCrypto.argon2(
      'argon2id',
      {
        message: password,
        nonce: salt,
        parallelism: params.parallelism,
        tagLength: KEY_LEN,
        memory: params.memoryKiB,
        passes: params.passes,
        secret,
      },
      (err, result) => {
        if (err || !result) reject(err ?? new Error('argon2 sonuç üretmedi'));
        else resolve(takeAndWipe(toU8(result)));
      },
    );
  });
}

export function hkdf256(ikm: Uint8Array, salt: Uint8Array, info: string, length: number): Uint8Array {
  return takeAndWipe(toU8(QuickCrypto.hkdfSync('sha256', ikm, salt, info, length)));
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const mac = QuickCrypto.createHmac('sha256', key as never);
  mac.update(data as never);
  return takeAndWipe(toU8(mac.digest() as unknown as Uint8Array));
}

/** Length-independent, value-constant-time equality. Both operands are public-length. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** AES-256-GCM. Returns ciphertext || tag(16). */
export function gcmSeal(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
  const cipher = QuickCrypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(aad as never);
  const ct = toU8(cipher.update(plaintext) as unknown as Uint8Array);
  const final = toU8(cipher.final() as unknown as Uint8Array);
  const tag = toU8(cipher.getAuthTag() as unknown as Uint8Array);
  return concatBytes(ct, final, tag);
}

/** AES-256-GCM open. Input is ciphertext || tag(16). Throws IntegrityError on tag mismatch. */
export function gcmOpen(key: Uint8Array, iv: Uint8Array, sealed: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (sealed.length < GCM_TAG_LEN) throw new IntegrityError();
  const ct = sealed.subarray(0, sealed.length - GCM_TAG_LEN);
  const tag = sealed.subarray(sealed.length - GCM_TAG_LEN);
  try {
    const decipher = QuickCrypto.createDecipheriv('aes-256-gcm', key, iv);
    if (aad) decipher.setAAD(aad as never);
    decipher.setAuthTag(tag as never);
    const pt = toU8(decipher.update(ct) as unknown as Uint8Array);
    const final = toU8(decipher.final() as unknown as Uint8Array);
    const out = concatBytes(pt, final);
    // These fragments held the plaintext — a wrapped DEK, for instance. Without
    // this, every slot unwrap would leave a second copy of the key in a buffer
    // nothing else can reach, so zeroizing the session context would not
    // actually remove it from the heap.
    pt.fill(0);
    final.fill(0);
    return out;
  } catch {
    throw new IntegrityError();
  }
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Best-effort zeroization of key material. */
export function zeroize(bytes: Uint8Array | null | undefined): void {
  bytes?.fill(0);
}
