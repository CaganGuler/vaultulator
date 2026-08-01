import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { listMediaItems, type MediaItem } from '../lib/db/media-repo';
import { useSession } from '../stores/session';

export function useMediaItems(): { items: MediaItem[]; loading: boolean; refresh: () => Promise<void> } {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { ctx, status } = useSession.getState();
    if (status !== 'unlocked' || !ctx) return;
    setItems(await listMediaItems(ctx));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return { items, loading, refresh };
}
