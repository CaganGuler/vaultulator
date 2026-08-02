import * as SecureStore from 'expo-secure-store';

import {
  appendFailedAttempt,
  clearAttemptLog,
  deleteAttemptLog,
  ensureAttemptLog,
  initAttemptLog,
  LOG_CAPACITY,
  readAttemptLog,
} from '../attempt-log';
import { randomBytes } from '../primitives';

const KEY_LOG = 'vault.log';

const pepper = new Uint8Array(32).fill(7);
const otherPepper = new Uint8Array(32).fill(9);

beforeEach(() => {
  (SecureStore as unknown as { __reset: () => void }).__reset();
});

async function rawLog(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_LOG);
}

describe('round trip', () => {
  it('reads back the timestamps it recorded, oldest first', async () => {
    await initAttemptLog(pepper);
    await appendFailedAttempt(pepper, 1000);
    await appendFailedAttempt(pepper, 2000);
    await appendFailedAttempt(pepper, 3000);
    expect(await readAttemptLog(pepper)).toEqual([1000, 2000, 3000]);
  });

  it('starts empty', async () => {
    await initAttemptLog(pepper);
    expect(await readAttemptLog(pepper)).toEqual([]);
  });

  it('preserves millisecond precision on a realistic epoch value', async () => {
    await initAttemptLog(pepper);
    const now = 1_786_000_123_456;
    await appendFailedAttempt(pepper, now);
    expect(await readAttemptLog(pepper)).toEqual([now]);
  });
});

describe('capacity', () => {
  it('keeps the newest entries and drops the oldest past capacity', async () => {
    await initAttemptLog(pepper);
    for (let i = 1; i <= LOG_CAPACITY + 4; i++) await appendFailedAttempt(pepper, i * 1000);
    const stamps = await readAttemptLog(pepper);
    expect(stamps).toHaveLength(LOG_CAPACITY);
    expect(stamps[0]).toBe(5000);
    expect(stamps.at(-1)).toBe((LOG_CAPACITY + 4) * 1000);
  });
});

// The record's length must not become a plaintext failure counter, and its
// presence must not become a plaintext "something happened here" boolean.
describe('length is constant', () => {
  it('is the same size empty, half full and full', async () => {
    await initAttemptLog(pepper);
    const empty = (await rawLog())!.length;

    for (let i = 0; i < LOG_CAPACITY / 2; i++) await appendFailedAttempt(pepper, 1000 + i);
    expect((await rawLog())!.length).toBe(empty);

    for (let i = 0; i < LOG_CAPACITY * 2; i++) await appendFailedAttempt(pepper, 9000 + i);
    expect((await rawLog())!.length).toBe(empty);
  });
});

describe('ensureAttemptLog', () => {
  it('creates the record for a vault that predates this feature', async () => {
    expect(await rawLog()).toBeNull();
    await ensureAttemptLog(pepper);
    expect(await rawLog()).not.toBeNull();
    expect(await readAttemptLog(pepper)).toEqual([]);
  });

  it('never clobbers an existing history', async () => {
    await initAttemptLog(pepper);
    await appendFailedAttempt(pepper, 4242);
    await ensureAttemptLog(pepper);
    expect(await readAttemptLog(pepper)).toEqual([4242]);
  });
});

describe('confidentiality and integrity', () => {
  it('does not reveal timestamps to a different pepper', async () => {
    await initAttemptLog(pepper);
    await appendFailedAttempt(pepper, 1234);
    expect(await readAttemptLog(otherPepper)).toEqual([]);
  });

  it('rejects a flipped bit rather than returning garbage timestamps', async () => {
    await initAttemptLog(pepper);
    await appendFailedAttempt(pepper, 1234);

    const raw = Buffer.from((await rawLog())!, 'base64');
    raw[raw.length - 20] = raw[raw.length - 20]! ^ 0x01; // inside the ciphertext, before the tag
    await SecureStore.setItemAsync(KEY_LOG, raw.toString('base64'));

    expect(await readAttemptLog(pepper)).toEqual([]);
  });

  it('does not store the timestamp in the clear', async () => {
    await initAttemptLog(pepper);
    await appendFailedAttempt(pepper, 1_786_000_123_456);
    const raw = Buffer.from((await rawLog())!, 'base64');
    const needle = Buffer.alloc(8);
    needle.writeDoubleBE(1_786_000_123_456);
    expect(raw.includes(needle)).toBe(false);
  });

  it('uses a fresh nonce per write, so two identical logs differ', async () => {
    await initAttemptLog(pepper);
    const first = await rawLog();
    await clearAttemptLog(pepper);
    expect(await rawLog()).not.toBe(first);
    expect(await readAttemptLog(pepper)).toEqual([]);
  });
});

describe('failure modes', () => {
  it('reads a missing record as no history', async () => {
    expect(await readAttemptLog(pepper)).toEqual([]);
  });

  it('reads a truncated record as no history', async () => {
    await SecureStore.setItemAsync(KEY_LOG, Buffer.from(randomBytes(4)).toString('base64'));
    expect(await readAttemptLog(pepper)).toEqual([]);
  });

  // An unwritable log must never be the reason someone cannot reach their vault.
  it('swallows a write failure instead of throwing at the unlock path', async () => {
    await initAttemptLog(pepper);
    const setItem = jest.spyOn(SecureStore, 'setItemAsync').mockRejectedValueOnce(new Error('keychain busy'));
    await expect(appendFailedAttempt(pepper, 1)).resolves.toBeUndefined();
    setItem.mockRestore();
  });
});

describe('clear and delete', () => {
  it('clear keeps the record present and full-length', async () => {
    await initAttemptLog(pepper);
    const size = (await rawLog())!.length;
    await appendFailedAttempt(pepper, 1);
    await clearAttemptLog(pepper);
    expect(await readAttemptLog(pepper)).toEqual([]);
    expect((await rawLog())!.length).toBe(size);
  });

  it('delete removes the record entirely', async () => {
    await initAttemptLog(pepper);
    await deleteAttemptLog();
    expect(await rawLog()).toBeNull();
  });
});
