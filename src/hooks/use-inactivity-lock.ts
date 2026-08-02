/**
 * Locks the vault after a period of foreground inactivity. Wire the returned
 * touch handler to a capture-phase responder on the vault root view.
 *
 * A polled deadline rather than a self-rearming timeout: a touch only has to
 * move a timestamp, and the "is something in flight" question gets asked every
 * tick instead of once when the timer was set.
 *
 * The timestamp lives in lib/activity so gesture handlers can stamp it too —
 * see the note there about swipes otherwise reading as inactivity.
 */
import { useCallback, useEffect } from 'react';

import { lastActivityAt, noteActivity, resetActivity } from '../lib/activity';
import { useSession } from '../stores/session';
import { useSettings } from '../stores/settings';

const CHECK_MS = 15 * 1000;

export function useInactivityLock(): { onUserInteraction: () => boolean } {
  useEffect(() => {
    resetActivity();
    const interval = setInterval(() => {
      const { status, busy, lock } = useSession.getState();
      if (status !== 'unlocked') return;
      // Encrypting a large video or playing one back produces no touch events.
      // Locking there would zeroize keys still in use, so busy work counts as
      // activity. Deliberate locks — manual, shake, screenshot, backgrounding —
      // are unaffected; only this idle timer waits.
      if (busy > 0) {
        noteActivity();
        return;
      }
      const timeoutMs = useSettings.getState().inactivitySeconds * 1000;
      if (Date.now() - lastActivityAt() >= timeoutMs) lock();
    }, CHECK_MS);
    return () => clearInterval(interval);
  }, []);

  const onUserInteraction = useCallback(() => {
    noteActivity();
    return false; // never claim the responder — just observe touches
  }, []);

  return { onUserInteraction };
}
