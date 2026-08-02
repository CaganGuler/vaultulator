/**
 * SQLite schema. Versioned via PRAGMA user_version.
 *
 * Crypto parameters intentionally do NOT live here — every *.enc file is
 * self-describing (see crypto/format.ts), so DB corruption can never orphan
 * the crypto params. Numeric metadata (sizes, dimensions, timestamps) stays
 * in plaintext for sorting/queries; this leaks minor metadata and is
 * documented in docs/SECURITY.md. Sensitive text is encrypted per-field.
 */

export const SCHEMA_VERSION = 3;

export const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media_items (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL CHECK (type IN ('photo','video')),
    file_name   TEXT NOT NULL,
    thumb_name  TEXT,
    mime        TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    width       INTEGER,
    height      INTEGER,
    duration_ms INTEGER,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_media_created ON media_items(created_at DESC);

  CREATE TABLE IF NOT EXISTS notes (
    id         TEXT PRIMARY KEY,
    title_enc  BLOB NOT NULL,
    body_enc   BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
  `,

  // v2 — per-row ownership tags, so one database can hold two vaults.
  //
  // Schema only: the tag is HMAC(tagKey, rowId) and tagKey only exists once a
  // PIN has been entered, so existing rows are backfilled at the first primary
  // unlock (see backfillRowTags). This migration runs at cold start, before
  // any unlock, and must therefore need no key material.
  //
  // Nullable by necessity — SQLite cannot add a NOT NULL column without a
  // constant default, and a constant default is exactly what must not exist:
  // a value repeated across rows would partition the tables in plaintext and
  // prove a second vault exists.
  `
  ALTER TABLE media_items ADD COLUMN vault_tag BLOB;
  ALTER TABLE notes       ADD COLUMN vault_tag BLOB;
  `,

  // v3 — documents, captions and albums.
  //
  // media_items is REBUILT, not ALTERed: the type CHECK has to widen to accept
  // 'document' and SQLite cannot alter a constraint in place. The rebuild is
  // also the cheapest moment to add the new encrypted columns, so there is no
  // ADD COLUMN here at all. The widened CHECK is a strict superset of the old
  // one, so no existing row can fail the copy — a CHECK violation inside
  // INSERT..SELECT would roll the migration back on every cold start and the
  // app would never open again.
  //
  // vault_tag stays NULLABLE in the rebuilt table even though a rebuild could
  // tighten it. A device still on schema v1 that has not unlocked since
  // reaches v3 with every vault_tag NULL; backfillRowTags claims them at the
  // first primary unlock, which is strictly after every migration. NOT NULL
  // here would abort on exactly the devices carrying the oldest data.
  //
  // albums.vault_tag IS NOT NULL, which is not a contradiction: the table is
  // created empty, so there is no pre-existing row to violate it and no
  // constant default to invent. The v2 rule binds ALTER TABLE, not CREATE.
  //
  // Album membership is an encrypted, padded id list inside the album row —
  // NOT a join table. A plaintext album_id would let anyone with the file run
  // GROUP BY and partition media_items into equivalence classes, proving which
  // items belong together and, transitively, that a second vault exists. That
  // is precisely what the per-row vault_tag exists to prevent.
  `
  CREATE TABLE media_items_v3 (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL CHECK (type IN ('photo','video','document')),
    file_name     TEXT NOT NULL,
    thumb_name    TEXT,
    mime          TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL,
    width         INTEGER,
    height        INTEGER,
    duration_ms   INTEGER,
    created_at    INTEGER NOT NULL,
    vault_tag     BLOB,
    caption_enc   BLOB,
    orig_name_enc BLOB
  );

  INSERT INTO media_items_v3
    (id, type, file_name, thumb_name, mime, size_bytes, width, height, duration_ms, created_at, vault_tag)
  SELECT
     id, type, file_name, thumb_name, mime, size_bytes, width, height, duration_ms, created_at, vault_tag
  FROM media_items;

  DROP TABLE media_items;
  ALTER TABLE media_items_v3 RENAME TO media_items;
  CREATE INDEX IF NOT EXISTS idx_media_created ON media_items(created_at DESC);

  CREATE TABLE IF NOT EXISTS albums (
    id         TEXT PRIMARY KEY,
    name_enc   BLOB NOT NULL,
    items_enc  BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    vault_tag  BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_albums_updated ON albums(updated_at DESC);
  `,
];
