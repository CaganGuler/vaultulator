/**
 * Jest stand-in for expo-sqlite, backed by node:sqlite.
 *
 * Real SQL rather than a hand-rolled fake, so the vault-scoping tests exercise
 * actual ALTER TABLE migrations, BLOB round-trips and transaction rollback —
 * the places a cross-vault leak would realistically hide.
 */
import { DatabaseSync } from 'node:sqlite';

type Param = string | number | bigint | Uint8Array | null;

export interface RunResult {
  changes: number;
  lastInsertRowId: number;
}

const open = new Map<string, SQLiteDatabase>();

export class SQLiteDatabase {
  private db: DatabaseSync;

  constructor(readonly name: string) {
    this.db = new DatabaseSync(':memory:');
  }

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async getFirstAsync<T>(sql: string, ...params: Param[]): Promise<T | null> {
    return (this.db.prepare(sql).get(...params) as T) ?? null;
  }

  async getAllAsync<T>(sql: string, ...params: Param[]): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async runAsync(sql: string, ...params: Param[]): Promise<RunResult> {
    const result = this.db.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.db.exec('BEGIN');
    try {
      await task();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async closeAsync(): Promise<void> {
    this.db.close();
  }
}

export async function openDatabaseAsync(name: string): Promise<SQLiteDatabase> {
  let db = open.get(name);
  if (!db) {
    db = new SQLiteDatabase(name);
    open.set(name, db);
  }
  return db;
}

export async function deleteDatabaseAsync(name: string): Promise<void> {
  open.delete(name);
}

/** Drops every open database so each test starts from a clean schema. */
export function __reset(): void {
  open.clear();
}
