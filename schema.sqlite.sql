-- schema.sqlite.sql - the same design as schema.sql, written for SQLite (local file fallback).
-- Differences: SQLite has no true/false type (done is 0 or 1) and stores dates as text.

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
       CHECK (name = lower(name) AND length(name) BETWEEN 1 AND 30)
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT    NOT NULL
              CHECK (length(trim(text)) BETWEEN 1 AND 80),
  category_id INTEGER NOT NULL
              REFERENCES categories (id) ON DELETE RESTRICT,
  done        INTEGER NOT NULL DEFAULT 0
              CHECK (done IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks (category_id);
CREATE INDEX IF NOT EXISTS idx_tasks_done     ON tasks (done);

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
