/**
 * Lock state machine. The plaintext DEK (and the derived subkeys) exist ONLY
 * inside this store while the vault is unlocked — never persisted.
 *
 *   loading ──init──► uninitialized | locked
 *   uninitialized ──create(pin)──► unlocked
 *   locked ──unlock(pin)──► unlocked
 *   unlocked ──lock()──► locked   (wipes decrypted temp + zeroizes keys)
 *
 * Which vault got unlocked is decided by which PIN was entered (see
 * lib/crypto/keys.ts). `role` is authenticated key material, not a setting —
 * a decoy session cannot flip it. Every UI gate must therefore ask
 * `role === 'primary'` and nothing else; a screen that distinguishes 'decoy'
 * from 'duress' would leak that a duress PIN exists.
 *
 * There is no in-place vault switch: changing role always goes through lock().
 */
import { Image } from 'expo-image';
import { create } from 'zustand';

import {
  backoffForCount,
  changePin as changePinKeys,
  createVault,
  deriveDbKey,
  deriveTagKey,
  destroyVaultKeys,
  getAttempts,
  LockedOutError,
  unlockVault,
  vaultExists,
  type VaultRole,
  WrongPinError,
} from '../lib/crypto/keys';
import { zeroize } from '../lib/crypto/primitives';
import { destroyDb } from '../lib/db';
import { backfillRowTags } from '../lib/db/backfill';
import { deleteAllAlbumsOf } from '../lib/db/albums-repo';
import { deleteAllMediaOf, listAllReferencedFiles } from '../lib/db/media-repo';
import { deleteAllNotesOf } from '../lib/db/notes-repo';
import type { VaultContext } from '../lib/db/scope';
import { forgetPhotoTemps } from '../lib/media/photo-cache';
import { clearThumbCache } from '../lib/media/viewer-cache';
import { ensureVaultDirs, sweepOrphanFiles, wipeDecryptedDir, wipeVaultFiles } from '../lib/paths';

export type SessionStatus = 'loading' | 'uninitialized' | 'locked' | 'unlocked';

export type ChangePinResult = 'ok' | 'wrong' | 'locked';

export interface UnlockResult {
  ok: boolean;
  /** Set when the vault is in a backoff lockout (epoch ms). */
  lockUntil?: number;
  failedCount?: number;
}

/** Raised when a long operation outlives the session it started in. */
export class SessionChangedError extends Error {
  constructor() {
    super('Oturum değişti');
    this.name = 'SessionChangedError';
  }
}

interface SessionState {
  status: SessionStatus;
  ctx: VaultContext | null;
  lockUntil: number;
  /** Non-zero while work that must not be interrupted is in flight. */
  busy: number;
  /** Marks a long operation; call the returned function when it finishes. */
  beginBusy(): () => void;
  init(): Promise<void>;
  create(pin: string): Promise<void>;
  unlock(pin: string): Promise<UnlockResult>;
  lock(): void;
  changePin(oldPin: string, newPin: string): Promise<ChangePinResult>;
  /** Full reset. Primary sessions only — a decoy must use wipeOwnContent(). */
  destroy(): Promise<void>;
  /** Wipes only this vault's rows and files; the other vault is untouched. */
  wipeOwnContent(): Promise<void>;
}

function contextFor(dek: Uint8Array, role: VaultRole): VaultContext {
  return { dek, dbKey: deriveDbKey(dek), tagKey: deriveTagKey(dek), role };
}

function zeroizeContext(ctx: VaultContext | null): void {
  if (!ctx) return;
  zeroize(ctx.dek);
  zeroize(ctx.dbKey);
  zeroize(ctx.tagKey);
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  ctx: null,
  lockUntil: 0,
  busy: 0,

  beginBusy() {
    set((s) => ({ busy: s.busy + 1 }));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((s) => ({ busy: Math.max(0, s.busy - 1) }));
    };
  },

  async init() {
    wipeDecryptedDir(); // covers temp files left behind by a crash / force kill
    // One-time cleanup of a real leak: until cachePolicy was pinned to
    // 'memory', expo-image persisted every decrypted thumbnail and photo into
    // SDWebImage's / Glide's own disk cache — outside <cache>/decrypted/, and
    // wiped by nothing. The app is fully offline, so there is no legitimate
    // remote image in that cache to lose.
    void Image.clearDiskCache().catch(() => undefined);
    ensureVaultDirs();
    const exists = await vaultExists();
    const attempts = exists ? await getAttempts() : { count: 0, lockUntil: 0 };
    set({ status: exists ? 'locked' : 'uninitialized', lockUntil: attempts.lockUntil });
  },

  async create(pin: string) {
    ensureVaultDirs();
    const dek = await createVault(pin);
    set({ status: 'unlocked', ctx: contextFor(dek, 'primary'), lockUntil: 0 });
  },

  async unlock(pin: string) {
    try {
      // The lockout gate and the attempt counter live in unlockVault, not here,
      // so no PIN path in the app can be an unmetered guessing oracle. A duress
      // PIN likewise destroys the primary slot in there before returning.
      const opened = await unlockVault(pin);
      const ctx = contextFor(opened.dek, opened.role);

      // Must finish before the status flip: a scoped query running against
      // un-backfilled rows would show the user an empty vault.
      await backfillRowTags(ctx);

      // Sweep ciphertext no row references any more — a crash between
      // encryptFile and insertMediaItem would otherwise leave it on disk
      // forever. Primary only: it is the session that can be sure the
      // remaining rows are the complete picture.
      if (ctx.role === 'primary') {
        void listAllReferencedFiles()
          .then(sweepOrphanFiles)
          .catch(() => undefined); // housekeeping must never block an unlock
      }

      clearThumbCache(); // a duress unlock arrives without a preceding lock()
      set({ status: 'unlocked', ctx, lockUntil: 0 });
      return { ok: true };
    } catch (e) {
      if (e instanceof LockedOutError) {
        set({ lockUntil: e.lockUntil });
        return { ok: false, lockUntil: e.lockUntil };
      }
      if (e instanceof WrongPinError) {
        const next = await getAttempts();
        set({ lockUntil: next.lockUntil });
        return { ok: false, lockUntil: next.lockUntil, failedCount: next.count };
      }
      throw e;
    }
  },

  lock() {
    const { ctx, status } = get();
    if (status !== 'unlocked') return;
    // A leftover here means plaintext survived a lock — invariant #2. paths.ts
    // reports survivors rather than swallowing the failure, so retry once
    // before giving up; a writer may still have held a handle.
    if (wipeDecryptedDir().length > 0) wipeDecryptedDir();
    clearThumbCache();
    forgetPhotoTemps(); // the files are gone; drop the index that points at them
    // Without this the decoded bitmap of every thumbnail viewed this session
    // stays in expo-image's native memory cache after the vault is locked.
    void Image.clearMemoryCache().catch(() => undefined);
    zeroizeContext(ctx);
    set({ status: 'locked', ctx: null });
  },

  async changePin(oldPin: string, newPin: string) {
    const { ctx } = get();
    if (!ctx) throw new Error('İçerik kilitli');
    try {
      // Scoped to this session's own slot. Every rejection reason collapses to
      // 'wrong' on purpose — a decoy session must not be able to tell "that PIN
      // belongs to another vault" apart from "that PIN is simply wrong".
      await changePinKeys(oldPin, newPin, ctx.role);
      return 'ok' as const;
    } catch (e) {
      if (e instanceof WrongPinError) return 'wrong' as const;
      if (e instanceof LockedOutError) return 'locked' as const;
      throw e;
    }
  },

  async destroy() {
    const { ctx } = get();
    zeroizeContext(ctx);
    clearThumbCache();
    await destroyVaultKeys();
    await destroyDb();
    wipeVaultFiles();
    set({ status: 'uninitialized', ctx: null, lockUntil: 0 });
  },

  async wipeOwnContent() {
    const ctx = requireCtx();
    await deleteAllMediaOf(ctx);
    await deleteAllNotesOf(ctx);
    // Without this a decoy's "reset the vault" would leave its albums
    // standing — a self-inconsistent story for the one screen that exists to
    // be convincing.
    await deleteAllAlbumsOf(ctx);
    clearThumbCache();
    wipeDecryptedDir();
    // Only a primary session may sweep: it is the one that can be sure the
    // remaining rows are the complete picture.
    if (ctx.role === 'primary') sweepOrphanFiles(await listAllReferencedFiles());
  },
}));

/** Throws unless unlocked — call sites inside the vault can rely on it. */
export function requireCtx(): VaultContext {
  const { ctx, status } = useSession.getState();
  if (status !== 'unlocked' || !ctx) throw new Error('İçerik kilitli');
  return ctx;
}

/**
 * Throws if the session has moved on since `ctx` was taken.
 *
 * lock() zeroizes the context's buffers in place, so anything holding a `ctx`
 * across an await keeps a reference that can silently turn into zeros. That is
 * not hypothetical: encrypting a large video takes minutes and produces no
 * touch events, so the inactivity timer fires mid-pipeline and the remaining
 * steps would derive keys and ownership tags from an all-zero buffer — writing
 * a row that belongs to no vault and content nothing can decrypt.
 *
 * Long operations must call this before they commit anything.
 */
export function assertStillCurrent(ctx: VaultContext): void {
  if (useSession.getState().ctx !== ctx) throw new SessionChangedError();
}

/**
 * The only role question the UI may ask. Decoy and duress sessions must be
 * indistinguishable from each other on screen.
 */
export function useIsPrimary(): boolean {
  return useSession((s) => s.ctx?.role === 'primary');
}

export { backoffForCount };
