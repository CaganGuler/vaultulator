import { getDb } from './connection';
import { ownedRows, owns, tagFor, type TaggedRow, type VaultContext } from './scope';
import { decryptField, encryptField, padToBucket, unpad } from '../crypto/fields';
import { evictThumb } from '../media/viewer-cache';
import { deleteIfExists, mediaFileUri, thumbFileUri } from '../paths';

export type MediaType = 'photo' | 'video' | 'document';

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
  caption_enc: Uint8Array | null;
  orig_name_enc: Uint8Array | null;
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

export interface MediaExtras {
  /** The file's name where it came from. User-identifying, so encrypted. */
  originalName?: string;
  caption?: string;
}

export async function insertMediaItem(ctx: VaultContext, item: MediaItem, extras: MediaExtras = {}): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO media_items (id, type, file_name, thumb_name, mime, size_bytes, width, height, duration_ms, created_at, vault_tag, caption_enc, orig_name_enc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    // Always written, even when empty: a NULL-versus-blob distinction would
    // be a free "this item has a caption" bit for anyone reading the file.
    encodeText(ctx, item.id, 'caption', extras.caption ?? ''),
    encodeText(ctx, item.id, 'orig_name', extras.originalName ?? ''),
  );
}

const TEXT_BUCKET = 64;

function encodeText(ctx: VaultContext, id: string, column: string, value: string): Uint8Array {
  return encryptField(ctx.dbKey, 'media_items', id, column, padToBucket(value, TEXT_BUCKET));
}

function decodeText(ctx: VaultContext, id: string, column: string, blob: Uint8Array | null): string {
  if (!blob) return ''; // pre-v3 row
  return unpad(decryptField(ctx.dbKey, 'media_items', id, column, blob));
}

/** Decrypts one item's caption and original filename. Not done in list queries. */
export async function getMediaText(
  ctx: VaultContext,
  id: string,
): Promise<{ caption: string; originalName: string } | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<MediaRow>('SELECT * FROM media_items WHERE id = ?', id);
  if (!row || !owns(ctx, row)) return null;
  return {
    caption: decodeText(ctx, id, 'caption', row.caption_enc),
    originalName: decodeText(ctx, id, 'orig_name', row.orig_name_enc),
  };
}

export async function setCaption(ctx: VaultContext, id: string, caption: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE media_items SET caption_enc = ? WHERE id = ? AND vault_tag = ?',
    encodeText(ctx, id, 'caption', caption),
    id,
    tagFor(ctx, id),
  );
}

let cachedIndex: Map<string, string> | null = null;

/** Drops the in-memory plaintext captions. Called from lock(). */
export function clearCaptionIndex(): void {
  cachedIndex?.clear();
  cachedIndex = null;
}

/**
 * Every owned caption, decrypted once.
 *
 * Called when the search field opens, not per keystroke: listMediaItems is the
 * gallery's hot path and currently does zero crypto over ~2000 rows, which is
 * worth keeping.
 */
export async function loadCaptionIndex(ctx: VaultContext): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<MediaRow>('SELECT id, vault_tag, caption_enc FROM media_items');
  const index = new Map<string, string>();
  for (const row of ownedRows(ctx, rows)) {
    const caption = decodeText(ctx, row.id, 'caption', row.caption_enc);
    if (caption) index.set(row.id, caption);
  }
  cachedIndex = index;
  return index;
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
  evictThumb(item.id); // otherwise the decrypted thumbnail lingers until lock
  deleteIfExists(mediaFileUri(item.fileName));
  if (item.thumbName) deleteIfExists(thumbFileUri(item.thumbName));
}

export interface VaultStats {
  photoCount: number;
  videoCount: number;
  documentCount: number;
  totalBytes: number;
  /** Bytes per type, for the storage breakdown in settings. */
  bytesByType: Record<MediaType, number>;
}

/**
 * Aggregated in JS rather than SQL: a `SUM()` over the whole table would show
 * a decoy session the combined size of both vaults.
 */
export async function getVaultStats(ctx: VaultContext): Promise<VaultStats> {
  const db = await getDb();
  const rows = await db.getAllAsync<MediaRow>('SELECT id, type, size_bytes, vault_tag FROM media_items');
  const stats: VaultStats = {
    photoCount: 0,
    videoCount: 0,
    documentCount: 0,
    totalBytes: 0,
    bytesByType: { photo: 0, video: 0, document: 0 },
  };
  for (const row of ownedRows(ctx, rows)) {
    // Was `else videoCount++`, which would have silently counted every
    // document as a video.
    if (row.type === 'photo') stats.photoCount++;
    else if (row.type === 'video') stats.videoCount++;
    else stats.documentCount++;
    stats.bytesByType[row.type] += row.size_bytes;
    stats.totalBytes += row.size_bytes;
  }
  return stats;
}

/** Deletes every row and file belonging to this vault, leaving the other one alone. */
export async function deleteAllMediaOf(ctx: VaultContext): Promise<void> {
  const owned = await listMediaItems(ctx);
  for (const item of owned) evictThumb(item.id);
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
