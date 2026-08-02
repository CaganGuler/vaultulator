/**
 * Decrypted-content lifecycle.
 *
 * - Thumbnails are decrypted INTO MEMORY as base64 data URIs and live in a
 *   small LRU. They are 30-60 KB, so the base64 round-trip is fine here.
 *   Full-size photos go through lib/media/photo-cache instead: at megabytes
 *   each, the same approach peaked at several times the file size in JS heap,
 *   which is what invariant #5 forbids.
 * - Videos must be decrypted to a temp file for expo-video playback; those
 *   temp files live in <cache>/decrypted/ and are wiped on lock, on
 *   background-lock and on every cold start (see stores/session.ts).
 */
import type { MediaItem } from '../db/media-repo';
import { base64Encode } from '../base64';
import { decryptFile, decryptFileToBytes, type StreamProgress } from '../crypto/stream';
import { decryptedFileUri, deleteIfExists, mediaFileUri, thumbFileUri } from '../paths';

// ~40 KB each, so 300 is well under 15 MB and covers a long scroll back up.
const THUMB_CACHE_MAX = 300;
const thumbCache = new Map<string, string>(); // itemId → data URI (Map keeps insertion order → LRU)

export function clearThumbCache(): void {
  thumbCache.clear();
}

/** Drops one item's decrypted thumbnail — call when the item is deleted. */
export function evictThumb(itemId: string): void {
  thumbCache.delete(itemId);
}

export async function getThumbnailDataUri(dek: Uint8Array, item: MediaItem): Promise<string | null> {
  if (!item.thumbName) return null;
  const cached = thumbCache.get(item.id);
  if (cached) {
    thumbCache.delete(item.id);
    thumbCache.set(item.id, cached); // refresh LRU position
    return cached;
  }
  const bytes = await decryptFileToBytes(dek, item.id, thumbFileUri(item.thumbName));
  const uri = `data:image/jpeg;base64,${base64Encode(bytes)}`;
  thumbCache.set(item.id, uri);
  while (thumbCache.size > THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next().value as string;
    thumbCache.delete(oldest);
  }
  return uri;
}

function extensionForMime(mime: string): string {
  if (mime.includes('quicktime')) return 'mov';
  const sub = mime.split('/')[1] ?? 'bin';
  return sub;
}

/**
 * Decrypts a video to a temp file for playback. Returns the plaintext URI.
 * Caller must deleteDecryptedTemp() when the player closes (best effort —
 * the lock/lifecycle wipes are the real guarantee).
 */
export async function decryptVideoToTemp(
  dek: Uint8Array,
  item: MediaItem,
  onProgress?: (progress: StreamProgress) => void,
): Promise<string> {
  const destUri = decryptedFileUri(`${item.id}.${extensionForMime(item.mime)}`);
  await decryptFile({ dek, itemId: item.id, sourceUri: mediaFileUri(item.fileName), destUri, onProgress });
  return destUri;
}

export function deleteDecryptedTemp(uri: string): void {
  deleteIfExists(uri);
}
