import * as Crypto from 'expo-crypto';

import { getDb } from './connection';
import { ownedRows, owns, tagFor, type TaggedRow, type VaultContext } from './scope';
import { decryptField, encryptField } from '../crypto/fields';

export interface NoteSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface Note extends NoteSummary {
  body: string;
  createdAt: number;
}

interface NoteRow extends TaggedRow {
  id: string;
  title_enc: Uint8Array;
  body_enc: Uint8Array;
  created_at: number;
  updated_at: number;
}

export async function createNote(ctx: VaultContext, title: string, body: string): Promise<Note> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = Date.now();
  await db.runAsync(
    'INSERT INTO notes (id, title_enc, body_enc, created_at, updated_at, vault_tag) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    encryptField(ctx.dbKey, 'notes', id, 'title', title),
    encryptField(ctx.dbKey, 'notes', id, 'body', body),
    now,
    now,
    tagFor(ctx, id),
  );
  return { id, title, body, createdAt: now, updatedAt: now };
}

export async function updateNote(ctx: VaultContext, id: string, title: string, body: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE notes SET title_enc = ?, body_enc = ?, updated_at = ? WHERE id = ? AND vault_tag = ?',
    encryptField(ctx.dbKey, 'notes', id, 'title', title),
    encryptField(ctx.dbKey, 'notes', id, 'body', body),
    Date.now(),
    id,
    tagFor(ctx, id),
  );
}

export async function getNote(ctx: VaultContext, id: string): Promise<Note | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<NoteRow>('SELECT * FROM notes WHERE id = ?', id);
  if (!row || !owns(ctx, row)) return null;
  return {
    id: row.id,
    title: decryptField(ctx.dbKey, 'notes', row.id, 'title', row.title_enc),
    body: decryptField(ctx.dbKey, 'notes', row.id, 'body', row.body_enc),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Filtering here is a correctness requirement, not just isolation: decrypting a
 * foreign row's title with this session's dbKey throws IntegrityError, which
 * would take down the whole list the moment the other vault has one note.
 */
export async function listNotes(ctx: VaultContext): Promise<NoteSummary[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<NoteRow, 'body_enc'>>(
    'SELECT id, title_enc, created_at, updated_at, vault_tag FROM notes ORDER BY updated_at DESC',
  );
  return ownedRows(ctx, rows).map((row) => ({
    id: row.id,
    title: decryptField(ctx.dbKey, 'notes', row.id, 'title', row.title_enc),
    updatedAt: row.updated_at,
  }));
}

export async function deleteNote(ctx: VaultContext, id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM notes WHERE id = ? AND vault_tag = ?', id, tagFor(ctx, id));
}

export async function countNotes(ctx: VaultContext): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<TaggedRow>('SELECT id, vault_tag FROM notes');
  return ownedRows(ctx, rows).length;
}

/** Deletes every note belonging to this vault, leaving the other one alone. */
export async function deleteAllNotesOf(ctx: VaultContext): Promise<void> {
  const db = await getDb();
  const rows = await db.getAllAsync<TaggedRow>('SELECT id, vault_tag FROM notes');
  const owned = ownedRows(ctx, rows);
  await db.withTransactionAsync(async () => {
    for (const row of owned) {
      await db.runAsync('DELETE FROM notes WHERE id = ?', row.id);
    }
  });
}
