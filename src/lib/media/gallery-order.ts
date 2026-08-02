/**
 * The gallery's filter and sort, as pure functions.
 *
 * The viewer pages through the same list the gallery is showing, so both
 * screens have to agree on what that list is. Rather than hand the array over
 * — which would mean a module singleton holding the vault's ids, sizes and
 * timestamps alive after lock() unmounts the tree — the viewer re-queries and
 * re-applies these, with the parameters carried in the route.
 */
import type { MediaItem } from '../db/media-repo';

export type MediaFilter = 'all' | 'photo' | 'video';

const FILTERS: readonly MediaFilter[] = ['all', 'photo', 'video'];

/** Route params are untrusted input; anything unexpected means "show all". */
export function parseFilter(raw: string | undefined): MediaFilter {
  return FILTERS.includes(raw as MediaFilter) ? (raw as MediaFilter) : 'all';
}

export function parseOldestFirst(raw: string | undefined): boolean {
  return raw === 'old';
}

export function serializeOrder(filter: MediaFilter, oldestFirst: boolean): string {
  return `filter=${filter}&order=${oldestFirst ? 'old' : 'new'}`;
}

/** `items` is expected newest-first, as listMediaItems returns it. */
export function applyGalleryOrder(
  items: readonly MediaItem[],
  filter: MediaFilter,
  oldestFirst: boolean,
): MediaItem[] {
  const filtered = filter === 'all' ? [...items] : items.filter((item) => item.type === filter);
  return oldestFirst ? filtered.reverse() : filtered;
}

/**
 * The ordered list plus where `id` sits in it. `index` is -1 when the item is
 * not in the filtered set — a deep link to a video while the filter says
 * photos, or an item deleted since the gallery last loaded.
 */
export function resolveGalleryPage(
  items: readonly MediaItem[],
  id: string,
  filter: MediaFilter,
  oldestFirst: boolean,
): { list: MediaItem[]; index: number } {
  const list = applyGalleryOrder(items, filter, oldestFirst);
  return { list, index: list.findIndex((item) => item.id === id) };
}
