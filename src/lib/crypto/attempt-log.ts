/**
 * Failed-unlock log.
 *
 * Answers the one question the backoff counter cannot: *when* did someone try,
 * and how many times. A counter that resets on every success tells you nothing
 * about the evening your phone was out of your hands.
 *
 * Two constraints shape this:
 *
 * 1. **Failures happen while the vault is locked**, so there is no DEK to
 *    encrypt under. The key is derived from the Keychain pepper instead:
 *    `HKDF(pepper, "vault/log/v1")`. The honest consequence is that this log
 *    is *not* protected by the vault's key hierarchy — anything that can read
 *    the pepper can read the timestamps, and the decoy session is kept out by
 *    the UI, not by cryptography. Written up in docs/SECURITY.md.
 * 2. **The record length must not vary.** A log that grows with the number of
 *    failures is a plaintext counter, and a `vault.log` entry that only exists
 *    after the first failure is a plaintext boolean. It is written at vault
 *    creation, always holds exactly {@link LOG_CAPACITY} slots, and unused
 *    slots read as 0 — invisible, because the whole buffer is inside the GCM
 *    ciphertext. (`vault.slots` needs random filler for its unused slots; this
 *    record does not, because nothing here is exposed by length.)
 */
import * as SecureStore from 'expo-secure-store';

import { base64Decode, base64Encode } from '../base64';

import { gcmOpen, gcmSeal, GCM_IV_LEN, hkdf256, KEY_LEN, randomBytes, zeroize } from './primitives';

const KEY_LOG = 'vault.log';
const EMPTY_SALT = new Uint8Array(0);

/** Timestamps kept. Oldest is dropped when a 17th failure arrives. */
export const LOG_CAPACITY = 16;

const ENTRY_LEN = 8; // float64 ms epoch — exact for every date this app will see
const PLAIN_LEN = LOG_CAPACITY * ENTRY_LEN;

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function logKey(pepper: Uint8Array): Uint8Array {
  return hkdf256(pepper, EMPTY_SALT, 'vault/log/v1', KEY_LEN);
}

function seal(pepper: Uint8Array, stamps: number[]): string {
  const plain = new Uint8Array(PLAIN_LEN);
  const view = new DataView(plain.buffer);
  stamps.slice(-LOG_CAPACITY).forEach((stamp, i) => view.setFloat64(i * ENTRY_LEN, stamp));

  const key = logKey(pepper);
  const iv = randomBytes(GCM_IV_LEN);
  try {
    const sealed = gcmSeal(key, iv, plain);
    const out = new Uint8Array(iv.length + sealed.length);
    out.set(iv);
    out.set(sealed, iv.length);
    return base64Encode(out);
  } finally {
    zeroize(key);
    zeroize(plain);
  }
}

function open(pepper: Uint8Array, raw: string): number[] {
  const bytes = base64Decode(raw);
  if (bytes.length <= GCM_IV_LEN) return [];
  const key = logKey(pepper);
  try {
    const plain = gcmOpen(key, bytes.slice(0, GCM_IV_LEN), bytes.slice(GCM_IV_LEN));
    const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
    const stamps: number[] = [];
    for (let i = 0; i + ENTRY_LEN <= plain.length; i += ENTRY_LEN) {
      const stamp = view.getFloat64(i);
      if (stamp > 0) stamps.push(stamp);
    }
    zeroize(plain);
    return stamps;
  } finally {
    zeroize(key);
  }
}

/** Writes the fixed-size, all-empty record. Call once, when the vault is created. */
export async function initAttemptLog(pepper: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(KEY_LOG, seal(pepper, []), SECURE_OPTS);
}

/**
 * Appends one failure timestamp, dropping the oldest past capacity.
 *
 * Fails open, deliberately: a log write that threw would turn into an unlock
 * error, and an audit trail must never be the reason someone cannot reach
 * their own vault.
 */
export async function appendFailedAttempt(pepper: Uint8Array, at: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY_LOG, seal(pepper, [...(await readAttemptLog(pepper)), at]), SECURE_OPTS);
  } catch {
    // ignored
  }
}

/** Failure timestamps, oldest first. Empty when the log is missing or unreadable. */
export async function readAttemptLog(pepper: Uint8Array): Promise<number[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY_LOG, SECURE_OPTS);
    return raw ? open(pepper, raw) : [];
  } catch {
    // A corrupt or foreign record reads as "nothing recorded" rather than
    // blocking the settings screen it is displayed on.
    return [];
  }
}

/** Clears the history while keeping the record present and full-length. */
export async function clearAttemptLog(pepper: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(KEY_LOG, seal(pepper, []), SECURE_OPTS);
}

/**
 * Writes the empty record when it is absent, so vaults created before this
 * feature existed stop announcing "no failure has ever been recorded here" by
 * the entry simply not being there.
 */
export async function ensureAttemptLog(pepper: Uint8Array): Promise<void> {
  try {
    if ((await SecureStore.getItemAsync(KEY_LOG, SECURE_OPTS)) == null) await initAttemptLog(pepper);
  } catch {
    // ignored — never block an unlock over the audit trail
  }
}

/** Wipe path only — {@link initAttemptLog} puts it back. */
export async function deleteAttemptLog(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_LOG, SECURE_OPTS);
}
