/**
 * Cross-vault isolation.
 *
 * Every exported content query must return only the calling vault's rows. A
 * miss here is not a cosmetic bug — it shows a coercer the real vault, which is
 * the exact failure the honeypot exists to prevent.
 *
 * Backed by real SQLite (node:sqlite), so the v1→v2 migration, BLOB tags and
 * transaction rollback all behave the way they will on device.
 */
import { createVault, deriveDbKey, deriveTagKey, enableDecoy } from '../../crypto/keys';
import { backfillRowTags, hasUntaggedRows } from '../backfill';
import { getDb, destroyDb } from '../connection';
import {
  deleteAllMediaOf,
  deleteMediaItem,
  getMediaItem,
  getVaultStats,
  insertMediaItem,
  listAllReferencedFiles,
  listMediaItems,
  type MediaItem,
} from '../media-repo';
import { countNotes, createNote, deleteAllNotesOf, deleteNote, getNote, listNotes, updateNote } from '../notes-repo';
import type { VaultContext } from '../scope';
import { __reset as resetSecureStore } from '../../../test/secure-store-mock';
import { __reset as resetSqlite } from '../../../test/expo-sqlite-node-shim';

function ctxFor(dek: Uint8Array, role: VaultContext['role']): VaultContext {
  return { dek, dbKey: deriveDbKey(dek), tagKey: deriveTagKey(dek), role };
}

let primary: VaultContext;
let decoy: VaultContext;

function mediaItem(id: string, over: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    type: 'photo',
    fileName: `${id}.enc`,
    thumbName: `${id}.thumb.enc`,
    mime: 'image/jpeg',
    sizeBytes: 1000,
    width: 100,
    height: 100,
    durationMs: null,
    createdAt: 1,
    ...over,
  };
}

beforeEach(async () => {
  resetSecureStore();
  resetSqlite();
  await destroyDb();
  const primaryDek = await createVault('111111');
  const decoyDek = await enableDecoy(primaryDek, '222222');
  primary = ctxFor(primaryDek, 'primary');
  decoy = ctxFor(decoyDek, 'decoy');
});

describe('media isolation', () => {
  beforeEach(async () => {
    await insertMediaItem(primary, mediaItem('p1', { sizeBytes: 500 }));
    await insertMediaItem(primary, mediaItem('p2', { type: 'video', sizeBytes: 2000 }));
    await insertMediaItem(decoy, mediaItem('d1', { sizeBytes: 7 }));
  });

  it('lists only the calling vault’s items', async () => {
    expect((await listMediaItems(primary)).map((i) => i.id).sort()).toEqual(['p1', 'p2']);
    expect((await listMediaItems(decoy)).map((i) => i.id)).toEqual(['d1']);
  });

  it('fails closed on a foreign id from a navigation param', async () => {
    expect(await getMediaItem(decoy, 'p1')).toBeNull();
    expect(await getMediaItem(primary, 'd1')).toBeNull();
    expect((await getMediaItem(primary, 'p1'))?.id).toBe('p1');
  });

  it('refuses to delete a foreign item', async () => {
    await deleteMediaItem(decoy, mediaItem('p1'));
    expect((await listMediaItems(primary)).map((i) => i.id).sort()).toEqual(['p1', 'p2']);
  });

  it('reports per-vault stats, never the combined total', async () => {
    expect(await getVaultStats(primary)).toEqual({
      photoCount: 1,
      videoCount: 1,
      documentCount: 0,
      totalBytes: 2500,
      bytesByType: { photo: 500, video: 2000, document: 0 },
    });
    expect(await getVaultStats(decoy)).toEqual({
      photoCount: 1,
      videoCount: 0,
      documentCount: 0,
      totalBytes: 7,
      bytesByType: { photo: 7, video: 0, document: 0 },
    });
  });

  it('counts documents as documents, not as videos', async () => {
    // getVaultStats used to be `if photo ... else videoCount++`.
    await insertMediaItem(primary, mediaItem('d', { type: 'document', mime: 'application/pdf', sizeBytes: 90 }));

    const stats = await getVaultStats(primary);
    expect(stats.documentCount).toBe(1);
    expect(stats.videoCount).toBe(1);
    expect(stats.bytesByType.document).toBe(90);
  });

  it('wipes only the calling vault’s rows', async () => {
    await deleteAllMediaOf(decoy);
    expect(await listMediaItems(decoy)).toEqual([]);
    expect((await listMediaItems(primary)).map((i) => i.id).sort()).toEqual(['p1', 'p2']);
  });

  it('reports files referenced by BOTH vaults to the orphan sweeper', async () => {
    const referenced = await listAllReferencedFiles();
    expect([...referenced.media].sort()).toEqual(['d1.enc', 'p1.enc', 'p2.enc']);
    expect([...referenced.thumbs].sort()).toEqual(['d1.thumb.enc', 'p1.thumb.enc', 'p2.thumb.enc']);
  });
});

describe('note isolation', () => {
  it('does not throw when the other vault has notes', async () => {
    // Decrypting a foreign title with this dbKey raises IntegrityError, so an
    // unfiltered listNotes would take down the whole screen.
    await createNote(primary, 'gerçek', 'içerik');
    await createNote(decoy, 'yem', 'içerik');

    expect((await listNotes(primary)).map((n) => n.title)).toEqual(['gerçek']);
    expect((await listNotes(decoy)).map((n) => n.title)).toEqual(['yem']);
  });

  it('counts only the calling vault’s notes', async () => {
    await createNote(primary, 'a', '');
    await createNote(primary, 'b', '');
    await createNote(decoy, 'c', '');
    expect(await countNotes(primary)).toBe(2);
    expect(await countNotes(decoy)).toBe(1);
  });

  it('fails closed reading a foreign note', async () => {
    const note = await createNote(primary, 'gizli', 'gövde');
    expect(await getNote(decoy, note.id)).toBeNull();
    expect((await getNote(primary, note.id))?.body).toBe('gövde');
  });

  it('refuses to update or delete a foreign note', async () => {
    const note = await createNote(primary, 'gizli', 'gövde');

    await updateNote(decoy, note.id, 'ele geçirildi', 'ele geçirildi');
    expect((await getNote(primary, note.id))?.title).toBe('gizli');

    await deleteNote(decoy, note.id);
    expect(await getNote(primary, note.id)).not.toBeNull();
  });

  it('wipes only the calling vault’s notes', async () => {
    await createNote(primary, 'kalsın', '');
    await createNote(decoy, 'gitsin', '');
    await deleteAllNotesOf(decoy);
    expect(await countNotes(decoy)).toBe(0);
    expect(await countNotes(primary)).toBe(1);
  });
});

describe('schema v2 backfill', () => {
  /** Writes rows the way v1 did: no vault_tag at all. */
  async function insertUntagged(): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO media_items (id, type, file_name, thumb_name, mime, size_bytes, width, height, duration_ms, created_at)
       VALUES ('old1', 'photo', 'old1.enc', NULL, 'image/jpeg', 42, NULL, NULL, NULL, 1)`,
    );
    await db.runAsync(
      `INSERT INTO notes (id, title_enc, body_enc, created_at, updated_at) VALUES ('oldn', ?, ?, 1, 1)`,
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
    );
  }

  it('claims pre-v2 rows for the primary vault', async () => {
    await insertUntagged();
    expect(await hasUntaggedRows()).toBe(true);
    expect(await listMediaItems(primary)).toEqual([]); // invisible until backfilled

    await backfillRowTags(primary);

    expect(await hasUntaggedRows()).toBe(false);
    expect((await listMediaItems(primary)).map((i) => i.id)).toEqual(['old1']);
    expect(await countNotes(primary)).toBe(1);
    // ...and the decoy never sees them.
    expect(await listMediaItems(decoy)).toEqual([]);
    expect(await countNotes(decoy)).toBe(0);
  });

  it('is idempotent', async () => {
    await insertUntagged();
    await backfillRowTags(primary);
    await backfillRowTags(primary);
    expect((await listMediaItems(primary)).map((i) => i.id)).toEqual(['old1']);
  });

  it('never lets a decoy session claim legacy rows', async () => {
    await insertUntagged();
    await backfillRowTags(decoy);
    expect(await hasUntaggedRows()).toBe(true);
    expect(await listMediaItems(decoy)).toEqual([]);
  });

  it('leaves rows retryable when the transaction rolls back', async () => {
    await insertUntagged();
    const db = await getDb();
    const realRun = db.runAsync.bind(db);
    jest.spyOn(db, 'runAsync').mockImplementation(((sql: string, ...params: unknown[]) => {
      if (sql.startsWith('UPDATE notes')) throw new Error('boom');
      return realRun(sql, ...(params as never[]));
    }) as typeof db.runAsync);

    await expect(backfillRowTags(primary)).rejects.toThrow('boom');
    jest.restoreAllMocks();

    // The media UPDATE rolled back with the notes one — nothing half-applied.
    expect(await hasUntaggedRows()).toBe(true);
    await backfillRowTags(primary);
    expect(await hasUntaggedRows()).toBe(false);
    expect((await listMediaItems(primary)).map((i) => i.id)).toEqual(['old1']);
  });
});
