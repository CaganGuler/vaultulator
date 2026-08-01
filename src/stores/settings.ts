/**
 * Non-secret preferences, persisted in the plaintext `meta` table.
 * autoLockSeconds: 0 = lock the moment the app goes to background.
 */
import { create } from 'zustand';

import { getMeta, setMeta } from '../lib/db';

const KEY_AUTO_LOCK = 'autolock_seconds';

export const AUTO_LOCK_OPTIONS: { label: string; seconds: number }[] = [
  { label: 'Hemen', seconds: 0 },
  { label: '30 saniye', seconds: 30 },
  { label: '1 dakika', seconds: 60 },
  { label: '5 dakika', seconds: 300 },
];

interface SettingsState {
  autoLockSeconds: number;
  load(): Promise<void>;
  setAutoLockSeconds(seconds: number): Promise<void>;
}

export const useSettings = create<SettingsState>((set) => ({
  autoLockSeconds: 0,

  async load() {
    const raw = await getMeta(KEY_AUTO_LOCK);
    if (raw != null) set({ autoLockSeconds: Number(raw) || 0 });
  },

  async setAutoLockSeconds(seconds: number) {
    set({ autoLockSeconds: seconds });
    await setMeta(KEY_AUTO_LOCK, String(seconds));
  },
}));
