/**
 * Base64 helpers. Prefers react-native-quick-crypto's native (JSI) globals
 * when present; falls back to a pure-JS implementation (jest / edge cases).
 */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// react-native-quick-crypto installs base64FromArrayBuffer/base64ToArrayBuffer
// on globalThis at runtime; absent under jest (module is shimmed there).
type NativeEncode = (b: ArrayBuffer, urlSafe?: boolean) => string;
type NativeDecode = (s: string, removeLinebreaks?: boolean) => ArrayBuffer;

function nativeGlobals(): { encode?: NativeEncode; decode?: NativeDecode } {
  const g = globalThis as Record<string, unknown>;
  return {
    encode: typeof g.base64FromArrayBuffer === 'function' ? (g.base64FromArrayBuffer as NativeEncode) : undefined,
    decode: typeof g.base64ToArrayBuffer === 'function' ? (g.base64ToArrayBuffer as NativeDecode) : undefined,
  };
}

function jsEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 63] : '=';
  }
  return out;
}

function jsDecode(text: string): Uint8Array {
  const clean = text.replace(/[\s=]+$/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let accBits = 0;
  let offset = 0;
  for (const ch of clean) {
    const value = B64_ALPHABET.indexOf(ch);
    if (value < 0) throw new Error('Geçersiz base64');
    acc = (acc << 6) | value;
    accBits += 6;
    if (accBits >= 8) {
      accBits -= 8;
      out[offset++] = (acc >> accBits) & 0xff;
    }
  }
  return out.subarray(0, offset);
}

export function base64Encode(bytes: Uint8Array): string {
  const { encode } = nativeGlobals();
  if (encode) {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return encode(ab);
  }
  return jsEncode(bytes);
}

export function base64Decode(text: string): Uint8Array {
  const { decode } = nativeGlobals();
  if (decode) return new Uint8Array(decode(text));
  return jsDecode(text);
}
