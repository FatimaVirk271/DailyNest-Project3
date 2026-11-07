// store.js - the "Data Persistence Layer".
// Project 2 kept tasks in memory + data.json. Project 3 keeps them in a real SQL database.
// Notice: the function names (all / find / create / update / remove ...) stay almost the same,
// so the routes barely change. Only what happens INSIDE each function is new: SQL.
//
// SAFETY RULE (Pillar 4): every value from the user goes in through a "?" placeholder.
// We NEVER glue user text into the SQL string, so SQL injection is impossible.
const { db } = require('./db');

// The same four starter tasks DailyNest always had
const STARTER = [
  { text: 'Drink 8 glasses of water', category: 'health' },
  { text: 'Study for 1 hour', category: 'study' },
  { text: 'Clean my room', category: 'home' },
  { text: 'Buy vegetables and fruit', category: 'shopping' },
];

// One SELECT used everywhere: joins tasks with their category name.
const SELECT_TASK = `
  SELECT t.id, t.text, c.name AS category, t.done, t.created_at, t.updated_at
  FROM tasks t JOIN categories c ON c.id = t.category_id`;

// The database stores done as 0/1 and snake_case names; the API keeps the Project 2 shape.
function toTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    text: row.text,
    category: row.category,
    done: row.done === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// A transaction = "all or nothing". If anything fails in the middle, everything is undone.
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Prepared statements: the SQL is compiled once, the "?" values are filled in on each call.
const stmt = {
  find: db.prepare(`${SELECT_TASK} WHERE t.id = ?`),
  insert: db.prepare(
    'INSERT INTO tasks (text, category_id, done) VALUES (?, (SELECT id FROM categories WHERE name = ?), ?)'
  ),
  remove: db.prepare('DELETE FROM tasks WHERE id = ?'),
  removeDone: db.prepare('DELETE FROM tasks WHERE done = 1'),
  clear: db.prepare('DELETE FROM tasks'),
  resetIds: db.prepare("DELETE FROM sqlite_sequence WHERE name = 'tasks'"),
  totals: db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(done), 0) AS done FROM tasks'),
  perCategory: db.prepare(`
    SELECT c.name, COUNT(t.id) AS total, COALESCE(SUM(t.done), 0) AS done
    FROM categories c LEFT JOIN tasks t ON t.category_id = c.id
    GROUP BY c.id ORDER BY c.id`),
};

function find(id) {
  return toTask(stmt.find.get(id));
}

// Back to the four starter tasks. Inserted in reverse so "Drink 8 glasses of water" stays on top
// (the newest task = highest id = first in the list, just like Project 1 and 2).
function reset() {
  return transaction(() => {
    stmt.clear.run();
    stmt.resetIds.run(); // ids start again from 1
    [...STARTER].reverse().forEach((t) => stmt.insert.run(t.text, t.category, 0));
    db.exec('PRAGMA user_version = 1'); // remember: the starter tasks were already added once
    return STARTER.length;
  });
}

// First run only: a brand-new database gets the starter tasks.
// (If you later delete every task and restart, the list stays empty - your data is respected.)
if (db.prepare('PRAGMA user_version').get().user_version === 0) reset();

module.exports = {
  // READ: list with filters + pagination. Filtering now happens INSIDE the database (WHERE ... LIMIT).
  list({ category, done, search, limit = 100, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (category) { where.push('c.name = ?'); params.push(category); }
    if (done !== undefined) { where.push('t.done = ?'); params.push(done ? 1 : 0); }
    if (search) {
      where.push("t.text LIKE ? ESCAPE '\\'"); // LIKE = "contains"; escape % and _ typed by the user
      params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM tasks t JOIN categories c ON c.id = t.category_id${clause}`)
      .get(...params).n;
    const rows = db
      .prepare(`${SELECT_TASK}${clause} ORDER BY t.id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);

    return { tasks: rows.map(toTask), total };
  },

  find,

  // CREATE (POST -> INSERT)
  create(data) {
    const info = stmt.insert.run(data.text, data.category, data.done ? 1 : 0);
    return find(Number(info.lastInsertRowid));
  },

  // UPDATE (PUT / PATCH -> UPDATE). Only the fields present in `data` are changed.
  // The SQL fragments below are fixed text written by us; the values still use "?".
  update(id, data) {
    const sets = [];
    const params = [];
    if ('text' in data) { sets.push('text = ?'); params.push(data.text); }
    if ('category' in data) {
      sets.push('category_id = (SELECT id FROM categories WHERE name = ?)');
      params.push(data.category);
    }
    if ('done' in data) { sets.push('done = ?'); params.push(data.done ? 1 : 0); }
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");

    const info = db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return info.changes === 0 ? null : find(id);
  },

  // DELETE one task. Returns true if a row was really deleted.
  remove(id) {
    return stmt.remove.run(id).changes > 0;
  },

  // DELETE all finished tasks. Returns how many were removed.
  removeDone() {
    return Number(stmt.removeDone.run().changes);
  },

  reset,

  // Progress numbers worked out by the database itself (COUNT / SUM / GROUP BY).
  stats() {
    const { total, done } = stmt.totals.get();
    const byCategory = {};
    stmt.perCategory.all().forEach((r) => { byCategory[r.name] = { total: r.total, done: r.done }; });
    return {
      total,
      done,
      remaining: total - done,
      percent: total === 0 ? 0 : Math.round((done / total) * 100),
      byCategory,
    };
  },

  // The categories table with how many tasks each one has (a one-to-many relationship in action).
  categories() {
    return stmt.perCategory.all().map((r) => ({ name: r.name, total: r.total, done: r.done }));
  },
};
