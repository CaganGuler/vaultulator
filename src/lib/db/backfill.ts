/**
 * Schema v2 backfill: stamps ownership tags onto rows that predate multi-vault
 * support.
 *
 * The v2 migration can only add the column — the tag key does not exist until a
 * PIN has been entered. So this runs at the first PRIMARY unlock, before the
 * session flips to `unlocked`. That ordering is load-bearing: if a scoped query
 * ran first, the user would open the app after the update and see an empty
 * vault, which is precisely the scenario that makes people reach for "reset".
 *
 * Completion is not tracked by a flag. "No NULL tags remain" lives in the data
 * itself and cannot desync; a transaction that rolls back simply retries on the
 * next unlock. Idempotent by construction.
 *
 * Only the primary vault can reach this. A decoy is created from within an
 * unlocked primary session, so by the time one exists the backfill has run.
 */
import { getDb } from './connection';
import { tagFor, type VaultContext } from './scope';

export async function backfillRowTags(ctx: VaultContext): Promise<void> {
  if (ctx.role !== 'primary') return;
  const db = await getDb();

  const [media, notes] = await Promise.all([
    db.getAllAsync<{ id: string }>('SELECT id FROM media_items WHERE vault_tag IS NULL'),
    db.getAllAsync<{ id: string }>('SELECT id FROM notes WHERE vault_tag IS NULL'),
  ]);
  if (media.length === 0 && notes.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const row of media) {
      await db.runAsync('UPDATE media_items SET vault_tag = ? WHERE id = ? AND vault_tag IS NULL', tagFor(ctx, row.id), row.id);
    }
    for (const row of notes) {
      await db.runAsync('UPDATE notes SET vault_tag = ? WHERE id = ? AND vault_tag IS NULL', tagFor(ctx, row.id), row.id);
    }
  });
}

/** True when every row carries a tag — asserted before a decoy may be created. */
export async function hasUntaggedRows(): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM media_items WHERE vault_tag IS NULL)
          + (SELECT COUNT(*) FROM notes WHERE vault_tag IS NULL) AS n`,
  );
  return (row?.n ?? 0) > 0;
}
