/**
 * Background auto-lock + privacy cover.
 *
 * - 'inactive'/'background' → show the opaque privacy cover so the app
 *   switcher snapshot reveals nothing.
 * - 'background' with autoLockSeconds === 0 → lock immediately.
 * - Otherwise lock on return when the background stay exceeded the timeout.
 *   (If the OS kills the app meanwhile, the in-memory DEK is gone anyway.)
 */
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useSession } from '../stores/session';
import { useSettings } from '../stores/settings';

export function useAutoLock(): { covered: boolean } {
  const [covered, setCovered] = useState(false);
  const backgroundAt = useRef<number | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const { status, lock } = useSession.getState();
      if (next === 'active') {
        setCovered(false);
        const enteredAt = backgroundAt.current;
        backgroundAt.current = null;
        if (enteredAt != null && status === 'unlocked') {
          const timeoutMs = useSettings.getState().autoLockSeconds * 1000;
          if (Date.now() - enteredAt >= timeoutMs) lock();
        }
        return;
      }
      setCovered(true);
      if (next === 'background' && status === 'unlocked') {
        if (useSettings.getState().autoLockSeconds === 0) {
          lock();
        } else {
          backgroundAt.current = Date.now();
        }
      }
    });
    return () => subscription.remove();
  }, []);

  return { covered };
}
