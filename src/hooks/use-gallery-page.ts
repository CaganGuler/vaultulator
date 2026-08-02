/**
 * The list the viewer pages through.
 *
 * Loaded once on mount, not on focus: the viewer is always focused, and
 * re-querying would reshuffle the pages under the user's finger if anything
 * changed. The gallery's filter and sort arrive as route params so the two
 * screens agree without sharing mutable state.
 */
import { useEffect, useState } from 'react';

import { getMediaItem, listMediaItems, type MediaItem } from '../lib/db/media-repo';
import { type MediaFilter, resolveGalleryPage } from '../lib/media/gallery-order';
import { useSession } from '../stores/session';

export interface GalleryPage {
  list: MediaItem[];
  initialIndex: number;
  loading: boolean;
  notFound: boolean;
}

export function useGalleryPage(id: string, filter: MediaFilter, oldestFirst: boolean): GalleryPage {
  const [page, setPage] = useState<GalleryPage>({ list: [], initialIndex: 0, loading: true, notFound: false });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { ctx, status } = useSession.getState();
      if (status !== 'unlocked' || !ctx) return;

      const items = await listMediaItems(ctx);
      const { list, index } = resolveGalleryPage(items, id, filter, oldestFirst);
      if (cancelled) return;

      if (index >= 0) {
        setPage({ list, initialIndex: index, loading: false, notFound: false });
        return;
      }
      // Not in the filtered set: a deep link to a video while the filter says
      // photos, or an item deleted since the gallery loaded. Fall back to just
      // this one item rather than opening the wrong picture.
      const single = await getMediaItem(ctx, id);
      if (cancelled) return;
      setPage({
        list: single ? [single] : [],
        initialIndex: 0,
        loading: false,
        notFound: single === null,
      });
    })().catch(() => {
      if (!cancelled) setPage({ list: [], initialIndex: 0, loading: false, notFound: true });
    });
    return () => {
      cancelled = true;
    };
  }, [id, filter, oldestFirst]);

  return page;
}
