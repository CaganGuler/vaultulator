/**
 * base64 has two implementations: the JSI globals react-native-quick-crypto
 * installs on device, and a pure-JS fallback. Only the fallback runs under
 * jest, so a divergence between them would be invisible until it corrupted a
 * vault record on a real phone. These tests exercise both.
 */
import { base64Decode, base64Encode } from '../base64';

type Globals = Record<string, unknown>;

function withNativeGlobals(run: () => void): void {
  const g = globalThis as Globals;
  g.base64FromArrayBuffer = (buf: ArrayBuffer) => Buffer.from(new Uint8Array(buf)).toString('base64');
  g.base64ToArrayBuffer = (s: string) => {
    const buf = Buffer.from(s, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  };
  try {
    run();
  } finally {
    delete g.base64FromArrayBuffer;
    delete g.base64ToArrayBuffer;
  }
}

const lengths = [0, 1, 2, 3, 4, 5, 16, 31, 32, 33, 61, 62, 326];

function sample(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
}

describe('pure-JS path', () => {
  it.each(lengths)('round-trips %i bytes', (length) => {
    const bytes = sample(length);
    expect(Buffer.from(base64Decode(base64Encode(bytes)))).toEqual(Buffer.from(bytes));
  });

  it('agrees with Node on the encoding itself', () => {
    for (const length of lengths) {
      const bytes = sample(length);
      expect(base64Encode(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('decodes a byte range that does not start at zero', () => {
    // Callers hand over subarrays of the vault record.
    const backing = sample(64);
    const view = backing.subarray(16, 48);
    expect(Buffer.from(base64Decode(base64Encode(view)))).toEqual(Buffer.from(view));
  });
});

describe('native path', () => {
  it('produces byte-identical results to the fallback', () => {
    for (const length of lengths) {
      const bytes = sample(length);
      const fallback = base64Encode(bytes);
      withNativeGlobals(() => {
        expect(base64Encode(bytes)).toBe(fallback);
        expect(Buffer.from(base64Decode(fallback))).toEqual(Buffer.from(bytes));
      });
    }
  });

  it('handles subarrays without leaking the rest of the backing buffer', () => {
    const backing = sample(100);
    const view = backing.subarray(10, 42);
    withNativeGlobals(() => {
      expect(Buffer.from(base64Decode(base64Encode(view)))).toEqual(Buffer.from(view));
    });
  });
});
