/**
 * The locked state IS the calculator (see components/calculator.tsx).
 *
 * There is no PIN pad, no lock glyph and no countdown: someone who picks up the
 * phone and opens the app finds a working calculator, not evidence that
 * something is being hidden. A wrong PIN produces no reaction at all, and the
 * failed-attempt backoff runs silently underneath — `unlock()` refuses to even
 * derive a key while locked out, so `=` simply does nothing during a lockout.
 *
 * The trade-off is deliberate and worth naming: the real user cannot tell a
 * mistyped PIN from an active lockout. Any indicator that distinguishes them
 * would also tell a stranger the calculator is a door.
 */
import { useRef } from 'react';

import { Calculator } from '@/components/calculator';
import { useSession } from '@/stores/session';

export default function LockScreen() {
  const busy = useRef(false);

  const attemptUnlock = (pin: string) => {
    if (busy.current) return;
    busy.current = true;
    void useSession
      .getState()
      .unlock(pin)
      // Success flips status → Stack.Protected swaps the screen out. Failure is
      // swallowed on purpose; so is an unexpected error, which must not surface
      // a dialog a calculator would never show.
      .catch(() => undefined)
      .finally(() => {
        busy.current = false;
      });
  };

  return <Calculator onPinEntry={attemptUnlock} />;
}
