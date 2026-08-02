/**
 * When the user was last doing something.
 *
 * This lives outside the hook on purpose. The vault root stamps activity via
 * React's responder system, but once react-native-gesture-handler claims
 * touches natively — which it does the moment the viewer's pager and pinch
 * gestures exist — that handler is not guaranteed to fire. If it stops, then
 * swiping through photos reads as *inactivity* and the vault locks while the
 * user is actively browsing it.
 *
 * A module-level timestamp lets any input source stamp it: the responder,
 * a gesture callback via runOnJS, a keystroke. It also makes the idle logic a
 * pure module that fake timers can drive, which the hook was not.
 */
let lastActivity = 0;

export function noteActivity(): void {
  lastActivity = Date.now();
}

export function lastActivityAt(): number {
  return lastActivity;
}

/** Test seam; also used to start the clock when the vault mounts. */
export function resetActivity(now = Date.now()): void {
  lastActivity = now;
}
