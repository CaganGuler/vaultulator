/**
 * Non-secret preferences, persisted in the plaintext `meta` table.
 *
 * Deliberately shared across vaults: a decoy whose auto-lock delay differed
 * from the real vault's would be a tell.
 *
 * autoLockSeconds:  delay before locking after the app is backgrounded.
 *                   0 = lock the moment it leaves the foreground.
 * inactivitySeconds: idle timeout while the app is in the foreground.
 */
import { create } from 'zustand';

import { getMeta, setMeta } from '../lib/db';

const KEY_AUTO_LOCK = 'autolock_seconds';
const KEY_INACTIVITY = 'inactivity_seconds';

export const AUTO_LOCK_OPTIONS: { label: string; seconds: number }[] = [
  { label: 'Hemen', seconds: 0 },
  { label: '30 saniye', seconds: 30 },
  { label: '1 dakika', seconds: 60 },
  { label: '5 dakika', seconds: 300 },
];

export const INACTIVITY_OPTIONS: { label: string; seconds: number }[] = [
  { label: '1 dakika', seconds: 60 },
  { label: '5 dakika', seconds: 300 },
  { label: '15 dakika', seconds: 900 },
];

export const DEFAULT_INACTIVITY_SECONDS = 300;

interface SettingsState {
  autoLockSeconds: number;
  inactivitySeconds: number;
  load(): Promise<void>;
  setAutoLockSeconds(seconds: number): Promise<void>;
  setInactivitySeconds(seconds: number): Promise<void>;
}

/**
 * Unset or unparseable falls back to `fallback` — never to "never lock".
 *
 * `minimum` differs by setting: 0 is a real choice for the background delay
 * ("lock immediately"), but for the idle timer it would mean locking every
 * tick, so a stored 0 there is corruption rather than a preference. Note
 * `Number('')` is 0, which is why blank input is rejected before parsing.
 */
function parseSeconds(raw: string | null, fallback: number, minimum: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

export const useSettings = create<SettingsState>((set) => ({
  autoLockSeconds: 0,
  inactivitySeconds: DEFAULT_INACTIVITY_SECONDS,

  async load() {
    const [autoLock, inactivity] = await Promise.all([getMeta(KEY_AUTO_LOCK), getMeta(KEY_INACTIVITY)]);
    set({
      autoLockSeconds: parseSeconds(autoLock, 0, 0),
      inactivitySeconds: parseSeconds(inactivity, DEFAULT_INACTIVITY_SECONDS, 1),
    });
  },

  async setAutoLockSeconds(seconds: number) {
    set({ autoLockSeconds: seconds });
    await setMeta(KEY_AUTO_LOCK, String(seconds));
  },

  async setInactivitySeconds(seconds: number) {
    set({ inactivitySeconds: seconds });
    await setMeta(KEY_INACTIVITY, String(seconds));
  },
}));
