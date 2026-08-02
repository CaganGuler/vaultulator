/**
 * The lock state machine.
 *
 * This file holds the plaintext DEK and decides which vault a PIN opens, so
 * the properties worth pinning down are: keys are gone after lock, a duress
 * PIN lands in the decoy with the real vault destroyed, the schema backfill
 * finishes before any screen can query, and a decoy session can neither see
 * nor sweep the other vault's content.
 */
import { File } from 'expo-file-system';

import { createVault, enableDecoy, enableDuress, getAttempts, resetAttempts } from '../../lib/crypto/keys';
import { destroyDb } from '../../lib/db';
import { insertMediaItem, listMediaItems, type MediaItem } from '../../lib/db/media-repo';
import { getDb } from '../../lib/db/connection';
import { hasUntaggedRows } from '../../lib/db/backfill';
import { mediaFileUri, thumbFileUri } from '../../lib/paths';
import { requireCtx, useSession } from '../session';
import { __reset as resetSecureStore } from '../../test/secure-store-mock';
import { __reset as resetSqlite } from '../../test/expo-sqlite-node-shim';
import { __reset as resetFs } from '../../test/file-system-mock';

const PRIMARY_PIN = '111111';
const DECOY_PIN = '222222';
const DURESS_PIN = '333333';

function item(id: string): MediaItem {
  return {
    id,
    type: 'photo',
    fileName: `${id}.enc`,
    thumbName: `${id}.thumb.enc`,
    mime: 'image/jpeg',
    sizeBytes: 10,
    width: null,
    height: null,
    durationMs: null,
    createdAt: 1,
  };
}

function putCiphertext(id: string): void {
  for (const uri of [mediaFileUri(`${id}.enc`), thumbFileUri(`${id}.thumb.enc`)]) {
    new File(uri).create({ intermediates: true, overwrite: true });
  }
}

beforeEach(async () => {
  resetSecureStore();
  resetSqlite();
  resetFs();
  await destroyDb();
  useSession.setState({ status: 'loading', ctx: null, lockUntil: 0, busy: 0 });
});

describe('lifecycle', () => {
  it('starts uninitialized with no vault and locked with one', async () => {
    await useSession.getState().init();
    expect(useSession.getState().status).toBe('uninitialized');

    await createVault(PRIMARY_PIN);
    await useSession.getState().init();
    expect(useSession.getState().status).toBe('locked');
  });

  it('create() opens a primary session', async () => {
    await useSession.getState().create(PRIMARY_PIN);
    const { status, ctx } = useSession.getState();
    expect(status).toBe('unlocked');
    expect(ctx?.role).toBe('primary');
    expect(ctx?.dek).toHaveLength(32);
  });

  it('lock() zeroizes every key in the context', async () => {
    await useSession.getState().create(PRIMARY_PIN);
    // Hold the same buffers the store holds, to prove they were wiped in place
    // rather than merely dropped from the store.
    const held = useSession.getState().ctx!;
    expect(held.dek.some((b) => b !== 0)).toBe(true);

    useSession.getState().lock();

    expect(useSession.getState().status).toBe('locked');
    expect(useSession.getState().ctx).toBeNull();
    for (const key of [held.dek, held.dbKey, held.tagKey]) {
      expect(key.every((b) => b === 0)).toBe(true);
    }
  });

  it('requireCtx refuses once locked', async () => {
    await useSession.getState().create(PRIMARY_PIN);
    expect(() => requireCtx()).not.toThrow();
    useSession.getState().lock();
    expect(() => requireCtx()).toThrow();
  });
});

describe('unlock', () => {
  it('reports the failure count on a wrong PIN', async () => {
    await createVault(PRIMARY_PIN);
    const result = await useSession.getState().unlock('000000');
    expect(result).toMatchObject({ ok: false, failedCount: 1 });
    expect(useSession.getState().status).not.toBe('unlocked');
  });

  it('reports a lockout without burning another attempt', async () => {
    await createVault(PRIMARY_PIN);
    for (let i = 0; i < 3; i++) await useSession.getState().unlock('000000');
    const locked = await useSession.getState().unlock('000000');

    expect(locked.ok).toBe(false);
    expect(locked.lockUntil).toBeGreaterThan(Date.now());
    // The gate short-circuits before the KDF, so the counter does not move.
    expect((await getAttempts()).count).toBe(3);
  });

  it('clears the counter on success', async () => {
    await createVault(PRIMARY_PIN);
    await useSession.getState().unlock('000000');
    await useSession.getState().unlock(PRIMARY_PIN);
    expect((await getAttempts()).count).toBe(0);
  });

  it('routes the decoy PIN to a decoy session', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);

    await useSession.getState().unlock(DECOY_PIN);

    expect(useSession.getState().ctx?.role).toBe('decoy');
  });
});

describe('backfill ordering', () => {
  it('tags legacy rows before the session reports unlocked', async () => {
    await createVault(PRIMARY_PIN);
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO media_items (id, type, file_name, thumb_name, mime, size_bytes, width, height, duration_ms, created_at)
       VALUES ('legacy', 'photo', 'legacy.enc', NULL, 'image/jpeg', 1, NULL, NULL, NULL, 1)`,
    );
    expect(await hasUntaggedRows()).toBe(true);

    await useSession.getState().unlock(PRIMARY_PIN);

    // The very first query a screen can make must already see the row —
    // otherwise the user opens the app after an update to an empty vault.
    expect(await hasUntaggedRows()).toBe(false);
    expect((await listMediaItems(requireCtx())).map((i) => i.id)).toEqual(['legacy']);
  });

  it('never lets a decoy session claim legacy rows', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO media_items (id, type, file_name, thumb_name, mime, size_bytes, width, height, duration_ms, created_at)
       VALUES ('legacy', 'photo', 'legacy.enc', NULL, 'image/jpeg', 1, NULL, NULL, NULL, 1)`,
    );

    await useSession.getState().unlock(DECOY_PIN);

    expect(await hasUntaggedRows()).toBe(true);
    expect(await listMediaItems(requireCtx())).toEqual([]);
  });
});

describe('duress PIN', () => {
  it('opens the decoy and destroys the real vault', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);
    await enableDuress(primaryDek, DURESS_PIN);

    const result = await useSession.getState().unlock(DURESS_PIN);

    expect(result.ok).toBe(true);
    // The UI must not be able to tell this from an ordinary decoy session.
    expect(useSession.getState().ctx?.role).not.toBe('primary');

    useSession.getState().lock();
    await resetAttempts();
    expect((await useSession.getState().unlock(PRIMARY_PIN)).ok).toBe(false);
    await resetAttempts();
    expect((await useSession.getState().unlock(DECOY_PIN)).ok).toBe(true);
  });
});

describe('wipeOwnContent', () => {
  it('removes only the calling vault’s rows and files', async () => {
    const primaryDek = await createVault(PRIMARY_PIN);
    await enableDecoy(primaryDek, DECOY_PIN);

    await useSession.getState().unlock(PRIMARY_PIN);
    await insertMediaItem(requireCtx(), item('p1'));
    putCiphertext('p1');
    useSession.getState().lock();

    await resetAttempts();
    await useSession.getState().unlock(DECOY_PIN);
    await insertMediaItem(requireCtx(), item('d1'));
    putCiphertext('d1');

    await useSession.getState().wipeOwnContent();

    expect(await listMediaItems(requireCtx())).toEqual([]);
    // A decoy session must not sweep: it cannot know the remaining rows are
    // the whole picture, and deleting "unreferenced" files would take the
    // real vault's content with it.
    expect(new File(mediaFileUri('p1.enc')).exists).toBe(true);
    expect(new File(mediaFileUri('d1.enc')).exists).toBe(false);

    useSession.getState().lock();
    await resetAttempts();
    await useSession.getState().unlock(PRIMARY_PIN);
    expect((await listMediaItems(requireCtx())).map((i) => i.id)).toEqual(['p1']);
  });
});

describe('busy marking', () => {
  it('counts nested work and releases exactly once', () => {
    const { beginBusy } = useSession.getState();
    const releaseA = beginBusy();
    const releaseB = beginBusy();
    expect(useSession.getState().busy).toBe(2);

    releaseA();
    releaseA(); // double release must not underflow past the other holder
    expect(useSession.getState().busy).toBe(1);

    releaseB();
    expect(useSession.getState().busy).toBe(0);
  });
});
