/**
 * Key hierarchy, multi-slot vault record and SecureStore inventory.
 *
 *   PIN ──argon2id(pinSalt, secret=pepper)──► KEK (32 B)
 *   DEK  = 32 B random master key, one per vault (primary and decoy each have one)
 *   slot = AES-256-GCM(KEK, fmtVer ‖ role ‖ DEK)
 *
 * The pepper is a random 256-bit value that lives ONLY in the iOS Keychain /
 * Android Keystore (SecureStore, WHEN_UNLOCKED_THIS_DEVICE_ONLY). An attacker
 * who exfiltrates app files or a backup has ciphertext + salt but not the
 * pepper, so a short PIN cannot be brute-forced offline.
 *
 * PIN verification IS the GCM tag check on the slot unwrap — no separate
 * verifier blob. Forgot PIN = data unrecoverable, by design.
 *
 * ── Why one consolidated record ──────────────────────────────────────────────
 * Salt, all four slots and the escrow live in a single fixed-size SecureStore
 * entry (`vault.slots`). Two reasons:
 *
 *   1. Atomicity. SecureStore has no transactions. Split across entries, a
 *      crash between writes could brick the vault (new slots, stale salt).
 *   2. Keychain items carry a modification timestamp. A separate escrow entry
 *      rewritten months after vault creation would announce "a decoy was added
 *      on date X". Here every mutation rewrites the same entry.
 *
 * Unoccupied slots and the escrow-when-absent hold cryptographic random bytes.
 * GCM output is indistinguishable from random, so filler and real content
 * cannot be told apart and the record length never reveals how many PINs exist.
 *
 * Slot positions are fixed by convention (primary/decoy/duress/reserved). This
 * leaks nothing — an observer cannot decrypt any slot, so position is
 * meaningless to them — and it saves having to track occupancy out of band.
 *
 * The plaintext DEK only ever lives in memory (see stores/session.ts).
 */
import * as SecureStore from 'expo-secure-store';

import {
  argon2id,
  type Argon2idParams,
  concatBytes,
  gcmOpen,
  gcmSeal,
  GCM_IV_LEN,
  hkdf256,
  hmacSha256,
  IntegrityError,
  KEY_LEN,
  randomBytes,
  utf8Encode,
  zeroize,
} from './primitives';
import { base64Decode, base64Encode } from '../base64';

export class WrongPinError extends Error {
  constructor() {
    super('PIN yanlış');
    this.name = 'WrongPinError';
  }
}

export class VaultCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultCorruptError';
  }
}

/** A new PIN would collide with an existing slot's PIN. */
export class PinInUseError extends Error {
  constructor() {
    super('Bu PIN kullanılamaz');
    this.name = 'PinInUseError';
  }
}

const KEY_PEPPER = 'vault.pepper';
const KEY_KDF_PARAMS = 'vault.kdfParams';
const KEY_RECORD = 'vault.slots';
const KEY_ATTEMPTS = 'vault.attempts';

/** Pre-multi-slot layout, read once during migration then deleted. */
const LEGACY_KEY_PIN_SALT = 'vault.pinSalt';
const LEGACY_KEY_WRAPPED_DEK = 'vault.wrappedDek';

const ALL_KEYS = [
  KEY_PEPPER,
  KEY_KDF_PARAMS,
  KEY_RECORD,
  KEY_ATTEMPTS,
  LEGACY_KEY_PIN_SALT,
  LEGACY_KEY_WRAPPED_DEK,
];

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// ── Record layout ───────────────────────────────────────────────────────────

export type VaultRole = 'primary' | 'decoy' | 'duress';

export const SLOT_PRIMARY = 0;
export const SLOT_DECOY = 1;
export const SLOT_DURESS = 2;
const SLOT_COUNT = 4; // 4th is reserved headroom, always filler today

const ROLE_FOR_SLOT: Record<number, VaultRole> = {
  [SLOT_PRIMARY]: 'primary',
  [SLOT_DECOY]: 'decoy',
  [SLOT_DURESS]: 'duress',
};

const ROLE_BYTE: Record<VaultRole, number> = { primary: 0x01, decoy: 0x02, duress: 0x03 };

const RECORD_VERSION = 0x01;
const PAYLOAD_VERSION = 0x01;

const PIN_SALT_LEN = 16;
const SLOT_PAYLOAD_LEN = 1 + 1 + KEY_LEN; // fmtVer ‖ role ‖ DEK = 34
const SLOT_LEN = GCM_IV_LEN + SLOT_PAYLOAD_LEN + 16; // 62
const ESCROW_PAYLOAD_LEN = 1 + KEY_LEN; // flags ‖ DEK_decoy = 33
const ESCROW_LEN = GCM_IV_LEN + ESCROW_PAYLOAD_LEN + 16; // 61
const RECORD_LEN = 1 + PIN_SALT_LEN + SLOT_COUNT * SLOT_LEN + ESCROW_LEN; // 326

const SLOT_AAD = utf8Encode('vault/slot/v1');
const ESCROW_AAD = utf8Encode('vault/escrow/v1');

const EMPTY_SALT = new Uint8Array(0);

const FLAG_DURESS = 0x01;

interface VaultRecord {
  pinSalt: Uint8Array;
  slots: Uint8Array[];
  escrow: Uint8Array;
}

interface StoredKdfParams extends Argon2idParams {
  v: number;
  alg: 'argon2id';
}

export const DEFAULT_KDF_PARAMS: StoredKdfParams = {
  v: 1,
  alg: 'argon2id',
  memoryKiB: 64 * 1024,
  passes: 3,
  parallelism: 4,
};

async function getRequired(key: string): Promise<string> {
  const value = await SecureStore.getItemAsync(key, SECURE_OPTS);
  if (value == null) throw new VaultCorruptError(`SecureStore kaydı eksik: ${key}`);
  return value;
}

async function deriveKek(pin: string, salt: Uint8Array, pepper: Uint8Array, params: Argon2idParams): Promise<Uint8Array> {
  const pinBytes = utf8Encode(pin.normalize('NFKC'));
  try {
    return await argon2id(pinBytes, salt, pepper, params);
  } finally {
    zeroize(pinBytes);
  }
}

function serializeRecord(rec: VaultRecord): Uint8Array {
  return concatBytes(Uint8Array.of(RECORD_VERSION), rec.pinSalt, ...rec.slots, rec.escrow);
}

function parseRecord(raw: Uint8Array): VaultRecord {
  if (raw.length !== RECORD_LEN) throw new VaultCorruptError('Kasa kaydı bozuk (uzunluk)');
  if (raw[0] !== RECORD_VERSION) throw new VaultCorruptError(`Bilinmeyen kasa kayıt sürümü: ${raw[0]}`);
  let at = 1;
  const pinSalt = raw.subarray(at, (at += PIN_SALT_LEN));
  const slots: Uint8Array[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) slots.push(raw.subarray(at, (at += SLOT_LEN)));
  return { pinSalt, slots, escrow: raw.subarray(at, at + ESCROW_LEN) };
}

async function loadRecord(): Promise<VaultRecord | null> {
  const raw = await SecureStore.getItemAsync(KEY_RECORD, SECURE_OPTS);
  return raw == null ? null : parseRecord(base64Decode(raw));
}

async function saveRecord(rec: VaultRecord): Promise<void> {
  await SecureStore.setItemAsync(KEY_RECORD, base64Encode(serializeRecord(rec)), SECURE_OPTS);
}

async function loadContext(): Promise<{ pepper: Uint8Array; params: StoredKdfParams }> {
  const pepper = base64Decode(await getRequired(KEY_PEPPER));
  const params = JSON.parse(await getRequired(KEY_KDF_PARAMS)) as StoredKdfParams;
  if (params.alg !== 'argon2id') throw new VaultCorruptError(`Bilinmeyen KDF: ${params.alg}`);
  return { pepper, params };
}

// ── Slot sealing / opening ──────────────────────────────────────────────────

function sealSlot(kek: Uint8Array, role: VaultRole, dek: Uint8Array): Uint8Array {
  const payload = concatBytes(Uint8Array.of(PAYLOAD_VERSION, ROLE_BYTE[role]), dek);
  const iv = randomBytes(GCM_IV_LEN);
  try {
    return concatBytes(iv, gcmSeal(kek, iv, payload, SLOT_AAD));
  } finally {
    zeroize(payload);
  }
}

/** Returns the slot's DEK, or null if this KEK does not open it. */
function openSlot(kek: Uint8Array, slot: Uint8Array, expectedRole: VaultRole): Uint8Array | null {
  let payload: Uint8Array;
  try {
    payload = gcmOpen(kek, slot.subarray(0, GCM_IV_LEN), slot.subarray(GCM_IV_LEN), SLOT_AAD);
  } catch (e) {
    if (e instanceof IntegrityError) return null;
    throw e;
  }
  if (payload.length !== SLOT_PAYLOAD_LEN) throw new VaultCorruptError('Slot içeriği bozuk');
  if (payload[0] !== PAYLOAD_VERSION) throw new VaultCorruptError(`Bilinmeyen slot sürümü: ${payload[0]}`);
  if (payload[1] !== ROLE_BYTE[expectedRole]) throw new VaultCorruptError('Slot rolü konumuyla uyuşmuyor');
  return payload.subarray(2);
}

export interface UnlockedSlot {
  dek: Uint8Array;
  role: VaultRole;
  slotIndex: number;
}

/**
 * Trials every slot — no early exit, so the work done is identical whether the
 * PIN matches slot 0, slot 3, or nothing. (The argon2id run dominates these
 * four AES-GCM operations by five orders of magnitude anyway.)
 */
function trialSlots(kek: Uint8Array, rec: VaultRecord): UnlockedSlot | null {
  const matches: UnlockedSlot[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const role = ROLE_FOR_SLOT[i];
    if (!role) continue; // reserved slot is always filler
    const dek = openSlot(kek, rec.slots[i], role);
    if (dek) matches.push({ dek, role, slotIndex: i });
  }
  // Two slots opening under one KEK means two roles share a PIN: fail closed
  // rather than letting slot order decide which vault a coerced PIN opens.
  if (matches.length > 1) {
    for (const m of matches) zeroize(m.dek);
    throw new VaultCorruptError('Birden fazla slot aynı PIN ile açılıyor');
  }
  return matches[0] ?? null;
}

/** Throws PinInUseError if `kek` opens any slot other than `exceptIndex`. */
function assertPinFree(kek: Uint8Array, rec: VaultRecord, exceptIndex: number): void {
  for (let i = 0; i < SLOT_COUNT; i++) {
    const role = ROLE_FOR_SLOT[i];
    if (!role || i === exceptIndex) continue;
    const dek = openSlot(kek, rec.slots[i], role);
    if (dek) {
      zeroize(dek);
      throw new PinInUseError();
    }
  }
}

// ── Decoy escrow ────────────────────────────────────────────────────────────
//
// Lets the PRIMARY vault manage the decoy's PIN without knowing it. There is no
// reverse escrow: a decoy session can never reach DEK_primary.

function escrowKey(dekPrimary: Uint8Array): Uint8Array {
  return hkdf256(dekPrimary, EMPTY_SALT, 'vault/decoy-escrow/v1', KEY_LEN);
}

interface EscrowContent {
  flags: number;
  dekDecoy: Uint8Array;
}

function sealEscrow(dekPrimary: Uint8Array, flags: number, dekDecoy: Uint8Array): Uint8Array {
  const kEsc = escrowKey(dekPrimary);
  const payload = concatBytes(Uint8Array.of(flags), dekDecoy);
  const iv = randomBytes(GCM_IV_LEN);
  try {
    return concatBytes(iv, gcmSeal(kEsc, iv, payload, ESCROW_AAD));
  } finally {
    zeroize(payload);
    zeroize(kEsc);
  }
}

/** Returns null when no decoy exists (the escrow region is random filler). */
function openEscrow(dekPrimary: Uint8Array, escrow: Uint8Array): EscrowContent | null {
  const kEsc = escrowKey(dekPrimary);
  try {
    const payload = gcmOpen(kEsc, escrow.subarray(0, GCM_IV_LEN), escrow.subarray(GCM_IV_LEN), ESCROW_AAD);
    if (payload.length !== ESCROW_PAYLOAD_LEN) throw new VaultCorruptError('Escrow içeriği bozuk');
    return { flags: payload[0], dekDecoy: payload.subarray(1) };
  } catch (e) {
    if (e instanceof IntegrityError) return null;
    throw e;
  } finally {
    zeroize(kEsc);
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function vaultExists(): Promise<boolean> {
  if ((await SecureStore.getItemAsync(KEY_RECORD, SECURE_OPTS)) != null) return true;
  return (await SecureStore.getItemAsync(LEGACY_KEY_WRAPPED_DEK, SECURE_OPTS)) != null;
}

/** Creates a brand-new vault. Returns the plaintext DEK. */
export async function createVault(pin: string): Promise<Uint8Array> {
  // Guard at the crypto layer, not just the UI: reaching this with a vault
  // present would overwrite the pepper and orphan every byte of content.
  if (await vaultExists()) throw new VaultCorruptError('Kasa zaten var');

  const pepper = randomBytes(KEY_LEN);
  const pinSalt = randomBytes(PIN_SALT_LEN);
  const dek = randomBytes(KEY_LEN);
  const params = DEFAULT_KDF_PARAMS;

  const kek = await deriveKek(pin, pinSalt, pepper, params);
  const slots: Uint8Array[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    slots.push(i === SLOT_PRIMARY ? sealSlot(kek, 'primary', dek) : randomBytes(SLOT_LEN));
  }
  zeroize(kek);

  await SecureStore.setItemAsync(KEY_PEPPER, base64Encode(pepper), SECURE_OPTS);
  await SecureStore.setItemAsync(KEY_KDF_PARAMS, JSON.stringify(params), SECURE_OPTS);
  await saveRecord({ pinSalt, slots, escrow: randomBytes(ESCROW_LEN) });
  await SecureStore.setItemAsync(KEY_ATTEMPTS, JSON.stringify({ count: 0, lockUntil: 0 }), SECURE_OPTS);
  zeroize(pepper);
  return dek;
}

/**
 * Converts a pre-multi-slot vault in place, reusing the KEK the caller already
 * derived so the user pays no extra argon2id run and notices nothing.
 *
 * Write order matters: the new record lands BEFORE the legacy entries are
 * removed, so a crash in between leaves both present and the next unlock
 * (which always prefers the new record) cleans up.
 */
async function migrateLegacy(pin: string, pepper: Uint8Array, params: StoredKdfParams): Promise<UnlockedSlot> {
  const pinSalt = base64Decode(await getRequired(LEGACY_KEY_PIN_SALT));
  const wrapped = base64Decode(await getRequired(LEGACY_KEY_WRAPPED_DEK));
  if (wrapped.length <= GCM_IV_LEN) throw new VaultCorruptError('wrappedDek bozuk');

  const kek = await deriveKek(pin, pinSalt, pepper, params);
  let dek: Uint8Array;
  try {
    dek = gcmOpen(kek, wrapped.subarray(0, GCM_IV_LEN), wrapped.subarray(GCM_IV_LEN));
  } catch (e) {
    zeroize(kek);
    if (e instanceof IntegrityError) throw new WrongPinError();
    throw e;
  }

  const slots: Uint8Array[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    slots.push(i === SLOT_PRIMARY ? sealSlot(kek, 'primary', dek) : randomBytes(SLOT_LEN));
  }
  zeroize(kek);

  await saveRecord({ pinSalt, slots, escrow: randomBytes(ESCROW_LEN) });
  await SecureStore.deleteItemAsync(LEGACY_KEY_WRAPPED_DEK, SECURE_OPTS);
  await SecureStore.deleteItemAsync(LEGACY_KEY_PIN_SALT, SECURE_OPTS);

  return { dek, role: 'primary', slotIndex: SLOT_PRIMARY };
}

/** Unwraps a DEK with the given PIN. Throws WrongPinError when no slot opens. */
export async function unlockVault(pin: string): Promise<UnlockedSlot> {
  const { pepper, params } = await loadContext();
  try {
    const rec = await loadRecord();
    if (!rec) return await migrateLegacy(pin, pepper, params);

    // A crash mid-migration can leave both layouts behind; the record wins.
    if ((await SecureStore.getItemAsync(LEGACY_KEY_WRAPPED_DEK, SECURE_OPTS)) != null) {
      await SecureStore.deleteItemAsync(LEGACY_KEY_WRAPPED_DEK, SECURE_OPTS);
      await SecureStore.deleteItemAsync(LEGACY_KEY_PIN_SALT, SECURE_OPTS);
    }

    const kek = await deriveKek(pin, rec.pinSalt, pepper, params);
    let opened: UnlockedSlot | null;
    try {
      opened = trialSlots(kek, rec);
    } finally {
      zeroize(kek);
    }
    if (!opened) throw new WrongPinError();

    // The duress wipe lives here, not in a caller, so no code path can reach a
    // duress unlock without it happening first. The slot wraps the decoy's DEK,
    // so what follows is an ordinary decoy session.
    if (opened.role === 'duress') await destroyPrimarySlot();
    return opened;
  } finally {
    zeroize(pepper);
  }
}

/**
 * Re-wraps one slot's DEK under a new PIN. Media is never re-encrypted.
 *
 * `requiredRole` scopes the check to the caller's own slot: typing the primary
 * PIN into a decoy session's change-PIN screen must be indistinguishable from
 * typing gibberish, so the same work happens and the same error comes back.
 */
export async function changePin(oldPin: string, newPin: string, requiredRole: VaultRole): Promise<void> {
  const rec = await loadRecord();
  if (!rec) throw new VaultCorruptError('Kasa kaydı yok');
  const { pepper, params } = await loadContext();

  try {
    const kekOld = await deriveKek(oldPin, rec.pinSalt, pepper, params);
    let opened: UnlockedSlot | null;
    try {
      opened = trialSlots(kekOld, rec);
    } finally {
      zeroize(kekOld);
    }
    if (!opened || opened.role !== requiredRole) {
      if (opened) zeroize(opened.dek);
      throw new WrongPinError();
    }

    const kekNew = await deriveKek(newPin, rec.pinSalt, pepper, params);
    try {
      assertPinFree(kekNew, rec, opened.slotIndex);
      rec.slots[opened.slotIndex] = sealSlot(kekNew, opened.role, opened.dek);
    } finally {
      zeroize(kekNew);
      zeroize(opened.dek);
    }
    await saveRecord(rec);
  } finally {
    zeroize(pepper);
  }
}

/**
 * True when `pin` opens exactly the slot belonging to `role`. Used to gate
 * destructive settings behind a re-entry of the primary PIN.
 */
export async function verifyPinForRole(pin: string, role: VaultRole): Promise<boolean> {
  const rec = await loadRecord();
  if (!rec) return false;
  const { pepper, params } = await loadContext();
  try {
    const kek = await deriveKek(pin, rec.pinSalt, pepper, params);
    try {
      const opened = trialSlots(kek, rec);
      if (!opened) return false;
      zeroize(opened.dek);
      return opened.role === role;
    } finally {
      zeroize(kek);
    }
  } finally {
    zeroize(pepper);
  }
}

/** Deletes every SecureStore entry. Caller must also wipe files + DB. */
export async function destroyVaultKeys(): Promise<void> {
  for (const key of ALL_KEYS) {
    await SecureStore.deleteItemAsync(key, SECURE_OPTS);
  }
}

// ── Decoy management (primary session only) ─────────────────────────────────

export interface DecoyState {
  decoyEnabled: boolean;
  duressEnabled: boolean;
}

export async function getDecoyState(dekPrimary: Uint8Array): Promise<DecoyState> {
  const rec = await loadRecord();
  if (!rec) return { decoyEnabled: false, duressEnabled: false };
  const escrow = openEscrow(dekPrimary, rec.escrow);
  if (!escrow) return { decoyEnabled: false, duressEnabled: false };
  const state = { decoyEnabled: true, duressEnabled: (escrow.flags & FLAG_DURESS) !== 0 };
  zeroize(escrow.dekDecoy);
  return state;
}

/** Creates the decoy vault under its own PIN. Returns the new decoy DEK. */
export async function enableDecoy(dekPrimary: Uint8Array, decoyPin: string): Promise<Uint8Array> {
  const rec = await loadRecord();
  if (!rec) throw new VaultCorruptError('Kasa kaydı yok');
  const existing = openEscrow(dekPrimary, rec.escrow);
  if (existing) {
    zeroize(existing.dekDecoy);
    throw new VaultCorruptError('Yem kasa zaten var');
  }

  const { pepper, params } = await loadContext();
  const dekDecoy = randomBytes(KEY_LEN);
  try {
    const kek = await deriveKek(decoyPin, rec.pinSalt, pepper, params);
    try {
      assertPinFree(kek, rec, SLOT_DECOY);
      rec.slots[SLOT_DECOY] = sealSlot(kek, 'decoy', dekDecoy);
    } finally {
      zeroize(kek);
    }
    rec.escrow = sealEscrow(dekPrimary, 0, dekDecoy);
    await saveRecord(rec);
  } finally {
    zeroize(pepper);
  }
  return dekDecoy;
}

/** Re-wraps the decoy DEK under a new PIN. The old decoy PIN is not needed. */
export async function resetDecoyPin(dekPrimary: Uint8Array, newDecoyPin: string): Promise<void> {
  const rec = await loadRecord();
  if (!rec) throw new VaultCorruptError('Kasa kaydı yok');
  const escrow = openEscrow(dekPrimary, rec.escrow);
  if (!escrow) throw new VaultCorruptError('Yem kasa yok');

  const { pepper, params } = await loadContext();
  try {
    const kek = await deriveKek(newDecoyPin, rec.pinSalt, pepper, params);
    try {
      assertPinFree(kek, rec, SLOT_DECOY);
      rec.slots[SLOT_DECOY] = sealSlot(kek, 'decoy', escrow.dekDecoy);
    } finally {
      zeroize(kek);
    }
    await saveRecord(rec);
  } finally {
    zeroize(escrow.dekDecoy);
    zeroize(pepper);
  }
}

/**
 * Overwrites the decoy slot, the duress slot and the escrow with random bytes.
 * Duress goes too — it wraps the decoy's DEK, so it would otherwise be orphaned.
 */
export async function disableDecoy(dekPrimary: Uint8Array): Promise<void> {
  const rec = await loadRecord();
  if (!rec) throw new VaultCorruptError('Kasa kaydı yok');
  const escrow = openEscrow(dekPrimary, rec.escrow);
  if (escrow) zeroize(escrow.dekDecoy);
  rec.slots[SLOT_DECOY] = randomBytes(SLOT_LEN);
  rec.slots[SLOT_DURESS] = randomBytes(SLOT_LEN);
  rec.escrow = randomBytes(ESCROW_LEN);
  await saveRecord(rec);
}

// ── Duress slot ─────────────────────────────────────────────────────────────
//
// Wraps the DECOY's DEK, so unlocking with it lands straight in the decoy after
// the primary slot is destroyed. Requires an existing decoy.

export async function enableDuress(dekPrimary: Uint8Array, duressPin: string): Promise<void> {
  const rec = await loadRecord();
  if (!rec) throw new VaultCorruptError('Kasa kaydı yok');
  const escrow = openEscrow(dekPrimary, rec.escrow);
  if (!escrow) throw new VaultCorruptError('Panik PIN için önce yem kasa gerekir');

  const { pepper, params } = await loadContext();
  try {
    const kek = await deriveKek(duressPin, rec.pinSalt, pepper, params);
    try {
      assertPinFree(kek, rec, SLOT_DURESS);
      rec.slots[SLOT_DURESS] = sealSlot(kek, 'duress', escrow.dekDecoy);
    } finally {
      zeroize(kek);
    }
    rec.escrow = sealEscrow(dekPrimary, escrow.flags | FLAG_DURESS, escrow.dekDecoy);
    await saveRecord(rec);
  } finally {
    zeroize(escrow.dekDecoy);
    zeroize(pepper);
  }
}

export async function disableDuress(dekPrimary: Uint8Array): Promise<void> {
  const rec = await loadRecord();
  if (!rec) throw new VaultCorruptError('Kasa kaydı yok');
  const escrow = openEscrow(dekPrimary, rec.escrow);
  if (!escrow) return;
  try {
    rec.slots[SLOT_DURESS] = randomBytes(SLOT_LEN);
    rec.escrow = sealEscrow(dekPrimary, escrow.flags & ~FLAG_DURESS, escrow.dekDecoy);
    await saveRecord(rec);
  } finally {
    zeroize(escrow.dekDecoy);
  }
}

/**
 * The duress action: one write that randomizes the primary slot and the escrow.
 * Needs no KEK, completes instantly, and is irreversible — the primary DEK can
 * never be derived again, so its ciphertext is permanently unreadable.
 *
 * Deliberately does NOT delete files: erasing gigabytes during a coerced unlock
 * takes visible seconds, which is itself a tell. The husk stays unreadable.
 */
export async function destroyPrimarySlot(): Promise<void> {
  const rec = await loadRecord();
  if (!rec) return;
  rec.slots[SLOT_PRIMARY] = randomBytes(SLOT_LEN);
  rec.escrow = randomBytes(ESCROW_LEN);
  await saveRecord(rec);
}

// ── Subkeys (domain separation over each vault's DEK) ───────────────────────

/** Per-file subkey: DEK never touches file data directly. */
export function deriveFileKey(dek: Uint8Array, fileSalt: Uint8Array): Uint8Array {
  return hkdf256(dek, fileSalt, 'vault/file/v1', KEY_LEN);
}

/** Subkey for SQLite field encryption. */
export function deriveDbKey(dek: Uint8Array): Uint8Array {
  return hkdf256(dek, EMPTY_SALT, 'vault/db/v1', KEY_LEN);
}

/** Subkey for row ownership tags. */
export function deriveTagKey(dek: Uint8Array): Uint8Array {
  return hkdf256(dek, EMPTY_SALT, 'vault/tag/v1', KEY_LEN);
}

export const ROW_TAG_LEN = 16;

/**
 * Per-row ownership tag. Deliberately NOT one constant per vault: a repeated
 * constant would partition the tables in plaintext and prove a second vault
 * exists. Every row's tag is unique and unlinkable without the tag key.
 */
export function rowTag(tagKey: Uint8Array, rowId: string): Uint8Array {
  return hmacSha256(tagKey, utf8Encode(rowId)).subarray(0, ROW_TAG_LEN);
}

// ── Failed-attempt backoff ──────────────────────────────────────────────────
// UI-level deterrent only; the cryptographic wall is the pepper + KDF.

export interface AttemptState {
  count: number;
  lockUntil: number; // epoch ms, 0 = not locked out
}

const BACKOFF_MS = [0, 0, 0, 30_000, 60_000, 300_000, 900_000, 3_600_000];

export function backoffForCount(count: number): number {
  return BACKOFF_MS[Math.min(count, BACKOFF_MS.length - 1)];
}

export async function getAttempts(): Promise<AttemptState> {
  const raw = await SecureStore.getItemAsync(KEY_ATTEMPTS, SECURE_OPTS);
  if (!raw) return { count: 0, lockUntil: 0 };
  try {
    const parsed = JSON.parse(raw) as AttemptState;
    return { count: parsed.count ?? 0, lockUntil: parsed.lockUntil ?? 0 };
  } catch {
    return { count: 0, lockUntil: 0 };
  }
}

export async function recordFailedAttempt(now: number): Promise<AttemptState> {
  const prev = await getAttempts();
  const count = prev.count + 1;
  const delay = backoffForCount(count);
  const next: AttemptState = { count, lockUntil: delay > 0 ? now + delay : 0 };
  await SecureStore.setItemAsync(KEY_ATTEMPTS, JSON.stringify(next), SECURE_OPTS);
  return next;
}

export async function resetAttempts(): Promise<void> {
  await SecureStore.setItemAsync(KEY_ATTEMPTS, JSON.stringify({ count: 0, lockUntil: 0 }), SECURE_OPTS);
}
