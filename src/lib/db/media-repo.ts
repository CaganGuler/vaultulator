import { getDb } from './connection';
import { ownedRows, owns, tagFor, type TaggedRow, type VaultContext } from './scope';
import { deleteIfExists, mediaFileUri, thumbFileUri } from '../paths';

export type MediaType = 'photo' | 'video';

export interface MediaItem {
  id: string;
  type: MediaType;
  fileName: string;
  thumbName: string | null;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  createdAt: number;
}

interface MediaRow extends TaggedRow {
  id: string;
  type: MediaType;
  file_name: string;
  thumb_name: string | null;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  created_at: number;
}

function fromRow(row: MediaRow): MediaItem {
  return {
    id: row.id,
    type: row.type,
    fileName: row.file_name,
    thumbName: row.thumb_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

export async function insertMediaItem(ctx: VaultContext, item: MediaItem): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO media_items (id, type, file_name, thumb_name, mime, size_bytes, width, height, duration_ms, created_at, vault_tag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id,
    item.type,
    item.fileName,
    item.thumbName,
    item.mime,
    item.sizeBytes,
    item.width,
    item.height,
    item.durationMs,
    item.createdAt,
    tagFor(ctx, item.id),
  );
}

export async function listMediaItems(ctx: VaultContext): Promise<MediaItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MediaRow>('SELECT * FROM media_items ORDER BY created_at DESC');
  return ownedRows(ctx, rows).map(fromRow);
}

export async function getMediaItem(ctx: VaultContext, id: string): Promise<MediaItem | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<MediaRow>('SELECT * FROM media_items WHERE id = ?', id);
  // The id arrives from a navigation param, so fail closed on a foreign row.
  return row && owns(ctx, row) ? fromRow(row) : null;
}

/** Deletes the DB row and both encrypted files. No-op for a foreign item. */
export async function deleteMediaItem(ctx: VaultContext, item: MediaItem): Promise<void> {
  const db = await getDb();
  const result = await db.runAsync('DELETE FROM media_items WHERE id = ? AND vault_tag = ?', item.id, tagFor(ctx, item.id));
  if (result.changes === 0) return;
  deleteIfExists(mediaFileUri(item.fileName));
  if (item.thumbName) deleteIfExists(thumbFileUri(item.thumbName));
}

export interface VaultStats {
  photoCount: number;
  videoCount: number;
  totalBytes: number;
}

/**
 * Aggregated in JS rather than SQL: a `SUM()` over the whole table would show
 * a decoy session the combined size of both vaults.
 */
export async function getVaultStats(ctx: VaultContext): Promise<VaultStats> {
  const db = await getDb();
  const rows = await db.getAllAsync<MediaRow>('SELECT id, type, size_bytes, vault_tag FROM media_items');
  const stats: VaultStats = { photoCount: 0, videoCount: 0, totalBytes: 0 };
  for (const row of ownedRows(ctx, rows)) {
    if (row.type === 'photo') stats.photoCount++;
    else stats.videoCount++;
    stats.totalBytes += row.size_bytes;
  }
  return stats;
}

/** Deletes every row and file belonging to this vault, leaving the other one alone. */
export async function deleteAllMediaOf(ctx: VaultContext): Promise<void> {
  const owned = await listMediaItems(ctx);
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const item of owned) {
      await db.runAsync('DELETE FROM media_items WHERE id = ?', item.id);
    }
  });
  // Files after rows: a crash leaves orphans (invisible, swept later) rather
  // than rows pointing at files that no longer exist.
  for (const item of owned) {
    deleteIfExists(mediaFileUri(item.fileName));
    if (item.thumbName) deleteIfExists(thumbFileUri(item.thumbName));
  }
}

/**
 * Every file name referenced by ANY vault. The one legitimately unscoped query:
 * the orphan sweeper needs to know what is still in use before deleting.
 */
export async function listAllReferencedFiles(): Promise<{ media: Set<string>; thumbs: Set<string> }> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ file_name: string; thumb_name: string | null }>(
    'SELECT file_name, thumb_name FROM media_items',
  );
  const media = new Set<string>();
  const thumbs = new Set<string>();
  for (const row of rows) {
    media.add(row.file_name);
    if (row.thumb_name) thumbs.add(row.thumb_name);
  }
  return { media, thumbs };
}
