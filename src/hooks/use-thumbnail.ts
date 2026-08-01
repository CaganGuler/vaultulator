import { useEffect, useState } from 'react';

import type { MediaItem } from '../lib/db/media-repo';
import { getThumbnailDataUri } from '../lib/media/viewer-cache';
import { useSession } from '../stores/session';

/** Decrypts a thumbnail into an in-memory data URI (LRU-cached). */
export function useThumbnail(item: MediaItem): string | null {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const { ctx, status } = useSession.getState();
    if (status !== 'unlocked' || !ctx) return;
    getThumbnailDataUri(ctx.dek, item)
      .then((result) => {
        if (!cancelled) setUri(result);
      })
      .catch(() => {
        if (!cancelled) setUri(null);
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  return uri;
}
