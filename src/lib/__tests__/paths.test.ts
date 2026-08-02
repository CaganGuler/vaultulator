/**
 * Directory hygiene.
 *
 * Two vaults share `vault/media` and `vault/thumbs`, so the sweeper's rule is
 * "delete what nobody claims" — never "delete what isn't mine". Getting that
 * backwards would erase the other vault's content, so it is worth a test that
 * can actually fail.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { __reset as resetFs } from '../../test/file-system-mock';
import {
  deleteIfExists,
  ensureVaultDirs,
  mediaDir,
  mediaFileUri,
  sweepOrphanFiles,
  thumbFileUri,
  thumbsDir,
  wipeDecryptedDir,
  wipeVaultFiles,
} from '../paths';

const decryptedDir = new Directory(Paths.cache, 'decrypted');

function put(uri: string, content = 'x'): void {
  const file = new File(uri);
  file.create({ intermediates: true, overwrite: true });
  const handle = file.open();
  handle.writeBytes(new TextEncoder().encode(content));
  handle.close();
}

function namesIn(dir: Directory): string[] {
  return dir
    .list()
    .filter((e): e is File => e instanceof File)
    .map((f) => f.name)
    .sort();
}

beforeEach(() => {
  resetFs();
  ensureVaultDirs();
});

describe('vault directories', () => {
  it('creates the three directories it owns', () => {
    expect(mediaDir.exists).toBe(true);
    expect(thumbsDir.exists).toBe(true);
    expect(decryptedDir.exists).toBe(true);
  });

  it('deleteIfExists is silent about missing files', () => {
    expect(() => deleteIfExists(mediaFileUri('never-existed.enc'))).not.toThrow();
  });
});

describe('sweepOrphanFiles', () => {
  it('deletes only files no vault references', () => {
    put(mediaFileUri('mine.enc'));
    put(mediaFileUri('theirs.enc'));
    put(mediaFileUri('orphan.enc'));
    put(thumbFileUri('mine.thumb.enc'));
    put(thumbFileUri('orphan.thumb.enc'));

    // Both vaults' files are "referenced" — the sweeper is told the union.
    const removed = sweepOrphanFiles({
      media: new Set(['mine.enc', 'theirs.enc']),
      thumbs: new Set(['mine.thumb.enc']),
    });

    expect(removed).toBe(2);
    expect(namesIn(mediaDir)).toEqual(['mine.enc', 'theirs.enc']);
    expect(namesIn(thumbsDir)).toEqual(['mine.thumb.enc']);
  });

  it('keeps everything when everything is referenced', () => {
    put(mediaFileUri('a.enc'));
    put(mediaFileUri('b.enc'));

    expect(sweepOrphanFiles({ media: new Set(['a.enc', 'b.enc']), thumbs: new Set() })).toBe(0);
    expect(namesIn(mediaDir)).toEqual(['a.enc', 'b.enc']);
  });

  it('removes everything when nothing is referenced', () => {
    put(mediaFileUri('a.enc'));
    put(thumbFileUri('a.thumb.enc'));

    expect(sweepOrphanFiles({ media: new Set(), thumbs: new Set() })).toBe(2);
    expect(namesIn(mediaDir)).toEqual([]);
    expect(namesIn(thumbsDir)).toEqual([]);
  });
});

describe('wipeDecryptedDir', () => {
  it('removes plaintext temp files and reports nothing left behind', () => {
    put(new File(decryptedDir, 'video.mp4').uri, 'plaintext');
    put(new File(decryptedDir, 'export-1.jpg').uri, 'plaintext');

    expect(wipeDecryptedDir()).toEqual([]);
    expect(namesIn(decryptedDir)).toEqual([]);
    // Recreated, so the next decrypt has somewhere to go.
    expect(decryptedDir.exists).toBe(true);
  });

  it('leaves encrypted content alone', () => {
    put(mediaFileUri('keep.enc'));
    put(new File(decryptedDir, 'temp.mp4').uri);

    wipeDecryptedDir();

    expect(namesIn(mediaDir)).toEqual(['keep.enc']);
  });
});

describe('wipeVaultFiles', () => {
  it('destroys all ciphertext and leaves usable empty directories', () => {
    put(mediaFileUri('a.enc'));
    put(thumbFileUri('a.thumb.enc'));
    put(new File(decryptedDir, 'temp.mp4').uri);

    wipeVaultFiles();

    expect(namesIn(mediaDir)).toEqual([]);
    expect(namesIn(thumbsDir)).toEqual([]);
    expect(namesIn(decryptedDir)).toEqual([]);
    expect(mediaDir.exists).toBe(true);
  });
});
