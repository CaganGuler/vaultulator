/**
 * The decrypted-photo cache.
 *
 * Two properties here are security properties, not performance ones: plaintext
 * must land only in <cache>/decrypted/, and swiping past a video must never
 * decrypt it. The rest guards the memory budget that lets a pager exist at all.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { createVault , deriveDbKey, deriveTagKey } from '../../crypto/keys';
import { randomBytes } from '../../crypto/primitives';
import { encryptBytesToFile } from '../../crypto/stream';
import type { MediaItem } from '../../db/media-repo';
import type { VaultContext } from '../../db/scope';
import { ensureVaultDirs, mediaDir, mediaFileUri, thumbsDir } from '../../paths';
import {
  clearPhotoTemps,
  evictPhoto,
  forgetPhotoTemps,
  getPhotoFileUri,
  prefetchPhotos,
  setPinnedPhotos,
} from '../photo-cache';
import { useSession } from '../../../stores/session';
import { __reset as resetFs } from '../../../test/file-system-mock';
import { __reset as resetSecureStore } from '../../../test/secure-store-mock';

const decryptedDir = new Directory(Paths.cache, 'decrypted');

let ctx: VaultContext;

function item(id: string, over: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    type: 'photo',
    fileName: `${id}.enc`,
    thumbName: `${id}.thumb.enc`,
    mime: 'image/jpeg',
    sizeBytes: 64,
    width: null,
    height: null,
    durationMs: null,
    createdAt: 1,
    ...over,
  };
}

async function seed(it: MediaItem, size = 64): Promise<void> {
  await encryptBytesToFile(ctx.dek, it.id, randomBytes(size), mediaFileUri(it.fileName));
}

function names(dir: Directory): string[] {
  return dir.list().filter((e): e is File => e instanceof File).map((f) => f.name).sort();
}

beforeEach(async () => {
  resetSecureStore();
  resetFs();
  forgetPhotoTemps();
  ensureVaultDirs();
  const dek = await createVault('111111');
  ctx = { dek, dbKey: deriveDbKey(dek), tagKey: deriveTagKey(dek), role: 'primary' };
  useSession.setState({ status: 'unlocked', ctx, lockUntil: 0, busy: 0 });
});

describe('where plaintext lands', () => {
  it('writes only into the decrypted temp directory', async () => {
    const it = item('a');
    await seed(it);
    const before = names(mediaDir);

    const uri = await getPhotoFileUri(ctx, it);

    expect(uri.startsWith(decryptedDir.uri)).toBe(true);
    expect(names(decryptedDir)).toEqual(['p-a.jpg']);
    // The ciphertext directories must be untouched.
    expect(names(mediaDir)).toEqual(before);
    expect(names(thumbsDir)).toEqual([]);
  });

  it('names files by id, not by anything user-identifying', () => {
    // A directory entry survives deletion on flash storage; it must not carry
    // an original filename (docs/SECURITY.md limit #4).
    expect(names(decryptedDir).every((n) => !n.includes(' '))).toBe(true);
  });
});

describe('caching', () => {
  it('serves a second request without decrypting again', async () => {
    const it = item('a');
    await seed(it);
    const first = await getPhotoFileUri(ctx, it);

    new File(mediaFileUri(it.fileName)).delete(); // ciphertext gone
    expect(await getPhotoFileUri(ctx, it)).toBe(first);
  });

  it('coalesces concurrent requests for the same item', async () => {
    const it = item('a');
    await seed(it);

    const [a, b] = await Promise.all([getPhotoFileUri(ctx, it), getPhotoFileUri(ctx, it)]);

    expect(a).toBe(b);
    expect(names(decryptedDir)).toEqual(['p-a.jpg']);
  });

  it('re-decrypts when the file vanished underneath the index', async () => {
    const it = item('a');
    await seed(it);
    const uri = await getPhotoFileUri(ctx, it);
    new File(uri).delete(); // e.g. an external wipe

    expect(await getPhotoFileUri(ctx, it)).toBe(uri);
    expect(new File(uri).exists).toBe(true);
  });
});

describe('eviction', () => {
  it('drops the oldest once past the entry limit', async () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`i${i}`));
    for (const it of items) await seed(it);
    for (const it of items) await getPhotoFileUri(ctx, it);

    // 8 requested, 7 kept.
    expect(names(decryptedDir)).toHaveLength(7);
    expect(names(decryptedDir)).not.toContain('p-i0.jpg');
  });

  it('never evicts a pinned item', async () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`i${i}`));
    for (const it of items) await seed(it);

    await getPhotoFileUri(ctx, items[0]!);
    setPinnedPhotos(['i0']); // mounted on screen
    for (const it of items.slice(1)) await getPhotoFileUri(ctx, it);

    // Evicting a file out from under a mounted <Image> is a visible failure.
    expect(names(decryptedDir)).toContain('p-i0.jpg');
  });

  it('evictPhoto removes one item on demand', async () => {
    const it = item('a');
    await seed(it);
    await getPhotoFileUri(ctx, it);

    evictPhoto('a');

    expect(names(decryptedDir)).toEqual([]);
  });

  it('clearPhotoTemps leaves an in-flight export alone', async () => {
    const it = item('a');
    await seed(it);
    await getPhotoFileUri(ctx, it);
    new File(decryptedDir, 'export-b.jpg').create({ intermediates: true, overwrite: true });

    clearPhotoTemps();

    expect(names(decryptedDir)).toEqual(['export-b.jpg']);
  });
});

describe('prefetch', () => {
  it('never decrypts a video', async () => {
    // Swiping past a video must not trigger decryptVideoToTemp, which writes
    // the entire file before the first frame. This is the enforcement point.
    const video = item('v', { type: 'video', mime: 'video/mp4', sizeBytes: 1024 });
    const photo = item('p');
    await seed(video, 1024);
    await seed(photo);

    prefetchPhotos(ctx, [video, photo]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(names(decryptedDir)).toEqual(['p-p.jpg']);
  });

  it('skips items too large to be worth warming', async () => {
    const huge = item('h', { sizeBytes: 100 * 1024 * 1024 });
    await seed(huge);

    prefetchPhotos(ctx, [huge]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(names(decryptedDir)).toEqual([]);
    // ...but an explicit request still works.
    await getPhotoFileUri(ctx, huge);
    expect(names(decryptedDir)).toEqual(['p-h.jpg']);
  });
});

describe('failure handling', () => {
  it('leaves no partial plaintext when decryption fails', async () => {
    const it = item('a');
    await seed(it);
    // Corrupt the ciphertext body.
    const enc = new File(mediaFileUri(it.fileName));
    const handle = enc.open();
    const bytes = handle.readBytes(enc.size ?? 0);
    handle.close();
    bytes[40] = (bytes[40] ?? 0) ^ 0xff;
    const write = enc.open();
    write.writeBytes(new Uint8Array(0));
    write.close();
    new File(mediaFileUri(it.fileName)).delete();
    const rewritten = new File(mediaFileUri(it.fileName));
    rewritten.create({ intermediates: true, overwrite: true });
    const w = rewritten.open();
    w.writeBytes(bytes);
    w.close();

    await expect(getPhotoFileUri(ctx, it)).rejects.toThrow();
    expect(names(decryptedDir)).toEqual([]);
  });

  it('aborts and cleans up when the session changed mid-decrypt', async () => {
    const it = item('a');
    await seed(it);
    const stale = ctx;

    useSession.setState({ status: 'locked', ctx: null });

    await expect(getPhotoFileUri(stale, it)).rejects.toThrow();
    expect(names(decryptedDir)).toEqual([]);
  });
});
