/**
 * Albums: cross-vault isolation and membership behaviour.
 *
 * Membership lives inside the album row as an encrypted id list rather than a
 * join table, so the isolation story is the same one every other table uses —
 * the per-row tag — plus field encryption bound to the row and column.
 */
import { encryptField, padToBucket } from '../../crypto/fields';
import { createVault, deriveDbKey, deriveTagKey, enableDecoy } from '../../crypto/keys';
import {
  addItemsToAlbum,
  albumsContaining,
  createAlbum,
  deleteAlbum,
  deleteAllAlbumsOf,
  getAlbum,
  listAlbumItems,
  listAlbums,
  listAlbumSummaries,
  pruneAlbums,
  removeItemsFromAlbum,
  renameAlbum,
  setAlbumItems,
} from '../albums-repo';
import { getDb, destroyDb } from '../connection';
import {
  deleteMediaItem,
  getMediaText,
  insertMediaItem,
  listMediaItems,
  loadCaptionIndex,
  setCaption,
  type MediaItem,
} from '../media-repo';
import { tagFor, type VaultContext } from '../scope';
import { __reset as resetSecureStore } from '../../../test/secure-store-mock';
import { __reset as resetSqlite } from '../../../test/expo-sqlite-node-shim';

let primary: VaultContext;
let decoy: VaultContext;

function ctxFor(dek: Uint8Array, role: VaultContext['role']): VaultContext {
  return { dek, dbKey: deriveDbKey(dek), tagKey: deriveTagKey(dek), role };
}

function media(id: string, over: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    type: 'photo',
    fileName: `${id}.enc`,
    thumbName: null,
    mime: 'image/jpeg',
    sizeBytes: 10,
    width: null,
    height: null,
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

describe('isolation', () => {
  it('lists only the calling vault’s albums', async () => {
    await createAlbum(primary, 'Gerçek');
    await createAlbum(decoy, 'Yem');

    expect((await listAlbums(primary)).map((a) => a.name)).toEqual(['Gerçek']);
    expect((await listAlbums(decoy)).map((a) => a.name)).toEqual(['Yem']);
  });

  it('does not throw when the other vault has albums', async () => {
    // Decrypting a foreign name_enc with this dbKey raises IntegrityError, so
    // filtering must happen before decryption or the whole list goes down.
    for (let i = 0; i < 3; i++) await createAlbum(primary, `P${i}`);
    await createAlbum(decoy, 'Yem');

    await expect(listAlbums(decoy)).resolves.toHaveLength(1);
    await expect(listAlbumSummaries(decoy)).resolves.toHaveLength(1);
  });

  it('fails closed on a foreign album id', async () => {
    const album = await createAlbum(primary, 'Gerçek');
    expect(await getAlbum(decoy, album.id)).toBeNull();
    expect(await listAlbumItems(decoy, album.id)).toEqual([]);
  });

  it('refuses to rename or delete a foreign album', async () => {
    const album = await createAlbum(primary, 'Gerçek');

    await renameAlbum(decoy, album.id, 'ele geçirildi');
    await deleteAlbum(decoy, album.id);

    const still = await getAlbum(primary, album.id);
    expect(still?.name).toBe('Gerçek');
  });

  it('refuses to put a foreign media item into an album', async () => {
    await insertMediaItem(primary, media('p1'));
    const album = await createAlbum(decoy, 'Yem');

    await addItemsToAlbum(decoy, album.id, ['p1']);

    expect((await getAlbum(decoy, album.id))?.itemIds).toEqual([]);
  });

  it('never resolves a foreign id written straight into the row', async () => {
    // Bypass write-time validation to prove read-time filtering also holds.
    await insertMediaItem(primary, media('p1'));
    const album = await createAlbum(decoy, 'Yem');
    await insertMediaItem(decoy, media('d1'));
    await addItemsToAlbum(decoy, album.id, ['d1']);

    // Re-seal a list containing the primary's id, under the decoy's own key so
    // the row still authenticates and only the read-time filter can stop it.
    const db = await getDb();
    await db.runAsync(
      'UPDATE albums SET items_enc = ? WHERE id = ?',
      encryptField(decoy.dbKey, 'albums', album.id, 'items', padToBucket(JSON.stringify(['d1', 'p1']), 1024)),
      album.id,
    );

    expect((await listAlbumItems(decoy, album.id)).map((i) => i.id)).toEqual(['d1']);
    expect((await listAlbumSummaries(decoy))[0]?.itemCount).toBe(1);
  });

  it('wipes only the calling vault’s albums', async () => {
    await createAlbum(primary, 'Gerçek');
    await createAlbum(decoy, 'Yem');

    await deleteAllAlbumsOf(decoy);

    expect(await listAlbums(decoy)).toEqual([]);
    expect(await listAlbums(primary)).toHaveLength(1);
  });
});

describe('membership', () => {
  beforeEach(async () => {
    for (const id of ['a', 'b', 'c']) await insertMediaItem(primary, media(id));
  });

  it('adds, keeps order, and ignores duplicates', async () => {
    const album = await createAlbum(primary, 'Tatil');

    await addItemsToAlbum(primary, album.id, ['c', 'a']);
    await addItemsToAlbum(primary, album.id, ['a', 'b']); // 'a' already there

    expect((await getAlbum(primary, album.id))?.itemIds).toEqual(['c', 'a', 'b']);
    expect((await listAlbumItems(primary, album.id)).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('removes without touching the media', async () => {
    const album = await createAlbum(primary, 'Tatil');
    await addItemsToAlbum(primary, album.id, ['a', 'b']);

    await removeItemsFromAlbum(primary, album.id, ['a']);

    expect((await getAlbum(primary, album.id))?.itemIds).toEqual(['b']);
    expect((await listMediaItems(primary)).map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('reorders through setAlbumItems', async () => {
    const album = await createAlbum(primary, 'Tatil');
    await addItemsToAlbum(primary, album.id, ['a', 'b', 'c']);

    await setAlbumItems(primary, album.id, ['c', 'b', 'a']);

    expect((await getAlbum(primary, album.id))?.itemIds).toEqual(['c', 'b', 'a']);
  });

  it('deleting an album leaves the media alone', async () => {
    const album = await createAlbum(primary, 'Tatil');
    await addItemsToAlbum(primary, album.id, ['a', 'b']);

    await deleteAlbum(primary, album.id);

    expect((await listMediaItems(primary)).map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('skips dangling ids in counts and listings, and prunes on demand', async () => {
    const album = await createAlbum(primary, 'Tatil');
    await addItemsToAlbum(primary, album.id, ['a', 'b']);
    await deleteMediaItem(primary, media('a'));

    expect((await listAlbumSummaries(primary))[0]?.itemCount).toBe(1);
    expect((await listAlbumItems(primary, album.id)).map((i) => i.id)).toEqual(['b']);
    // The id is still in the row until a prune rewrites it.
    expect((await getAlbum(primary, album.id))?.itemIds).toEqual(['a', 'b']);

    expect(await pruneAlbums(primary)).toBe(1);
    expect((await getAlbum(primary, album.id))?.itemIds).toEqual(['b']);
  });

  it('reports which albums hold an item', async () => {
    const one = await createAlbum(primary, 'Bir');
    const two = await createAlbum(primary, 'İki');
    await addItemsToAlbum(primary, one.id, ['a']);
    await addItemsToAlbum(primary, two.id, ['a', 'b']);

    expect((await albumsContaining(primary, 'a')).map((a) => a.name).sort()).toEqual(['Bir', 'İki']);
    expect((await albumsContaining(primary, 'c'))).toEqual([]);
  });
});

describe('stored shape', () => {
  async function blobLengths(id: string): Promise<{ name: number; items: number }> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ name_enc: Uint8Array; items_enc: Uint8Array }>(
      'SELECT name_enc, items_enc FROM albums WHERE id = ?',
      id,
    );
    return { name: row!.name_enc.length, items: row!.items_enc.length };
  }

  it('pads so blob length reveals only a bucket', async () => {
    // Without padding, length(items_enc) would give an imager the album's
    // exact size. GCM adds a fixed 28 bytes (12 IV + 16 tag).
    const album = await createAlbum(primary, 'x');
    for (let i = 0; i < 3; i++) await insertMediaItem(primary, media(`m${i}`));

    const empty = await blobLengths(album.id);
    expect(empty.items).toBe(28 + 1024);
    expect(empty.name).toBe(28 + 64);

    await addItemsToAlbum(primary, album.id, ['m0', 'm1', 'm2']);
    expect((await blobLengths(album.id)).items).toBe(28 + 1024);
  });

  it('stores an empty album as a real blob, not NULL', async () => {
    // NULL versus blob would be a free "is this album empty" bit.
    const album = await createAlbum(primary, 'Boş');
    const db = await getDb();
    const row = await db.getFirstAsync<{ items_enc: unknown }>('SELECT items_enc FROM albums WHERE id = ?', album.id);
    expect(row?.items_enc).not.toBeNull();
    expect((await getAlbum(primary, album.id))?.itemIds).toEqual([]);
  });

  it('tags the row so the generic scoping helper applies', async () => {
    const album = await createAlbum(primary, 'x');
    const db = await getDb();
    const row = await db.getFirstAsync<{ vault_tag: Uint8Array }>('SELECT vault_tag FROM albums WHERE id = ?', album.id);
    expect(Buffer.from(row!.vault_tag)).toEqual(Buffer.from(tagFor(primary, album.id)));
  });
});

describe('field binding', () => {
  it('rejects a name blob moved to another album row', async () => {
    const source = await createAlbum(primary, 'Kaynak');
    const target = await createAlbum(primary, 'Hedef');
    const db = await getDb();
    const row = await db.getFirstAsync<{ name_enc: Uint8Array }>('SELECT name_enc FROM albums WHERE id = ?', source.id);

    await db.runAsync('UPDATE albums SET name_enc = ? WHERE id = ?', row!.name_enc, target.id);

    // The AAD binds the blob to its row, so a copied ciphertext will not open.
    await expect(getAlbum(primary, target.id)).rejects.toThrow();
  });

  it('rejects an items blob moved into the name column', async () => {
    const album = await createAlbum(primary, 'x');
    const db = await getDb();
    const row = await db.getFirstAsync<{ items_enc: Uint8Array }>('SELECT items_enc FROM albums WHERE id = ?', album.id);

    await db.runAsync('UPDATE albums SET name_enc = ? WHERE id = ?', row!.items_enc, album.id);

    // The column is in the AAD too.
    await expect(getAlbum(primary, album.id)).rejects.toThrow();
  });
});

describe('documents and captions', () => {
  it('stores an encrypted caption and original name, scoped per vault', async () => {
    await insertMediaItem(
      primary,
      media('doc', { type: 'document', mime: 'application/pdf', thumbName: null }),
      { originalName: '2024-vergi.pdf' },
    );

    expect(await getMediaText(primary, 'doc')).toEqual({ caption: '', originalName: '2024-vergi.pdf' });
    // A filename identifies the user far more than pixel dimensions do, so the
    // decoy must not be able to read it.
    expect(await getMediaText(decoy, 'doc')).toBeNull();

    await setCaption(primary, 'doc', 'Beyanname');
    expect((await getMediaText(primary, 'doc'))?.caption).toBe('Beyanname');

    // The decoy cannot overwrite it either.
    await setCaption(decoy, 'doc', 'ele geçirildi');
    expect((await getMediaText(primary, 'doc'))?.caption).toBe('Beyanname');

    const index = await loadCaptionIndex(primary);
    expect(index.get('doc')).toBe('Beyanname');
    expect((await loadCaptionIndex(decoy)).size).toBe(0);
  });

  it('writes a padded blob even when there is no caption', async () => {
    // NULL versus blob would be a free "this item has a caption" bit.
    await insertMediaItem(primary, media('plain'));
    const db = await getDb();
    const row = await db.getFirstAsync<{ caption_enc: Uint8Array | null }>(
      'SELECT caption_enc FROM media_items WHERE id = ?',
      'plain',
    );
    expect(row?.caption_enc).not.toBeNull();
    expect(row!.caption_enc!.length).toBe(28 + 64);
  });

  it('treats a pre-v3 row with no caption column as empty, not broken', async () => {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO media_items (id, type, file_name, thumb_name, mime, size_bytes, width, height, duration_ms, created_at, vault_tag)
       VALUES ('legacy', 'photo', 'legacy.enc', NULL, 'image/jpeg', 1, NULL, NULL, NULL, 1, ?)`,
      tagFor(primary, 'legacy'),
    );

    expect(await getMediaText(primary, 'legacy')).toEqual({ caption: '', originalName: '' });
  });
});
