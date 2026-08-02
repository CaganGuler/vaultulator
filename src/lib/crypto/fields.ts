/**
 * Field-level encryption for SQLite columns (note titles/bodies).
 *
 * Each value is one AES-256-GCM operation with a fresh random 12 B IV,
 * stored as a single BLOB: iv(12) || ciphertext || tag(16).
 * AAD = "table:rowId:column" so a ciphertext cut-and-pasted into another
 * row or column fails authentication.
 */
import { concatBytes, gcmOpen, gcmSeal, GCM_IV_LEN, IntegrityError, randomBytes, utf8Decode, utf8Encode } from './primitives';

function fieldAad(table: string, rowId: string, column: string): Uint8Array {
  return utf8Encode(`${table}:${rowId}:${column}`);
}

export function encryptField(dbKey: Uint8Array, table: string, rowId: string, column: string, value: string): Uint8Array {
  const iv = randomBytes(GCM_IV_LEN);
  const sealed = gcmSeal(dbKey, iv, utf8Encode(value), fieldAad(table, rowId, column));
  return concatBytes(iv, sealed);
}

export function decryptField(dbKey: Uint8Array, table: string, rowId: string, column: string, blob: Uint8Array): string {
  if (blob.length < GCM_IV_LEN) throw new IntegrityError('Alan verisi çok kısa');
  const iv = blob.subarray(0, GCM_IV_LEN);
  const sealed = blob.subarray(GCM_IV_LEN);
  return utf8Decode(gcmOpen(dbKey, iv, sealed, fieldAad(table, rowId, column)));
}

// ── Length padding ──────────────────────────────────────────────────────────
//
// GCM does not hide length, so `length(blob)` leaks the size of what it wraps:
// how many items an album holds, how long a caption is. Padding to a byte
// bucket blurs that to the bucket width.
//
// This is a plaintext convention, not a format change — nothing about the
// ciphertext layout moves, so invariant #4 does not apply and no version byte
// changes. Note the existing note columns are deliberately NOT retrofitted:
// re-padding them would mean re-encrypting every note, which needs the dbKey
// and therefore a second keyed backfill. The asymmetry says nothing about how
// many vaults exist. See docs/DATA-MODEL.md.

/**
 * NUL terminates the value and fills the remainder. It cannot occur in the
 * text stored here — captions, album names, filenames — so it is unambiguous.
 * A space would truncate the first caption that contained one.
 */
const NUL = '\u0000';

export function padToBucket(value: string, bucketBytes: number): string {
  if (value.includes(NUL)) throw new Error('Değer NUL içeremez');
  const needed = utf8Encode(value).length + 1; // + terminator
  const target = Math.max(bucketBytes, Math.ceil(needed / bucketBytes) * bucketBytes);
  // Pad in characters, not bytes: NUL is one byte in UTF-8, so the encoded
  // length lands exactly on the bucket.
  return value + NUL.repeat(target - utf8Encode(value).length);
}

export function unpad(padded: string): string {
  const end = padded.indexOf(NUL);
  return end === -1 ? padded : padded.slice(0, end);
}
