import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { listNotes, type NoteSummary } from '../lib/db/notes-repo';
import { useSession } from '../stores/session';

export function useNotes(): { notes: NoteSummary[]; loading: boolean; error: boolean; refresh: () => Promise<void> } {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    const { ctx, status } = useSession.getState();
    if (status !== 'unlocked' || !ctx) return;
    try {
      setNotes(await listNotes(ctx));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return { notes, loading, error, refresh };
}
