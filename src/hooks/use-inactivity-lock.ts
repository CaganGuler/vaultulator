/**
 * Locks the vault after a period of foreground inactivity. Wire the returned
 * touch handler to a capture-phase responder on the vault root view.
 */
import { useCallback, useEffect, useRef } from 'react';

import { useSession } from '../stores/session';

const INACTIVITY_MS = 5 * 60 * 1000;

export function useInactivityLock(): { onUserInteraction: () => boolean } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const { status, lock } = useSession.getState();
      if (status === 'unlocked') lock();
    }, INACTIVITY_MS);
  }, []);

  useEffect(() => {
    arm();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [arm]);

  const onUserInteraction = useCallback(() => {
    arm();
    return false; // never claim the responder — just observe touches
  }, [arm]);

  return { onUserInteraction };
}
