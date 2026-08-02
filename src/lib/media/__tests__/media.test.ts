/**
 * Export and the decrypted-content cache.
 *
 * The property that matters for share is that the plaintext temp file is gone
 * afterwards *even when sharing fails* — it lives in <cache>/decrypted/, which
 * invariant #2 says is the only place plaintext may exist, and only briefly.
 */
import { File } from 'expo-file-system';

import { encryptBytesToFile } from '../../crypto/stream';
import { randomBytes } from '../../crypto/primitives';
import type { MediaItem } from '../../db/media-repo';
import { decryptedFileUri, ensureVaultDirs, mediaFileUri, thumbFileUri } from '../../paths';
import { shareMediaItem } from '../share';
import {
  clearThumbCache,
  decryptVideoToTemp,
  deleteDecryptedTemp,
  evictThumb,
  getPhotoDataUri,
  getThumbnailDataUri,
} from '../viewer-cache';
import { __reset as resetFs } from '../../../test/file-system-mock';
import { calls as shareCalls, __failNext as failNextShare, __reset as resetSharing } from '../../../test/expo-sharing-mock';

const dek = new Uint8Array(32).fill(3);

function item(id: string, over: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    type: 'photo',
    fileName: `${id}.enc`,
    thumbName: `${id}.thumb.enc`,
    mime: 'image/jpeg',
    sizeBytes: 32,
    width: null,
    height: null,
    durationMs: null,
    createdAt: 1,
    ...over,
  };
}

async function seed(it: MediaItem, bytes = randomBytes(32)): Promise<Uint8Array> {
  await encryptBytesToFile(dek, it.id, bytes, mediaFileUri(it.fileName));
  if (it.thumbName) await encryptBytesToFile(dek, it.id, bytes, thumbFileUri(it.thumbName));
  return bytes;
}

beforeEach(() => {
  resetFs();
  resetSharing();
  clearThumbCache();
  ensureVaultDirs();
});

describe('shareMediaItem', () => {
  it('decrypts to a temp file, shares it, then deletes it', async () => {
    const it = item('a');
    await seed(it);

    await shareMediaItem(dek, it);

    expect(shareCalls).toHaveLength(1);
    expect(shareCalls[0]?.mimeType).toBe('image/jpeg');
    expect(new File(shareCalls[0]!.uri).exists).toBe(false);
  });

  it('deletes the plaintext even when sharing fails', async () => {
    const it = item('a');
    await seed(it);
    failNextShare();

    await expect(shareMediaItem(dek, it)).rejects.toThrow('user cancelled');

    // The whole point: a cancelled share must not leave plaintext on disk.
    expect(new File(decryptedFileUri('export-a.jpg')).exists).toBe(false);
  });

  it('picks the extension from the media type', async () => {
    const cases = [
      [item('p'), 'jpg'],
      [item('q', { type: 'video', mime: 'video/quicktime' }), 'mov'],
      [item('r', { type: 'video', mime: 'video/mp4' }), 'mp4'],
    ] as const;

    for (const [it, ext] of cases) {
      await seed(it);
      await shareMediaItem(dek, it);
      expect(shareCalls.at(-1)?.uri).toBe(decryptedFileUri(`export-${it.id}.${ext}`));
    }
  });
});

describe('viewer cache', () => {
  it('decrypts a thumbnail into a data URI and serves it from cache', async () => {
    const it = item('a');
    await seed(it);

    const first = await getThumbnailDataUri(dek, it);
    expect(first).toMatch(/^data:image\/jpeg;base64,/);

    // Delete the ciphertext: a second hit must come from memory, not disk.
    new File(thumbFileUri(it.thumbName!)).delete();
    expect(await getThumbnailDataUri(dek, it)).toBe(first);
  });

  it('returns null for an item with no thumbnail', async () => {
    expect(await getThumbnailDataUri(dek, item('a', { thumbName: null }))).toBeNull();
  });

  it('drops a single entry on evict and everything on clear', async () => {
    const it = item('a');
    await seed(it);
    await getThumbnailDataUri(dek, it);

    evictThumb(it.id);
    new File(thumbFileUri(it.thumbName!)).delete();
    // Nothing cached and nothing on disk, so this must now fail rather than
    // quietly serve a stale decrypted copy of a deleted item.
    await expect(getThumbnailDataUri(dek, it)).rejects.toThrow();
  });

  it('serves full-size photos without caching them', async () => {
    const it = item('a');
    await seed(it);

    expect(await getPhotoDataUri(dek, it)).toMatch(/^data:image\/jpeg;base64,/);

    new File(mediaFileUri(it.fileName)).delete();
    await expect(getPhotoDataUri(dek, it)).rejects.toThrow();
  });

  it('writes video plaintext only into the decrypted temp dir', async () => {
    const it = item('v', { type: 'video', mime: 'video/quicktime' });
    await seed(it);

    const tempUri = await decryptVideoToTemp(dek, it);

    expect(tempUri).toBe(decryptedFileUri('v.mov'));
    expect(new File(tempUri).exists).toBe(true);

    deleteDecryptedTemp(tempUri);
    expect(new File(tempUri).exists).toBe(false);
  });
});
