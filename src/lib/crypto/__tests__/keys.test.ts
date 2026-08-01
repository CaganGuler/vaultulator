import { backoffForCount, changePin, createVault, deriveDbKey, deriveFileKey, destroyVaultKeys, getAttempts, recordFailedAttempt, resetAttempts, unlockVault, VaultCorruptError, vaultExists, WrongPinError } from '../keys';
import { __reset } from '../../../test/secure-store-mock';

beforeEach(() => __reset());

describe('vault key lifecycle', () => {
  it('creates a vault and unlocks it with the same PIN', async () => {
    const dek = await createVault('123456');
    expect(dek).toHaveLength(32);
    expect(await vaultExists()).toBe(true);

    const unlocked = await unlockVault('123456');
    expect(Buffer.from(unlocked.dek)).toEqual(Buffer.from(dek));
    expect(unlocked.role).toBe('primary');
    expect(unlocked.slotIndex).toBe(0);
  });

  it('rejects a wrong PIN via the GCM tag', async () => {
    await createVault('123456');
    await expect(unlockVault('123457')).rejects.toThrow(WrongPinError);
  });

  it('refuses to create a second vault over an existing one', async () => {
    await createVault('123456');
    await expect(createVault('654321')).rejects.toThrow(VaultCorruptError);
  });

  it('two vaults with the same PIN produce different DEKs (random pepper/salt)', async () => {
    const first = await createVault('123456');
    __reset();
    const second = await createVault('123456');
    expect(Buffer.from(first)).not.toEqual(Buffer.from(second));
  });

  it('changePin keeps the same DEK (no media re-encryption needed)', async () => {
    const dek = await createVault('123456');
    await changePin('123456', '654321', 'primary');
    await expect(unlockVault('123456')).rejects.toThrow(WrongPinError);
    const unlocked = await unlockVault('654321');
    expect(Buffer.from(unlocked.dek)).toEqual(Buffer.from(dek));
  });

  it('destroyVaultKeys removes everything', async () => {
    await createVault('123456');
    await destroyVaultKeys();
    expect(await vaultExists()).toBe(false);
  });
});

describe('subkeys', () => {
  it('derives distinct, deterministic subkeys', async () => {
    const dek = await createVault('123456');
    const saltA = new Uint8Array(16).fill(1);
    const saltB = new Uint8Array(16).fill(2);

    expect(Buffer.from(deriveFileKey(dek, saltA))).toEqual(Buffer.from(deriveFileKey(dek, saltA)));
    expect(Buffer.from(deriveFileKey(dek, saltA))).not.toEqual(Buffer.from(deriveFileKey(dek, saltB)));
    expect(Buffer.from(deriveDbKey(dek))).not.toEqual(Buffer.from(deriveFileKey(dek, saltA)));
  });
});

describe('failed-attempt backoff', () => {
  it('escalates and resets', async () => {
    await createVault('123456');
    const now = 1_000_000;

    let state = await recordFailedAttempt(now);
    expect(state).toEqual({ count: 1, lockUntil: 0 });
    await recordFailedAttempt(now);
    state = await recordFailedAttempt(now);
    expect(state.count).toBe(3);
    expect(state.lockUntil).toBe(now + 30_000);

    state = await recordFailedAttempt(now);
    expect(state.lockUntil).toBe(now + 60_000);

    await resetAttempts();
    expect(await getAttempts()).toEqual({ count: 0, lockUntil: 0 });
  });

  it('caps the backoff at one hour', () => {
    expect(backoffForCount(50)).toBe(3_600_000);
  });
});
