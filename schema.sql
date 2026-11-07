-- schema.sql - THE BLUEPRINT (Pillar 1) for PostgreSQL (the shared cloud database).
-- (schema.sqlite.sql is the same design for the local-file fallback.)
-- Two tables with a ONE-TO-MANY relationship:
--      one CATEGORY  --->  many TASKS

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- PRIMARY KEY: the unique ID of each row
  name TEXT NOT NULL UNIQUE                                -- NOT NULL + UNIQUE: no empty or repeated names
       CHECK (name = lower(name) AND length(name) BETWEEN 1 AND 30)
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text        TEXT    NOT NULL                             -- same 1-80 characters rule as validators.js
              CHECK (length(btrim(text)) BETWEEN 1 AND 80),
  category_id INTEGER NOT NULL                             -- FOREIGN KEY: must point to a real category
              REFERENCES categories (id) ON DELETE RESTRICT,  -- can't delete a category that still has tasks
  done        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ                                  -- stays empty (NULL) until the task is changed
);

CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks (category_id);
CREATE INDEX IF NOT EXISTS idx_tasks_done     ON tasks (done);

-- Remembers small facts, e.g. "the starter tasks were already added once"
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
