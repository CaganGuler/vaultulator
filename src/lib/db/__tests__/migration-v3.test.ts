/**
 * The v3 migration, as data.
 *
 * v3 rebuilds media_items — the table holding every item in the vault — because
 * SQLite cannot widen a CHECK constraint in place. There is no backup and no
 * recovery path, so this is the single most dangerous statement in the
 * codebase and it gets its own file.
 *
 * MIGRATIONS is an exported array of plain strings, so the SQL can be applied
 * to a bare database and inspected directly rather than through the app.
 */
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS, SCHEMA_VERSION } from '../schema';

function migrated(through = SCHEMA_VERSION): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (let v = 0; v < through; v++) db.exec(MIGRATIONS[v]!);
  return db;
}

/** A row as schema v1 wrote it: no vault_tag column value at all. */
function insertV1Row(db: DatabaseSync, id: string, type = 'photo'): void {
  db.exec(
    `INSERT INTO media_items (id, type, file_name, thumb_name, mime, size_bytes, width, height, duration_ms, created_at)
     VALUES ('${id}', '${type}', '${id}.enc', NULL, 'image/jpeg', 42, NULL, NULL, NULL, 7)`,
  );
}

function columns(db: DatabaseSync, table: string): { name: string; notnull: number }[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[];
}

describe('rebuilding media_items', () => {
  it('carries every row across unchanged', () => {
    const db = migrated(2);
    insertV1Row(db, 'a');
    insertV1Row(db, 'b', 'video');
    db.exec("UPDATE media_items SET vault_tag = x'0102030405060708090a0b0c0d0e0f10' WHERE id = 'a'");

    db.exec(MIGRATIONS[2]!);

    const rows = db.prepare('SELECT id, type, size_bytes, created_at, vault_tag FROM media_items ORDER BY id').all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'a', type: 'photo', size_bytes: 42, created_at: 7 });
    // The tag must survive byte for byte: one wrong byte and the row belongs
    // to no vault, which means invisible and unrecoverable.
    expect(Buffer.from((rows[0] as { vault_tag: Uint8Array }).vault_tag)).toEqual(
      Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    );
  });

  it('preserves a NULL vault_tag', () => {
    // The v1-device-that-never-unlocked case. If the rebuild invented a tag
    // here, backfillRowTags would never claim the row and the user's oldest
    // content would vanish on upgrade.
    const db = migrated(2);
    insertV1Row(db, 'untagged');

    db.exec(MIGRATIONS[2]!);

    const row = db.prepare("SELECT vault_tag FROM media_items WHERE id = 'untagged'").get();
    expect((row as { vault_tag: unknown }).vault_tag).toBeNull();
  });

  it('keeps media_items.vault_tag nullable and albums.vault_tag not null', () => {
    const db = migrated();
    // The asymmetry is deliberate and load-bearing; pin it so nobody "tidies"
    // the nullable column later.
    expect(columns(db, 'media_items').find((c) => c.name === 'vault_tag')?.notnull).toBe(0);
    expect(columns(db, 'albums').find((c) => c.name === 'vault_tag')?.notnull).toBe(1);
  });

  it('adds the new encrypted columns as nullable', () => {
    const db = migrated();
    const cols = columns(db, 'media_items');
    for (const name of ['caption_enc', 'orig_name_enc']) {
      expect(cols.find((c) => c.name === name)?.notnull).toBe(0);
    }
  });

  it('accepts documents and still rejects anything else', () => {
    const db = migrated();
    expect(() => insertV1Row(db, 'doc', 'document')).not.toThrow();
    expect(() => insertV1Row(db, 'aud', 'audio')).toThrow();
  });

  it('recreates the ordering index and leaves no scratch table behind', () => {
    const db = migrated();
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')").all() as {
      name: string;
    }[]).map((r) => r.name);

    expect(names).toContain('idx_media_created');
    expect(names).not.toContain('media_items_v3');
  });

  it('creates albums empty with an updated_at index', () => {
    const db = migrated();
    expect(db.prepare('SELECT COUNT(*) AS n FROM albums').get()).toMatchObject({ n: 0 });
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(names).toContain('idx_albums_updated');
  });
});

describe('migration safety', () => {
  it('applies as one unit or not at all', () => {
    const db = migrated(2);
    insertV1Row(db, 'a');

    // Simulate a failure partway through by running the rebuild inside a
    // transaction that then rolls back, as connection.ts does on error.
    db.exec('BEGIN');
    db.exec(MIGRATIONS[2]!);
    db.exec('ROLLBACK');

    // The original table must be intact and still on the old shape.
    const cols = columns(db, 'media_items').map((c) => c.name);
    expect(cols).not.toContain('caption_enc');
    expect(db.prepare('SELECT COUNT(*) AS n FROM media_items').get()).toMatchObject({ n: 1 });
    // ...and retrying then succeeds.
    db.exec(MIGRATIONS[2]!);
    expect(columns(db, 'media_items').map((c) => c.name)).toContain('caption_enc');
  });

  it('is reachable from v1 in one run', () => {
    // A device that installed v1 and never opened the app again.
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS[0]!);
    insertV1Row(db, 'ancient');

    db.exec(MIGRATIONS[1]!);
    db.exec(MIGRATIONS[2]!);

    const row = db.prepare("SELECT id, vault_tag FROM media_items WHERE id = 'ancient'").get();
    expect(row).toMatchObject({ id: 'ancient' });
    // Still untagged, so the first primary unlock will claim it.
    expect((row as { vault_tag: unknown }).vault_tag).toBeNull();
  });

  it('leaves notes untouched', () => {
    const db = migrated(2);
    db.exec("INSERT INTO notes (id, title_enc, body_enc, created_at, updated_at) VALUES ('n', x'01', x'02', 1, 1)");

    db.exec(MIGRATIONS[2]!);

    expect(db.prepare('SELECT COUNT(*) AS n FROM notes').get()).toMatchObject({ n: 1 });
  });
});
