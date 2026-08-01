/**
 * Vault directory layout.
 *
 *   <document>/vault/media/   encrypted originals   (*.enc)
 *   <document>/vault/thumbs/  encrypted thumbnails  (*.enc)
 *   <cache>/decrypted/        TEMP plaintext for video playback/export.
 *                             Wiped on lock, on background-lock and on every
 *                             cold start (covers crashes).
 */
import { Directory, File, Paths } from 'expo-file-system';

export const vaultRoot = new Directory(Paths.document, 'vault');
export const mediaDir = new Directory(Paths.document, 'vault', 'media');
export const thumbsDir = new Directory(Paths.document, 'vault', 'thumbs');
export const decryptedDir = new Directory(Paths.cache, 'decrypted');

function ensureDir(dir: Directory): void {
  if (!dir.exists) dir.create({ intermediates: true });
}

export function ensureVaultDirs(): void {
  ensureDir(mediaDir);
  ensureDir(thumbsDir);
  ensureDir(decryptedDir);
}

export function mediaFileUri(fileName: string): string {
  return new File(mediaDir, fileName).uri;
}

export function thumbFileUri(fileName: string): string {
  return new File(thumbsDir, fileName).uri;
}

export function decryptedFileUri(fileName: string): string {
  return new File(decryptedDir, fileName).uri;
}

export function deleteIfExists(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // best effort — never let temp cleanup crash a user flow
  }
}

/** Removes every decrypted temp file. Called on lock and on cold start. */
export function wipeDecryptedDir(): void {
  try {
    if (decryptedDir.exists) decryptedDir.delete();
  } catch {
    // fall through and recreate regardless
  }
  try {
    decryptedDir.create({ intermediates: true });
  } catch {
    // best effort
  }
}

function fileNamesIn(dir: Directory): string[] {
  try {
    if (!dir.exists) return [];
    return dir.list().filter((entry): entry is File => entry instanceof File).map((file) => file.name);
  } catch {
    return [];
  }
}

/**
 * Deletes every encrypted file no vault references any more.
 *
 * Both vaults share these directories, so "delete what isn't mine" is not a
 * safe rule — only "delete what nobody claims" is. Call from a primary session
 * after a scoped wipe, or to clean up files orphaned by a crash mid-delete.
 */
export function sweepOrphanFiles(referenced: { media: Set<string>; thumbs: Set<string> }): number {
  let removed = 0;
  for (const [dir, keep] of [
    [mediaDir, referenced.media],
    [thumbsDir, referenced.thumbs],
  ] as const) {
    for (const name of fileNamesIn(dir)) {
      if (keep.has(name)) continue;
      deleteIfExists(new File(dir, name).uri);
      removed++;
    }
  }
  return removed;
}

/** Destroys all encrypted content (vault reset). */
export function wipeVaultFiles(): void {
  try {
    if (vaultRoot.exists) vaultRoot.delete();
  } catch {
    // best effort
  }
  wipeDecryptedDir();
  ensureVaultDirs();
}
