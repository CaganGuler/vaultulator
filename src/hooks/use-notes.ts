import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { listNotes, type NoteSummary } from '../lib/db/notes-repo';
import { useSession } from '../stores/session';

export function useNotes(): { notes: NoteSummary[]; loading: boolean; refresh: () => Promise<void> } {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { ctx, status } = useSession.getState();
    if (status !== 'unlocked' || !ctx) return;
    setNotes(await listNotes(ctx));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return { notes, loading, refresh };
}
