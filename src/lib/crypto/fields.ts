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
