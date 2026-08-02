/**
 * The .enc header.
 *
 * Every rejection path here was previously unreachable from the test suite —
 * the FormatError constructor never executed once. These are the paths that
 * run when someone points the app at a file that is not a vault file, or at
 * one written by a future version.
 */
import {
  buildHeader,
  chunkIv,
  DEFAULT_CHUNK_SIZE,
  FILE_SALT_LEN,
  FORMAT_VERSION,
  FormatError,
  HEADER_LEN,
  MAGIC,
  NONCE_PREFIX_LEN,
  parseHeader,
} from '../format';

const salt = new Uint8Array(FILE_SALT_LEN).fill(7);
const prefix = new Uint8Array(NONCE_PREFIX_LEN).fill(9);
const b = (bytes: Uint8Array) => Buffer.from(bytes);

describe('buildHeader', () => {
  it('round-trips through parseHeader', () => {
    const built = buildHeader(salt, prefix, DEFAULT_CHUNK_SIZE);
    expect(built.raw).toHaveLength(HEADER_LEN);

    const parsed = parseHeader(built.raw);
    expect(parsed.version).toBe(FORMAT_VERSION);
    expect(b(parsed.fileSalt)).toEqual(b(salt));
    expect(b(parsed.noncePrefix)).toEqual(b(prefix));
    expect(parsed.chunkSize).toBe(DEFAULT_CHUNK_SIZE);
  });

  it('lays the fields out at the documented offsets', () => {
    const { raw } = buildHeader(salt, prefix, 1024);
    expect(b(raw.subarray(0, 4))).toEqual(b(MAGIC));
    expect(raw[4]).toBe(FORMAT_VERSION);
    expect(b(raw.subarray(5, 21))).toEqual(b(salt));
    expect(b(raw.subarray(21, 28))).toEqual(b(prefix));
    expect(new DataView(raw.buffer, raw.byteOffset).getUint32(28, false)).toBe(1024);
    expect(raw[32]).toBe(0);
  });

  it('rejects wrong-length inputs', () => {
    expect(() => buildHeader(new Uint8Array(15), prefix, 1024)).toThrow(FormatError);
    expect(() => buildHeader(new Uint8Array(17), prefix, 1024)).toThrow(FormatError);
    expect(() => buildHeader(salt, new Uint8Array(6), 1024)).toThrow(FormatError);
    expect(() => buildHeader(salt, new Uint8Array(8), 1024)).toThrow(FormatError);
  });

  it('rejects a chunk size that cannot be encoded', () => {
    for (const size of [0, -1, 1.5, 0x1_0000_0000, NaN]) {
      expect(() => buildHeader(salt, prefix, size)).toThrow(FormatError);
    }
  });

  it('accepts the largest encodable chunk size', () => {
    expect(buildHeader(salt, prefix, 0xffffffff).chunkSize).toBe(0xffffffff);
  });
});

describe('parseHeader', () => {
  const valid = () => Uint8Array.from(buildHeader(salt, prefix, 1024).raw);

  it('rejects a header of the wrong length', () => {
    expect(() => parseHeader(valid().subarray(0, HEADER_LEN - 1))).toThrow(FormatError);
    expect(() => parseHeader(new Uint8Array(HEADER_LEN + 1))).toThrow(FormatError);
    expect(() => parseHeader(new Uint8Array(0))).toThrow(FormatError);
  });

  it('rejects a file that is not a vault file', () => {
    // The realistic case: the user's own JPEG, or a truncated download.
    const notOurs = valid();
    notOurs[0] = 0x4a; // 'J'
    expect(() => parseHeader(notOurs)).toThrow(/kasa dosyası değil/);
  });

  it('rejects a future format version rather than guessing', () => {
    const future = valid();
    future[4] = FORMAT_VERSION + 1;
    expect(() => parseHeader(future)).toThrow(/Desteklenmeyen format sürümü/);
  });

  it('rejects a zeroed chunk size', () => {
    const zeroed = valid();
    new DataView(zeroed.buffer, zeroed.byteOffset).setUint32(28, 0, false);
    expect(() => parseHeader(zeroed)).toThrow(FormatError);
  });

  it('copies the raw header instead of aliasing the caller’s buffer', () => {
    const source = valid();
    const parsed = parseHeader(source);
    source[32] = 0xff; // mutate after parsing
    // AAD integrity depends on `raw` being the bytes that were parsed.
    expect(parsed.raw[32]).toBe(0);
  });

  it('parses a header sitting at a non-zero offset in a larger buffer', () => {
    // fileReader hands over subarrays, so byteOffset must be respected — a
    // DataView built without it would read the wrong four bytes for chunkSize.
    const padded = new Uint8Array(HEADER_LEN + 8);
    padded.set(valid(), 8);
    expect(parseHeader(padded.subarray(8)).chunkSize).toBe(1024);
  });
});

describe('chunkIv', () => {
  it('lays out prefix, big-endian index and the last-chunk flag', () => {
    const iv = chunkIv(prefix, 0x01020304, true);
    expect(iv).toHaveLength(12);
    expect(b(iv.subarray(0, 7))).toEqual(b(prefix));
    expect([...iv.subarray(7, 11)]).toEqual([0x01, 0x02, 0x03, 0x04]);
    expect(iv[11]).toBe(1);
  });

  it('differs for every index and for the final chunk', () => {
    const seen = new Set(
      [0, 1, 2].flatMap((i) => [false, true].map((last) => b(chunkIv(prefix, i, last)).toString('hex'))),
    );
    expect(seen.size).toBe(6);
  });
});
