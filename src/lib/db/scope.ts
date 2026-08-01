/**
 * Vault scoping for database rows.
 *
 * Both vaults share one `vault.db` and one flat media directory on purpose:
 * separate files or directories would announce "there are two vaults here" to
 * anyone imaging the device.
 *
 * Rows are separated by a per-row tag, `HMAC(tagKey, rowId)`. It cannot be a
 * per-vault constant — a repeated value would partition the tables in plaintext
 * and prove the second vault exists, defeating the whole point. The cost is
 * that scoping cannot be a SQL `WHERE`: rows are fetched and filtered here, in
 * one place, which is also why no call site can forget to do it.
 */
import { rowTag, type VaultRole } from '../crypto/keys';
import { bytesEqual } from '../crypto/primitives';

/**
 * Everything a repo needs to read or write one vault's rows. Passed as the
 * first argument to every content query, so adding a query that skips scoping
 * is a type error rather than a silent cross-vault leak.
 */
export interface VaultContext {
  readonly dek: Uint8Array;
  readonly dbKey: Uint8Array;
  readonly tagKey: Uint8Array;
  readonly role: VaultRole;
}

/** Row shape every scoped table shares. */
export interface TaggedRow {
  id: string;
  vault_tag: Uint8Array | null;
}

export function tagFor(ctx: VaultContext, rowId: string): Uint8Array {
  return rowTag(ctx.tagKey, rowId);
}

export function owns(ctx: VaultContext, row: TaggedRow): boolean {
  if (!row.vault_tag) return false; // un-backfilled rows belong to nobody yet
  return bytesEqual(tagFor(ctx, row.id), Uint8Array.from(row.vault_tag));
}

export function ownedRows<T extends TaggedRow>(ctx: VaultContext, rows: T[]): T[] {
  return rows.filter((row) => owns(ctx, row));
}
