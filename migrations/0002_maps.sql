-- Supremacy Live — live-editable map content.
-- One row per board key. `definition` is the same JSON shape as the MAPS
-- entries in public/map.js — FPMap.build() accepts it directly. Applied
-- automatically by worker.js on first request too; see 0001_init.sql.

CREATE TABLE IF NOT EXISTS maps (
  key        TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  definition TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
