/**
 * Jest stand-in for react-native-quick-crypto, backed by node:crypto.
 *
 * argon2 has no Node builtin, so tests use a DETERMINISTIC scrypt-based fake.
 * It is NOT argon2 and NOT secure — it only preserves the property the logic
 * tests need: same (password, salt, secret) → same key, anything else → a
 * different key. The real argon2id path is exercised on-device.
 */
import * as nodeCrypto from 'node:crypto';

type BinaryLike = Uint8Array | string;

interface Argon2Params {
  message: BinaryLike;
  nonce: BinaryLike;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
  secret?: BinaryLike;
}

function toBuffer(value: BinaryLike): Buffer {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
}

const QuickCryptoShim = {
  randomBytes: (size: number) => nodeCrypto.randomBytes(size),

  argon2: (
    algorithm: string,
    params: Argon2Params,
    callback: (err: Error | null, result?: Buffer) => void,
  ) => {
    try {
      if (algorithm !== 'argon2id') throw new Error(`unexpected algorithm ${algorithm}`);
      const password = Buffer.concat([
        toBuffer(params.message),
        params.secret ? toBuffer(params.secret) : Buffer.alloc(0),
        Buffer.from(`${params.memory}:${params.passes}:${params.parallelism}`),
      ]);
      const key = nodeCrypto.scryptSync(password, toBuffer(params.nonce), params.tagLength, {
        N: 1024,
        r: 8,
        p: 1,
      });
      callback(null, key);
    } catch (e) {
      callback(e as Error);
    }
  },

  hkdfSync: (digest: string, ikm: BinaryLike, salt: BinaryLike, info: BinaryLike, keylen: number) =>
    Buffer.from(nodeCrypto.hkdfSync(digest, toBuffer(ikm), toBuffer(salt), toBuffer(info), keylen)),

  createHmac: (algorithm: string, key: BinaryLike) => nodeCrypto.createHmac(algorithm, toBuffer(key)),

  createCipheriv: (algorithm: string, key: BinaryLike, iv: BinaryLike) =>
    nodeCrypto.createCipheriv(algorithm as nodeCrypto.CipherGCMTypes, toBuffer(key), toBuffer(iv)),

  createDecipheriv: (algorithm: string, key: BinaryLike, iv: BinaryLike) =>
    nodeCrypto.createDecipheriv(algorithm as nodeCrypto.CipherGCMTypes, toBuffer(key), toBuffer(iv)),
};

export default QuickCryptoShim;
