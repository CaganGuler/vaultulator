/**
 * Albums.
 *
 * Membership is an encrypted, padded, ordered id list stored in the album row
 * (`items_enc`), not a join table. A join table needs a plaintext album_id
 * next to a plaintext media_id, and `GROUP BY album_id` over that partitions
 * media_items into equivalence classes: proof of which items belong together
 * and, transitively, that a second vault exists. The per-row vault_tag exists
 * specifically to keep that partition uncomputable, so a join table would undo
 * it. See docs/SECURITY.md.
 *
 * It is also far cheaper. Opening a 50-item album costs 51 rows — the album
 * plus its members fetched by id — against roughly 2500 for a join table, and
 * against the ~2000 the gallery already pays. Ordering and item counts come
 * free because the list *is* the order.
 */
import * as Crypto from 'expo-crypto';

import { getDb } from './connection';
import { ownedRows, owns, tagFor, type TaggedRow, type VaultContext } from './scope';
import { getMediaItem, listMediaItems, type MediaItem } from './media-repo';
import { decryptField, encryptField, padToBucket, unpad } from '../crypto/fields';

/** ~26 uuids per bucket, so album size is only visible to that resolution. */
const ITEMS_BUCKET = 1024;
const NAME_BUCKET = 64;

/** SQLite's default parameter ceiling is 999; stay well under it. */
const ID_CHUNK = 400;

export interface Album {
  id: string;
  name: string;
  /** Ordered. May contain ids whose media row is gone; see pruneAlbums. */
  itemIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AlbumSummary {
  id: string;
  name: string;
  /** Live, owned items only — dangling ids are not counted. */
  itemCount: number;
  coverItemId: string | null;
  updatedAt: number;
}

interface AlbumRow extends TaggedRow {
  id: string;
  name_enc: Uint8Array;
  items_enc: Uint8Array;
  created_at: number;
  updated_at: number;
}

function decode(ctx: VaultContext, row: AlbumRow): Album {
  return {
    id: row.id,
    name: unpad(decryptField(ctx.dbKey, 'albums', row.id, 'name', row.name_enc)),
    itemIds: JSON.parse(unpad(decryptField(ctx.dbKey, 'albums', row.id, 'items', row.items_enc))) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function encodeName(ctx: VaultContext, id: string, name: string): Uint8Array {
  return encryptField(ctx.dbKey, 'albums', id, 'name', padToBucket(name, NAME_BUCKET));
}

function encodeItems(ctx: VaultContext, id: string, itemIds: readonly string[]): Uint8Array {
  return encryptField(ctx.dbKey, 'albums', id, 'items', padToBucket(JSON.stringify(itemIds), ITEMS_BUCKET));
}

async function ownedAlbumRows(ctx: VaultContext): Promise<AlbumRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<AlbumRow>('SELECT * FROM albums ORDER BY updated_at DESC');
  // Filter BEFORE decrypting: decrypting a foreign name with this session's
  // dbKey throws IntegrityError and would take down the whole list the moment
  // the other vault has one album.
  return ownedRows(ctx, rows);
}

export async function createAlbum(ctx: VaultContext, name: string): Promise<Album> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = Date.now();
  await db.runAsync(
    'INSERT INTO albums (id, name_enc, items_enc, created_at, updated_at, vault_tag) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    encodeName(ctx, id, name),
    encodeItems(ctx, id, []),
    now,
    now,
    tagFor(ctx, id),
  );
  return { id, name, itemIds: [], createdAt: now, updatedAt: now };
}

export async function renameAlbum(ctx: VaultContext, id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE albums SET name_enc = ?, updated_at = ? WHERE id = ? AND vault_tag = ?',
    encodeName(ctx, id, name),
    Date.now(),
    id,
    tagFor(ctx, id),
  );
}

/** Deletes the album only. Media is never touched. */
export async function deleteAlbum(ctx: VaultContext, id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM albums WHERE id = ? AND vault_tag = ?', id, tagFor(ctx, id));
}

export async function getAlbum(ctx: VaultContext, id: string): Promise<Album | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<AlbumRow>('SELECT * FROM albums WHERE id = ?', id);
  return row && owns(ctx, row) ? decode(ctx, row) : null;
}

export async function listAlbums(ctx: VaultContext): Promise<Album[]> {
  return (await ownedAlbumRows(ctx)).map((row) => decode(ctx, row));
}

/**
 * Album list for the UI. Pass the gallery's already-loaded ids to avoid a
 * second scan of media_items.
 */
export async function listAlbumSummaries(
  ctx: VaultContext,
  liveIds?: ReadonlySet<string>,
): Promise<AlbumSummary[]> {
  const live = liveIds ?? new Set((await listMediaItems(ctx)).map((item) => item.id));
  return (await ownedAlbumRows(ctx)).map((row) => {
    const album = decode(ctx, row);
    const present = album.itemIds.filter((itemId) => live.has(itemId));
    return {
      id: album.id,
      name: album.name,
      itemCount: present.length,
      coverItemId: present[0] ?? null,
      updatedAt: album.updatedAt,
    };
  });
}

async function writeItems(ctx: VaultContext, album: Album, itemIds: string[]): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE albums SET items_enc = ?, updated_at = ? WHERE id = ? AND vault_tag = ?',
    encodeItems(ctx, album.id, itemIds),
    Date.now(),
    album.id,
    tagFor(ctx, album.id),
  );
}

/** Adds in one row write, however many ids. Foreign ids are rejected. */
export async function addItemsToAlbum(ctx: VaultContext, albumId: string, mediaIds: string[]): Promise<void> {
  const album = await getAlbum(ctx, albumId);
  if (!album) return;

  // Validate ownership at write time as well as read time: an id from the
  // other vault must never reach the list in the first place.
  const owned: string[] = [];
  for (const mediaId of mediaIds) {
    if (album.itemIds.includes(mediaId) || owned.includes(mediaId)) continue;
    if (await getMediaItem(ctx, mediaId)) owned.push(mediaId);
  }
  if (owned.length === 0) return;

  await writeItems(ctx, album, [...album.itemIds, ...owned]);
}

export async function removeItemsFromAlbum(ctx: VaultContext, albumId: string, mediaIds: string[]): Promise<void> {
  const album = await getAlbum(ctx, albumId);
  if (!album) return;
  const remove = new Set(mediaIds);
  await writeItems(ctx, album, album.itemIds.filter((id) => !remove.has(id)));
}

/** Replaces membership wholesale — used for reordering. */
export async function setAlbumItems(ctx: VaultContext, albumId: string, mediaIds: string[]): Promise<void> {
  const album = await getAlbum(ctx, albumId);
  if (!album) return;
  const keep = new Set(album.itemIds);
  await writeItems(ctx, album, mediaIds.filter((id) => keep.has(id)));
}

/** The album's media, in album order, owned and still present. */
export async function listAlbumItems(ctx: VaultContext, albumId: string): Promise<MediaItem[]> {
  const album = await getAlbum(ctx, albumId);
  if (!album || album.itemIds.length === 0) return [];

  const db = await getDb();
  const found = new Map<string, MediaItem>();
  for (let at = 0; at < album.itemIds.length; at += ID_CHUNK) {
    const chunk = album.itemIds.slice(at, at + ID_CHUNK);
    const rows = await db.getAllAsync<{ id: string; vault_tag: Uint8Array | null }>(
      `SELECT * FROM media_items WHERE id IN (${chunk.map(() => '?').join(',')})`,
      ...chunk,
    );
    for (const row of ownedRows(ctx, rows)) {
      const item = await getMediaItem(ctx, row.id);
      if (item) found.set(item.id, item);
    }
  }
  // Album order, not query order.
  return album.itemIds.map((id) => found.get(id)).filter((item): item is MediaItem => item !== undefined);
}

export async function albumsContaining(ctx: VaultContext, mediaId: string): Promise<AlbumSummary[]> {
  const all = await listAlbumSummaries(ctx);
  const rows = await ownedAlbumRows(ctx);
  const holding = new Set(
    rows.map((row) => decode(ctx, row)).filter((album) => album.itemIds.includes(mediaId)).map((a) => a.id),
  );
  return all.filter((summary) => holding.has(summary.id));
}

/** Drops ids whose media no longer exists. Returns the number of rows rewritten. */
export async function pruneAlbums(ctx: VaultContext): Promise<number> {
  const live = new Set((await listMediaItems(ctx)).map((item) => item.id));
  let rewritten = 0;
  for (const row of await ownedAlbumRows(ctx)) {
    const album = decode(ctx, row);
    const kept = album.itemIds.filter((id) => live.has(id));
    if (kept.length === album.itemIds.length) continue;
    await writeItems(ctx, album, kept);
    rewritten++;
  }
  return rewritten;
}

/** Deletes every album belonging to this vault, leaving the other one alone. */
export async function deleteAllAlbumsOf(ctx: VaultContext): Promise<void> {
  const owned = await ownedAlbumRows(ctx);
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const row of owned) {
      await db.runAsync('DELETE FROM albums WHERE id = ?', row.id);
    }
  });
}
