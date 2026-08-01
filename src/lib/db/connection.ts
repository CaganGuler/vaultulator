/**
 * The SQLite handle. Deliberately NOT re-exported from ./index — only repo
 * modules in this folder may reach the raw database, so every query that
 * touches vault content is forced through a VaultContext-scoped function.
 */
import * as SQLite from 'expo-sqlite';

import { MIGRATIONS, SCHEMA_VERSION } from './schema';

let db: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync('vault.db');
  await database.execAsync('PRAGMA journal_mode = WAL;');
  // Overwrite freed pages instead of leaving deleted rows in the freelist —
  // a wiped decoy should not be recoverable from the file.
  await database.execAsync('PRAGMA secure_delete = ON;');
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < SCHEMA_VERSION; v++) {
    await database.execAsync(MIGRATIONS[v]);
    await database.execAsync(`PRAGMA user_version = ${v + 1}`);
  }
  return database;
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  opening ??= openAndMigrate();
  db = await opening;
  return db;
}

/** Closes and deletes the database (full vault reset). */
export async function destroyDb(): Promise<void> {
  try {
    if (db) await db.closeAsync();
  } catch {
    // proceed to deletion regardless
  }
  db = null;
  opening = null;
  try {
    await SQLite.deleteDatabaseAsync('vault.db');
  } catch {
    // db may not exist yet
  }
}
