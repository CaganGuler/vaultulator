/**
 * Public database surface. `getDb` is intentionally absent: content queries
 * live in the *-repo modules and must take a VaultContext (see ./scope.ts).
 */
import { getDb } from './connection';

export { destroyDb } from './connection';

/**
 * Global, non-secret preferences. Deliberately shared across vaults — a decoy
 * with a different auto-lock delay than the real vault would be a tell.
 */
export async function getMeta(key: string): Promise<string | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
