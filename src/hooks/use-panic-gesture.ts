/**
 * Shake to lock instantly.
 *
 * A fast exit when someone walks up: one sharp shake drops straight back to the
 * calculator, no menus. The accelerometer needs no permission on either
 * platform.
 *
 * Only mounted inside the vault, so the sensor is off whenever the app is
 * locked — nothing polls in the background.
 */
import { Accelerometer } from 'expo-sensors';
import { useEffect } from 'react';

/**
 * Total acceleration in g. At rest gravity alone reads ~1.0, and ordinary
 * walking or pocket movement stays under ~1.8, so 2.4 needs a deliberate jolt.
 */
const SHAKE_G = 2.4;
const SAMPLE_MS = 100;
/** Two hits in a row: a single spike can come from setting the phone down. */
const REQUIRED_HITS = 2;
const HIT_WINDOW_MS = 700;

export function usePanicGesture(onPanic: () => void): void {
  useEffect(() => {
    let hits = 0;
    let firstHitAt = 0;
    let cancelled = false;

    Accelerometer.setUpdateInterval(SAMPLE_MS);
    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      if (cancelled) return;
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      if (magnitude < SHAKE_G) return;

      const now = Date.now();
      if (hits === 0 || now - firstHitAt > HIT_WINDOW_MS) {
        hits = 1;
        firstHitAt = now;
        return;
      }
      hits++;
      if (hits < REQUIRED_HITS) return;
      hits = 0;
      onPanic();
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [onPanic]);
}
