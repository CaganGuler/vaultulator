/**
 * Preferences live in the plaintext `meta` table and are deliberately shared
 * across vaults — a decoy with a different auto-lock delay than the real vault
 * would be a tell.
 */
import { destroyDb, getMeta, setMeta } from '../../lib/db';
import { AUTO_LOCK_OPTIONS, useSettings } from '../settings';
import { __reset as resetSqlite } from '../../test/expo-sqlite-node-shim';

beforeEach(async () => {
  resetSqlite();
  await destroyDb();
  useSettings.setState({ autoLockSeconds: 0 });
});

describe('auto-lock preference', () => {
  it('defaults to locking immediately', () => {
    // Fail safe: an unset or unreadable preference must lock sooner, not later.
    expect(useSettings.getState().autoLockSeconds).toBe(0);
  });

  it('persists and reloads a choice', async () => {
    await useSettings.getState().setAutoLockSeconds(300);
    expect(useSettings.getState().autoLockSeconds).toBe(300);

    useSettings.setState({ autoLockSeconds: 0 });
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
