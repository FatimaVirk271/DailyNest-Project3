-- schema.sql - THE BLUEPRINT (Pillar 1)
-- Two tables with a ONE-TO-MANY relationship:
--      one CATEGORY  --->  many TASKS
-- (Home, Study, Health and Shopping are the 4 categories from Project 1 and 2.)

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,         -- PRIMARY KEY: the unique ID of each row
  name TEXT NOT NULL UNIQUE                       -- NOT NULL + UNIQUE: no empty or repeated names
       CHECK (name = lower(name) AND length(name) BETWEEN 1 AND 30)
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT    NOT NULL                    -- same 1-80 characters rule as validators.js
              CHECK (length(trim(text)) BETWEEN 1 AND 80),
  category_id INTEGER NOT NULL                    -- FOREIGN KEY: must point to a real category
              REFERENCES categories (id) ON DELETE RESTRICT,   -- can't delete a category that still has tasks
  done        INTEGER NOT NULL DEFAULT 0          -- SQLite has no true/false type: 0 = not done, 1 = done
              CHECK (done IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT                                -- stays empty (NULL) until the task is changed
);

-- Indexes make the filters used by the page (category, done) fast.
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks (category_id);
CREATE INDEX IF NOT EXISTS idx_tasks_done     ON tasks (done);
