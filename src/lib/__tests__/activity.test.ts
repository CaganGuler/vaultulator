/**
 * The idle-lock deadline.
 *
 * This logic was untestable while the timestamp lived in a ref inside the
 * hook. Moving it to a module was primarily so gesture handlers could stamp it
 * — a swipe that does not count as activity locks the vault mid-browse — but
 * being able to drive it with fake timers is the reason it can be trusted.
 */
import { lastActivityAt, noteActivity, resetActivity } from '../activity';

describe('activity timestamp', () => {
  it('starts from the reset point and moves forward on input', () => {
    jest.useFakeTimers().setSystemTime(1_000_000);
    resetActivity();
    expect(lastActivityAt()).toBe(1_000_000);

    jest.setSystemTime(1_060_000);
    expect(lastActivityAt()).toBe(1_000_000); // time passing is not activity

    noteActivity();
    expect(lastActivityAt()).toBe(1_060_000);
    jest.useRealTimers();
  });

  it('lets a caller decide whether the deadline has passed', () => {
    jest.useFakeTimers().setSystemTime(0);
    resetActivity();

    const timeoutMs = 60_000;
    jest.setSystemTime(59_000);
    expect(Date.now() - lastActivityAt() >= timeoutMs).toBe(false);

    jest.setSystemTime(60_000);
    expect(Date.now() - lastActivityAt() >= timeoutMs).toBe(true);

    // A single swipe is enough to push the deadline out again.
    noteActivity();
    jest.setSystemTime(119_000);
    expect(Date.now() - lastActivityAt() >= timeoutMs).toBe(false);
    jest.useRealTimers();
  });
});
