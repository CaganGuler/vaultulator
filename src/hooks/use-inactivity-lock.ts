/**
 * Locks the vault after a period of foreground inactivity. Wire the returned
 * touch handler to a capture-phase responder on the vault root view.
 *
 * A polled deadline rather than a self-rearming timeout: a touch only has to
 * move a timestamp, and the "is something in flight" question gets asked every
 * tick instead of once when the timer was set.
 */
import { useCallback, useEffect, useRef } from 'react';

import { useSession } from '../stores/session';

const INACTIVITY_MS = 5 * 60 * 1000;
const CHECK_MS = 15 * 1000;

export function useInactivityLock(): { onUserInteraction: () => boolean } {
  // Stamped in the effect, not at render: reading the clock during render is
  // impure and the compiler rejects it.
  const lastActivity = useRef(0);

  useEffect(() => {
    lastActivity.current = Date.now();
    const interval = setInterval(() => {
      const { status, busy, lock } = useSession.getState();
      if (status !== 'unlocked') return;
      // Encrypting a large video takes minutes and produces no touch events.
      // Locking there would zeroize the keys the pipeline is still using, so
      // busy work counts as activity. Deliberate locks — manual, shake,
      // screenshot, backgrounding — are unaffected; only this idle timer waits.
      if (busy > 0) {
        lastActivity.current = Date.now();
        return;
      }
      if (Date.now() - lastActivity.current >= INACTIVITY_MS) lock();
    }, CHECK_MS);
    return () => clearInterval(interval);
  }, []);

  const onUserInteraction = useCallback(() => {
    lastActivity.current = Date.now();
    return false; // never claim the responder — just observe touches
  }, []);

  return { onUserInteraction };
}
