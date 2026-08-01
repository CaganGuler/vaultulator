import { decryptField, encryptField } from '../fields';
import { IntegrityError, randomBytes } from '../primitives';

describe('field encryption', () => {
  const dbKey = randomBytes(32);

  it('round-trips unicode text', () => {
    const value = 'Çok gizli not 🤐 — şifreli';
    const blob = encryptField(dbKey, 'notes', 'row-1', 'body', value);
    expect(decryptField(dbKey, 'notes', 'row-1', 'body', blob)).toBe(value);
  });

  it('round-trips the empty string', () => {
    const blob = encryptField(dbKey, 'notes', 'row-1', 'title', '');
    expect(decryptField(dbKey, 'notes', 'row-1', 'title', blob)).toBe('');
  });

  it('produces a fresh IV every time', () => {
    const a = encryptField(dbKey, 'notes', 'row-1', 'body', 'x');
    const b = encryptField(dbKey, 'notes', 'row-1', 'body', 'x');
    expect(Buffer.from(a)).not.toEqual(Buffer.from(b));
  });

  it.each([
    ['table', 'other', 'row-1', 'body'],
    ['row', 'notes', 'row-2', 'body'],
    ['column', 'notes', 'row-1', 'title'],
  ])('rejects ciphertext moved to another %s (AAD binding)', (_label, table, rowId, column) => {
    const blob = encryptField(dbKey, 'notes', 'row-1', 'body', 'gizli');
    expect(() => decryptField(dbKey, table, rowId, column, blob)).toThrow(IntegrityError);
  });

  it('rejects a wrong key', () => {
    const blob = encryptField(dbKey, 'notes', 'row-1', 'body', 'gizli');
    expect(() => decryptField(randomBytes(32), 'notes', 'row-1', 'body', blob)).toThrow(IntegrityError);
  });
});
