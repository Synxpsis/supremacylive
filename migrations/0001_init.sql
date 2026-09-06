-- Supremacy Live — accounts schema.
-- Applied automatically by worker.js on first request too; this file exists
-- so you can `wrangler d1 migrations apply supremacy-live --local` and see
-- the shape without hitting the API.

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_salt    TEXT NOT NULL,   -- 16 bytes, hex
  pw_hash    TEXT NOT NULL,   -- PBKDF2-SHA256 32 bytes, hex
  created_at INTEGER NOT NULL,
  last_login INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,   -- 32 random bytes, hex; opaque, revocable
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
