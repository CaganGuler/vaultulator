/**
 * SQLite schema. Versioned via PRAGMA user_version.
 *
 * Crypto parameters intentionally do NOT live here — every *.enc file is
 * self-describing (see crypto/format.ts), so DB corruption can never orphan
 * the crypto params. Numeric metadata (sizes, dimensions, timestamps) stays
 * in plaintext for sorting/queries; this leaks minor metadata and is
 * documented in docs/SECURITY.md. Sensitive text is encrypted per-field.
 */

export const SCHEMA_VERSION = 2;

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
];
