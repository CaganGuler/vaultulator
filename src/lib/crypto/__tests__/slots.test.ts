/**
 * Multi-slot vault record: honeypot (decoy) and duress slots.
 *
 * The security claims under test are (a) each PIN reaches exactly one vault,
 * (b) the decoy can never reach the primary's key material, and (c) the stored
 * record looks the same whether or not a decoy exists.
 */
import * as SecureStore from 'expo-secure-store';

import {
  changePin,
  createVault,
  deriveDbKey,
  deriveTagKey,
  disableDecoy,
  disableDuress,
  enableDecoy,
  enableDuress,
  getDecoyState,
  PinInUseError,
  resetDecoyPin,
  ROW_TAG_LEN,
  rowTag,
  SLOT_DECOY,
  SLOT_DURESS,
  SLOT_PRIMARY,
  unlockVault,
  VaultCorruptError,
  WrongPinError,
} from '../keys';
import { argon2id, concatBytes, gcmSeal, GCM_IV_LEN, randomBytes, utf8Encode } from '../primitives';
import { base64Decode, base64Encode } from '../../base64';
import { __reset } from '../../../test/secure-store-mock';

const PRIMARY_PIN = '111111';
const DECOY_PIN = '222222';
const DURESS_PIN = '333333';

const RECORD_KEY = 'vault.slots';
const RECORD_LEN = 326;
const SLOT_LEN = 62;
const SLOT_BASE = 1 + 16;
const ESCROW_BASE = SLOT_BASE + 4 * SLOT_LEN;

const b = (bytes: Uint8Array) => Buffer.from(bytes);

async function readRecord(): Promise<Uint8Array> {
  const raw = await SecureStore.getItemAsync(RECORD_KEY);
  if (!raw) throw new Error('record missing');
  return base64Decode(raw);
}

async function writeRecord(bytes: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(RECORD_KEY, base64Encode(bytes));
}

function slotOf(record: Uint8Array, index: number): Uint8Array {
  return record.subarray(SLOT_BASE + index * SLOT_LEN, SLOT_BASE + (index + 1) * SLOT_LEN);
}

function escrowOf(record: Uint8Array): Uint8Array {
  return record.subarray(ESCROW_BASE);
}

/** Flips one bit at `offset`, returning a fresh buffer. */
function flipBit(record: Uint8Array, offset: number): Uint8Array {
  const copy = Uint8Array.from(record);
  copy[offset] ^= 0x01;
  return copy;
}

beforeEach(() => __reset());

describe('slot round-trips', () => {
  it('routes each PIN to its own vault', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    const decoyDek = await enableDecoy(primaryDek, DECOY_PIN);
    expect(b(decoyDek)).not.toEqual(b(primaryDek));

    const asPrimary = await unlockVault(PRIMARY_PIN);
    expect(b(asPrimary.dek)).toEqual(b(primaryDek));
    expect(asPrimary.role).toBe('primary');
    expect(asPrimary.slotIndex).toBe(SLOT_PRIMARY);

    const asDecoy = await unlockVault(DECOY_PIN);
    expect(b(asDecoy.dek)).toEqual(b(decoyDek));
    expect(asDecoy.role).toBe('decoy');
    expect(asDecoy.slotIndex).toBe(SLOT_DECOY);
  });

  it('gives the two vaults unrelated subkeys', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    const decoyDek = await enableDecoy(primaryDek, DECOY_PIN);
    expect(b(deriveDbKey(primaryDek))).not.toEqual(b(deriveDbKey(decoyDek)));
    expect(b(deriveTagKey(primaryDek))).not.toEqual(b(deriveTagKey(decoyDek)));
  });

  it('reports decoy and duress state to the primary session', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    expect(await getDecoyState(primaryDek)).toEqual({ decoyEnabled: false, duressEnabled: false });

    await enableDecoy(primaryDek, DECOY_PIN);
    expect(await getDecoyState(primaryDek)).toEqual({ decoyEnabled: true, duressEnabled: false });

    await enableDuress(primaryDek, DURESS_PIN);
    expect(await getDecoyState(primaryDek)).toEqual({ decoyEnabled: true, duressEnabled: true });

    await disableDuress(primaryDek);
    expect(await getDecoyState(primaryDek)).toEqual({ decoyEnabled: true, duressEnabled: false });

    await disableDecoy(primaryDek);
    expect(await getDecoyState(primaryDek)).toEqual({ decoyEnabled: false, duressEnabled: false });
    await expect(unlockVault(DECOY_PIN)).rejects.toThrow(WrongPinError);
  });
});

describe('escrow is one-way', () => {
  it('lets the primary reset the decoy PIN without knowing the old one', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    const decoyDek = await enableDecoy(primaryDek, DECOY_PIN);

    await resetDecoyPin(primaryDek, '999999');

    await expect(unlockVault(DECOY_PIN)).rejects.toThrow(WrongPinError);
    const reopened = await unlockVault('999999');
    // Same DEK, so everything already stored in the decoy stays readable.
    expect(b(reopened.dek)).toEqual(b(decoyDek));
    expect(reopened.role).toBe('decoy');
  });

  it('gives a decoy session no route back to the primary DEK', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);
    const decoySession = await unlockVault(DECOY_PIN);

    // The escrow is sealed under a subkey of the PRIMARY dek; from the decoy
    // side it is indistinguishable from the random filler of a decoy-less vault.
    expect(await getDecoyState(decoySession.dek)).toEqual({ decoyEnabled: false, duressEnabled: false });
    await expect(enableDuress(decoySession.dek, DURESS_PIN)).rejects.toThrow(VaultCorruptError);
    await expect(resetDecoyPin(decoySession.dek, '999999')).rejects.toThrow(VaultCorruptError);
  });

  it('refuses to create a second decoy', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);
    await expect(enableDecoy(primaryDek, '444444')).rejects.toThrow(VaultCorruptError);
  });

  it('requires a decoy before a duress PIN can exist', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await expect(enableDuress(primaryDek, DURESS_PIN)).rejects.toThrow(VaultCorruptError);
  });
});

describe('per-slot PIN changes stay independent', () => {
  it('changing the decoy PIN leaves the primary slot byte-identical', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);
    const before = slotOf(await readRecord(), SLOT_PRIMARY);

    await changePin(DECOY_PIN, '888888', 'decoy');

    expect(b(slotOf(await readRecord(), SLOT_PRIMARY))).toEqual(b(before));
    expect(b((await unlockVault(PRIMARY_PIN)).dek)).toEqual(b(primaryDek));
    await expect(unlockVault(DECOY_PIN)).rejects.toThrow(WrongPinError);
    expect((await unlockVault('888888')).role).toBe('decoy');
  });

  it('changing the primary PIN leaves the decoy slot byte-identical', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    const decoyDek = await enableDecoy(primaryDek, DECOY_PIN);
    const before = slotOf(await readRecord(), SLOT_DECOY);

    await changePin(PRIMARY_PIN, '777777', 'primary');

    expect(b(slotOf(await readRecord(), SLOT_DECOY))).toEqual(b(before));
    expect(b((await unlockVault(DECOY_PIN)).dek)).toEqual(b(decoyDek));
    expect(b((await unlockVault('777777')).dek)).toEqual(b(primaryDek));
  });

  it('rejects the primary PIN typed into a decoy session change-PIN screen', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);

    // A coercer watching a decoy session must see exactly the wrong-PIN path.
    await expect(changePin(PRIMARY_PIN, '888888', 'decoy')).rejects.toThrow(WrongPinError);

    // ...and nothing may have changed.
    expect(b((await unlockVault(PRIMARY_PIN)).dek)).toEqual(b(primaryDek));
    expect((await unlockVault(DECOY_PIN)).role).toBe('decoy');
    await expect(unlockVault('888888')).rejects.toThrow(WrongPinError);
  });
});

describe('PIN collisions are rejected', () => {
  it('refuses a decoy PIN equal to the primary PIN', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await expect(enableDecoy(primaryDek, PRIMARY_PIN)).rejects.toThrow(PinInUseError);
  });

  it('refuses a duress PIN equal to the decoy PIN', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);
    await expect(enableDuress(primaryDek, DECOY_PIN)).rejects.toThrow(PinInUseError);
  });

  it('refuses a PIN change onto another slot’s PIN', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);
    await expect(changePin(DECOY_PIN, PRIMARY_PIN, 'decoy')).rejects.toThrow(PinInUseError);
  });

  it('refuses a decoy PIN reset onto the primary PIN', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);
    await expect(resetDecoyPin(primaryDek, PRIMARY_PIN)).rejects.toThrow(PinInUseError);
  });
});

describe('duress PIN', () => {
  it('destroys the primary slot and opens the decoy', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    const decoyDek = await enableDecoy(primaryDek, DECOY_PIN);
    await enableDuress(primaryDek, DURESS_PIN);

    const opened = await unlockVault(DURESS_PIN);
    expect(opened.role).toBe('duress');
    expect(opened.slotIndex).toBe(SLOT_DURESS);
    // It wraps the DECOY's dek, so this is an ordinary decoy session.
    expect(b(opened.dek)).toEqual(b(decoyDek));

    // The real vault is gone for good; the decoy still works normally.
    await expect(unlockVault(PRIMARY_PIN)).rejects.toThrow(WrongPinError);
    expect(b((await unlockVault(DECOY_PIN)).dek)).toEqual(b(decoyDek));
  });

  it('leaves no escrow behind for anyone to open', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);
    await enableDuress(primaryDek, DURESS_PIN);
    const escrowBefore = Uint8Array.from(escrowOf(await readRecord()));

    await unlockVault(DURESS_PIN);

    expect(b(escrowOf(await readRecord()))).not.toEqual(b(escrowBefore));
    expect(await getDecoyState(primaryDek)).toEqual({ decoyEnabled: false, duressEnabled: false });
  });

  it('is idempotent if it somehow runs twice', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    const decoyDek = await enableDecoy(primaryDek, DECOY_PIN);
    await enableDuress(primaryDek, DURESS_PIN);

    await unlockVault(DURESS_PIN);
    const again = await unlockVault(DURESS_PIN);
    expect(b(again.dek)).toEqual(b(decoyDek));
  });
});

describe('deniability of the stored record', () => {
  it('keeps a constant length whether or not a decoy exists', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    const bare = await readRecord();
    expect(bare).toHaveLength(RECORD_LEN);

    await enableDecoy(primaryDek, DECOY_PIN);
    expect(await readRecord()).toHaveLength(RECORD_LEN);

    await enableDuress(primaryDek, DURESS_PIN);
    expect(await readRecord()).toHaveLength(RECORD_LEN);

    await disableDecoy(primaryDek);
    expect(await readRecord()).toHaveLength(RECORD_LEN);
  });

  it('reports the same error whether one slot or three are occupied', async () => {
    await createVault(PRIMARY_PIN);
    const bare = await unlockVault(PRIMARY_PIN).then(
      () => unlockVault('000000').catch((e: Error) => e),
    );

    __reset();
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);
    await enableDuress(primaryDek, DURESS_PIN);
    const full = await unlockVault('000000').catch((e: Error) => e);

    expect((bare as Error).constructor).toBe(WrongPinError);
    expect((full as Error).constructor).toBe(WrongPinError);
    expect((full as Error).message).toBe((bare as Error).message);
  });

  it('never lets a filler slot authenticate', async () => {
    await createVault(PRIMARY_PIN);
    // Slots 1-3 are random bytes; no PIN may ever open them.
    for (const pin of ['000000', '222222', '333333', '444444', '999999']) {
      await expect(unlockVault(pin)).rejects.toThrow(WrongPinError);
    }
  });
});

describe('tamper resistance', () => {
  it('rejects a bit flip in the occupied slot but keeps the others usable', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    const decoyDek = await enableDecoy(primaryDek, DECOY_PIN);
    const record = await readRecord();

    await writeRecord(flipBit(record, SLOT_BASE + SLOT_PRIMARY * SLOT_LEN + 20));
    await expect(unlockVault(PRIMARY_PIN)).rejects.toThrow(WrongPinError);
    expect(b((await unlockVault(DECOY_PIN)).dek)).toEqual(b(decoyDek));
  });

  it('rejects a bit flip in the salt (every slot becomes unreachable)', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);
    await writeRecord(flipBit(await readRecord(), 3));

    await expect(unlockVault(PRIMARY_PIN)).rejects.toThrow(WrongPinError);
    await expect(unlockVault(DECOY_PIN)).rejects.toThrow(WrongPinError);
  });

  it('treats a tampered escrow as "no decoy" rather than trusting it', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);
    await writeRecord(flipBit(await readRecord(), ESCROW_BASE + 5));

    expect(await getDecoyState(primaryDek)).toEqual({ decoyEnabled: false, duressEnabled: false });
    // The decoy slot itself is untouched, so its PIN still works.
    expect((await unlockVault(DECOY_PIN)).role).toBe('decoy');
  });

  it('rejects swapping two slots (role must match its position)', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);
    const record = Uint8Array.from(await readRecord());

    const primarySlot = Uint8Array.from(slotOf(record, SLOT_PRIMARY));
    record.set(slotOf(record, SLOT_DECOY), SLOT_BASE + SLOT_PRIMARY * SLOT_LEN);
    record.set(primarySlot, SLOT_BASE + SLOT_DECOY * SLOT_LEN);
    await writeRecord(record);

    await expect(unlockVault(PRIMARY_PIN)).rejects.toThrow(VaultCorruptError);
    await expect(unlockVault(DECOY_PIN)).rejects.toThrow(VaultCorruptError);
  });

  it('rejects a truncated or padded record', async () => {
    await createVault(PRIMARY_PIN);
    const record = await readRecord();

    await writeRecord(record.subarray(0, RECORD_LEN - 1));
    await expect(unlockVault(PRIMARY_PIN)).rejects.toThrow(VaultCorruptError);

    await writeRecord(concatBytes(record, Uint8Array.of(0)));
    await expect(unlockVault(PRIMARY_PIN)).rejects.toThrow(VaultCorruptError);
  });

  it('rejects an unknown record version', async () => {
    await createVault(PRIMARY_PIN);
    const record = Uint8Array.from(await readRecord());
    record[0] = 0x02;
    await writeRecord(record);
    await expect(unlockVault(PRIMARY_PIN)).rejects.toThrow(VaultCorruptError);
  });

  it('fails closed when two slots share a KEK', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);

    // Hand-craft the collision the API refuses to create.
    const record = Uint8Array.from(await readRecord());
    record.set(slotOf(record, SLOT_PRIMARY), SLOT_BASE + SLOT_DECOY * SLOT_LEN);
    await writeRecord(record);

    await expect(unlockVault(PRIMARY_PIN)).rejects.toThrow(VaultCorruptError);
  });
});

describe('legacy single-slot migration', () => {
  const KDF_PARAMS = { v: 1, alg: 'argon2id' as const, memoryKiB: 64 * 1024, passes: 3, parallelism: 4 };

  /** Recreates the pre-multi-slot SecureStore layout. */
  async function seedLegacyVault(pin: string): Promise<Uint8Array> {
    const pepper = randomBytes(32);
    const pinSalt = randomBytes(16);
    const dek = randomBytes(32);
    const kek = await argon2id(utf8Encode(pin.normalize('NFKC')), pinSalt, pepper, KDF_PARAMS);
    const iv = randomBytes(GCM_IV_LEN);
    const wrapped = concatBytes(iv, gcmSeal(kek, iv, dek));

    await SecureStore.setItemAsync('vault.pepper', base64Encode(pepper));
    await SecureStore.setItemAsync('vault.pinSalt', base64Encode(pinSalt));
    await SecureStore.setItemAsync('vault.kdfParams', JSON.stringify(KDF_PARAMS));
    await SecureStore.setItemAsync('vault.wrappedDek', base64Encode(wrapped));
    await SecureStore.setItemAsync('vault.attempts', JSON.stringify({ count: 0, lockUntil: 0 }));
    return dek;
  }

  it('converts on first unlock without changing the DEK', async () => {
    const dek = await seedLegacyVault(PRIMARY_PIN);

    const opened = await unlockVault(PRIMARY_PIN);
    expect(b(opened.dek)).toEqual(b(dek));
    expect(opened.role).toBe('primary');

    expect(await SecureStore.getItemAsync('vault.wrappedDek')).toBeNull();
    expect(await SecureStore.getItemAsync('vault.pinSalt')).toBeNull();
    expect(await readRecord()).toHaveLength(RECORD_LEN);

    // Second unlock now goes down the multi-slot path and still works.
    expect(b((await unlockVault(PRIMARY_PIN)).dek)).toEqual(b(dek));
  });

  it('still rejects a wrong PIN during migration', async () => {
    await seedLegacyVault(PRIMARY_PIN);
    await expect(unlockVault('654321')).rejects.toThrow(WrongPinError);
    // Nothing was converted, so the legacy entry is still there to retry from.
    expect(await SecureStore.getItemAsync('vault.wrappedDek')).not.toBeNull();
  });

  it('self-heals when a crash left both layouts behind', async () => {
    const dek = await seedLegacyVault(PRIMARY_PIN);
    const legacyWrapped = await SecureStore.getItemAsync('vault.wrappedDek');
    const legacySalt = await SecureStore.getItemAsync('vault.pinSalt');

    await unlockVault(PRIMARY_PIN); // writes the record, deletes the legacy keys
    // Simulate the crash window: record written, legacy entries not yet gone.
    await SecureStore.setItemAsync('vault.wrappedDek', legacyWrapped!);
    await SecureStore.setItemAsync('vault.pinSalt', legacySalt!);

    const opened = await unlockVault(PRIMARY_PIN);
    expect(b(opened.dek)).toEqual(b(dek));
    expect(await SecureStore.getItemAsync('vault.wrappedDek')).toBeNull();
    expect(await SecureStore.getItemAsync('vault.pinSalt')).toBeNull();
  });

  it('supports enabling a decoy on a migrated vault', async () => {
    await seedLegacyVault(PRIMARY_PIN);
    const primaryDek = (await unlockVault(PRIMARY_PIN)).dek;

    const decoyDek = await enableDecoy(primaryDek, DECOY_PIN);
    expect(b((await unlockVault(DECOY_PIN)).dek)).toEqual(b(decoyDek));
    expect(b((await unlockVault(PRIMARY_PIN)).dek)).toEqual(b(primaryDek));
  });
});

describe('row ownership tags', () => {
  it('are deterministic, unique per row, and key-dependent', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    const decoyDek = await enableDecoy(primaryDek, DECOY_PIN);
    const primaryTagKey = deriveTagKey(primaryDek);
    const decoyTagKey = deriveTagKey(decoyDek);

    expect(rowTag(primaryTagKey, 'row-a')).toHaveLength(ROW_TAG_LEN);
    expect(b(rowTag(primaryTagKey, 'row-a'))).toEqual(b(rowTag(primaryTagKey, 'row-a')));
    expect(b(rowTag(primaryTagKey, 'row-a'))).not.toEqual(b(rowTag(primaryTagKey, 'row-b')));
    expect(b(rowTag(primaryTagKey, 'row-a'))).not.toEqual(b(rowTag(decoyTagKey, 'row-a')));
  });

  it('are not a per-vault constant (that would prove a second vault exists)', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    const tagKey = deriveTagKey(primaryDek);
    const tags = ['a', 'b', 'c', 'd'].map((id) => b(rowTag(tagKey, id)).toString('hex'));
    expect(new Set(tags).size).toBe(4);
  });
});
