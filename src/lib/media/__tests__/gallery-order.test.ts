/**
 * The gallery and the viewer must agree on which list they are showing and in
 * what order, or swiping lands somewhere unexpected. These are the shared
 * rules, kept pure so both callers provably use the same ones.
 */
import { applyGalleryOrder, parseFilter, parseOldestFirst, resolveGalleryPage, serializeOrder } from '../gallery-order';
import type { MediaItem } from '../../db/media-repo';

function item(id: string, type: MediaItem['type'], createdAt: number): MediaItem {
  return {
    id, type, createdAt,
    fileName: `${id}.enc`, thumbName: null, mime: type === 'photo' ? 'image/jpeg' : 'video/mp4',
    sizeBytes: 1, width: null, height: null, durationMs: null,
  };
}

// listMediaItems returns newest-first.
const items = [item('c', 'video', 3), item('b', 'photo', 2), item('a', 'photo', 1)];

describe('parsing route params', () => {
  it('falls back to all for anything unexpected', () => {
    // These arrive from a URL, so they are untrusted input.
    for (const raw of [undefined, '', 'nonsense', 'PHOTO', '__proto__']) {
      expect(parseFilter(raw)).toBe('all');
    }
  });

  it('accepts the real values', () => {
    expect(parseFilter('photo')).toBe('photo');
    expect(parseFilter('video')).toBe('video');
    expect(parseOldestFirst('old')).toBe(true);
    expect(parseOldestFirst('new')).toBe(false);
    expect(parseOldestFirst(undefined)).toBe(false);
  });

  it('round-trips through serializeOrder', () => {
    for (const filter of ['all', 'photo', 'video'] as const) {
      for (const oldest of [true, false]) {
        const params = new URLSearchParams(serializeOrder(filter, oldest));
        expect(parseFilter(params.get('filter') ?? undefined)).toBe(filter);
        expect(parseOldestFirst(params.get('order') ?? undefined)).toBe(oldest);
      }
    }
  });
});

describe('ordering', () => {
  it('filters by type', () => {
    expect(applyGalleryOrder(items, 'photo', false).map((i) => i.id)).toEqual(['b', 'a']);
    expect(applyGalleryOrder(items, 'video', false).map((i) => i.id)).toEqual(['c']);
    expect(applyGalleryOrder(items, 'all', false).map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('reverses for oldest-first', () => {
    expect(applyGalleryOrder(items, 'all', true).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input', () => {
    const before = items.map((i) => i.id);
    applyGalleryOrder(items, 'all', true);
    expect(items.map((i) => i.id)).toEqual(before);
  });
});

describe('resolveGalleryPage', () => {
  it('locates the item in the ordered list', () => {
    expect(resolveGalleryPage(items, 'b', 'all', false).index).toBe(1);
    expect(resolveGalleryPage(items, 'b', 'all', true).index).toBe(1);
    expect(resolveGalleryPage(items, 'a', 'all', true).index).toBe(0);
  });

  it('reports -1 when the item is filtered out', () => {
    // Deep link to a video while the filter says photos; the caller falls back
    // to a single-item list rather than opening the wrong picture.
    expect(resolveGalleryPage(items, 'c', 'photo', false).index).toBe(-1);
  });

  it('reports -1 for an item that no longer exists', () => {
    expect(resolveGalleryPage(items, 'deleted', 'all', false).index).toBe(-1);
  });
});
