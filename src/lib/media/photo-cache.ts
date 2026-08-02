/**
 * Decrypted photos, as temp files rather than data URIs.
 *
 * The old path base64-encoded the whole image into a JS string: a 5 MB photo
 * peaked around 25 MB across the byte array, the base64 string and the data
 * URI, and a 20 MB one near 100 MB. That is what invariant #5 forbids, and it
 * is why the old code could only ever hold one photo at a time — which a pager
 * that prefetches neighbours has to break.
 *
 * Writing to `<cache>/decrypted/` instead keeps peak JS memory at about one
 * chunk regardless of file size. The trade, stated honestly in
 * docs/SECURITY.md: the plaintext now lives on disk for the length of a
 * viewing session rather than not at all. It sits in the one directory
 * invariant #2 permits, is wiped on lock and on cold start, and on iOS is
 * covered by NSFileProtectionComplete whenever the device is locked.
 */
import { File } from 'expo-file-system';

import type { MediaItem } from '../db/media-repo';
import type { VaultContext } from '../db/scope';
import { decryptFile } from '../crypto/stream';
import { decryptedFileUri, deleteIfExists, mediaFileUri } from '../paths';
import { assertStillCurrent } from '../../stores/session';

/** Focus ±3 — the render window plus a little slack. */
const MAX_ENTRIES = 7;
const MAX_BYTES = 96 * 1024 * 1024;
/** Never *prefetch* something this large; decrypt it only when focused. */
const MAX_PREFETCH_BYTES = 40 * 1024 * 1024;

interface Entry {
  uri: string;
  bytes: number;
}

/** Insertion-ordered, so iteration order is least-recently-used first. */
const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();
const failed = new Set<string>();
let pinned: ReadonlySet<string> = new Set();

/** Serialized: two concurrent decrypts just double peak memory and latency. */
let queue: Promise<unknown> = Promise.resolve();

function extensionFor(item: MediaItem): string {
  if (item.mime.includes('png')) return 'png';
  if (item.mime.includes('heic')) return 'heic';
  if (item.mime.includes('webp')) return 'webp';
  return 'jpg';
}

function tempUriFor(item: MediaItem): string {
  // The 'p-' prefix keeps these distinguishable from video temps and from the
  // 'export-' files a share may be writing, so cleanup can be selective.
  return decryptedFileUri(`p-${item.id}.${extensionFor(item)}`);
}

function touch(id: string, entry: Entry): void {
  entries.delete(id);
  entries.set(id, entry);
}

function drop(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;
  entries.delete(id);
  deleteIfExists(entry.uri);
}

function enforceLimits(): void {
  let total = 0;
  for (const entry of entries.values()) total += entry.bytes;

  for (const [id, entry] of [...entries]) {
    const overCount = entries.size > MAX_ENTRIES;
    const overBytes = total > MAX_BYTES;
    if (!overCount && !overBytes) break;
    // Evicting a file out from under a mounted <Image> is a visible failure,
    // so anything currently on screen is off limits.
    if (pinned.has(id)) continue;
    total -= entry.bytes;
    drop(id);
  }
}

/** Ids currently mounted; these are never evicted. */
export function setPinnedPhotos(ids: Iterable<string>): void {
  pinned = new Set(ids);
}

/**
 * Decrypts `item` to a temp file, or returns the cached one.
 *
 * Takes the whole context, not a bare dek: the old signature would happily
 * return bytes decrypted with a key that lock() had already zeroized.
 */
export async function getPhotoFileUri(ctx: VaultContext, item: MediaItem): Promise<string> {
  const cached = entries.get(item.id);
  if (cached && new File(cached.uri).exists) {
    touch(item.id, cached);
    return cached.uri;
  }
  entries.delete(item.id);

  const existing = inflight.get(item.id);
  if (existing) return existing;

  const destUri = tempUriFor(item);
  const work = queue.then(async () => {
    try {
      await decryptFile({ dek: ctx.dek, itemId: item.id, sourceUri: mediaFileUri(item.fileName), destUri });
      // The vault may have locked mid-decrypt, in which case ctx.dek was
      // zeroized underneath us and whatever landed on disk is garbage.
      assertStillCurrent(ctx);
      failed.delete(item.id);
      touch(item.id, { uri: destUri, bytes: new File(destUri).size ?? item.sizeBytes });
      enforceLimits();
      return destUri;
    } catch (e) {
      // Never leave a partial plaintext behind.
      deleteIfExists(destUri);
      failed.add(item.id);
      throw e;
    } finally {
      inflight.delete(item.id);
    }
  });

  inflight.set(item.id, work);
  // Keep the chain alive even when this decrypt rejects.
  queue = work.catch(() => undefined);
  return work;
}

/**
 * Warms neighbours. Fire-and-forget.
 *
 * Photos only — swiping *past* a video must never decrypt it, because
 * decryptVideoToTemp writes the entire file before the first frame. This is
 * the single place that rule is enforced.
 */
export function prefetchPhotos(ctx: VaultContext, items: readonly MediaItem[]): void {
  for (const item of items) {
    if (item.type !== 'photo') continue;
    if (item.sizeBytes > MAX_PREFETCH_BYTES) continue;
    if (entries.has(item.id) || inflight.has(item.id) || failed.has(item.id)) continue;
    void getPhotoFileUri(ctx, item).catch(() => undefined);
  }
}

/** Forgets one item, e.g. after it is deleted. */
export function evictPhoto(itemId: string): void {
  drop(itemId);
  failed.delete(itemId);
}

/**
 * Deletes every photo temp. Prefix-scoped rather than wiping the whole
 * directory, because a share may be writing an 'export-' file.
 */
export function clearPhotoTemps(): void {
  for (const id of [...entries.keys()]) drop(id);
  failed.clear();
  pinned = new Set();
}

/** Drops the index without touching disk — lock() already wiped the files. */
export function forgetPhotoTemps(): void {
  entries.clear();
  failed.clear();
  pinned = new Set();
}
