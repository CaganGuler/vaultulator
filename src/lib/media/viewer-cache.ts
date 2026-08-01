/**
 * Decrypted-content lifecycle.
 *
 * - Thumbnails and full-size photos are decrypted INTO MEMORY as base64 data
 *   URIs (plaintext never touches disk). Thumbnails live in a small LRU.
 * - Videos must be decrypted to a temp file for expo-video playback; those
 *   temp files live in <cache>/decrypted/ and are wiped on lock, on
 *   background-lock and on every cold start (see stores/session.ts).
 */
import type { MediaItem } from '../db/media-repo';
import { base64Encode } from '../base64';
import { decryptFile, decryptFileToBytes, type StreamProgress } from '../crypto/stream';
import { decryptedFileUri, deleteIfExists, mediaFileUri, thumbFileUri } from '../paths';

const THUMB_CACHE_MAX = 80;
const thumbCache = new Map<string, string>(); // itemId → data URI (Map keeps insertion order → LRU)

export function clearThumbCache(): void {
  thumbCache.clear();
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

/** Full-size photo as an in-memory data URI. One at a time; not cached. */
export async function getPhotoDataUri(dek: Uint8Array, item: MediaItem): Promise<string> {
  const bytes = await decryptFileToBytes(dek, item.id, mediaFileUri(item.fileName));
  return `data:${item.mime};base64,${base64Encode(bytes)}`;
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
