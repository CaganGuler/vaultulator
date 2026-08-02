/**
 * Preferences live in the plaintext `meta` table and are deliberately shared
 * across vaults — a decoy with a different auto-lock delay than the real vault
 * would be a tell.
 */
import { destroyDb, getMeta, setMeta } from '../../lib/db';
import { AUTO_LOCK_OPTIONS, DEFAULT_INACTIVITY_SECONDS, INACTIVITY_OPTIONS, useSettings } from '../settings';
import { __reset as resetSqlite } from '../../test/expo-sqlite-node-shim';

beforeEach(async () => {
  resetSqlite();
  await destroyDb();
  useSettings.setState({ autoLockSeconds: 0, inactivitySeconds: DEFAULT_INACTIVITY_SECONDS });
});

describe('auto-lock preference', () => {
  it('defaults to locking immediately', () => {
    // Fail safe: an unset or unreadable preference must lock sooner, not later.
    expect(useSettings.getState().autoLockSeconds).toBe(0);
  });

  it('persists and reloads a choice', async () => {
    await useSettings.getState().setAutoLockSeconds(300);
    expect(useSettings.getState().autoLockSeconds).toBe(300);

    useSettings.setState({ autoLockSeconds: 0, inactivitySeconds: DEFAULT_INACTIVITY_SECONDS });
    await useSettings.getState().load();
    expect(useSettings.getState().autoLockSeconds).toBe(300);
  });

  it('leaves the default in place when nothing is stored', async () => {
    await useSettings.getState().load();
    expect(useSettings.getState().autoLockSeconds).toBe(0);
  });

  it('falls back to 0 for a corrupt stored value', async () => {
    await setMeta('autolock_seconds', 'not-a-number');
    await useSettings.getState().load();
    expect(useSettings.getState().autoLockSeconds).toBe(0);
  });

  it('offers only values it can round-trip', async () => {
    for (const option of AUTO_LOCK_OPTIONS) {
      await useSettings.getState().setAutoLockSeconds(option.seconds);
      expect(Number(await getMeta('autolock_seconds'))).toBe(option.seconds);
    }
  });
});

describe('foreground inactivity preference', () => {
  it('persists and reloads alongside the background delay', async () => {
    await useSettings.getState().setAutoLockSeconds(30);
    await useSettings.getState().setInactivitySeconds(900);

    useSettings.setState({ autoLockSeconds: 0, inactivitySeconds: 0 });
    await useSettings.getState().load();

    expect(useSettings.getState()).toMatchObject({ autoLockSeconds: 30, inactivitySeconds: 900 });
  });

  it('falls back to the default rather than to never locking', async () => {
    for (const bad of ['', '   ', 'abc', '-5', '0']) {
      await setMeta('inactivity_seconds', bad);
      useSettings.setState({ inactivitySeconds: 0 });
      await useSettings.getState().load();
      expect(useSettings.getState().inactivitySeconds).toBe(DEFAULT_INACTIVITY_SECONDS);
    }
  });

  it('offers only values it can round-trip', async () => {
    for (const option of INACTIVITY_OPTIONS) {
      await useSettings.getState().setInactivitySeconds(option.seconds);
      expect(Number(await getMeta('inactivity_seconds'))).toBe(option.seconds);
    }
  });
});
