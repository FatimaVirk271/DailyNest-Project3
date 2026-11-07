// store.js - the "Data Persistence Layer": all SQL lives here.
// The routes call these functions; they never write SQL themselves.
//
// SAFETY RULE (Pillar 4): every value from the user goes in through a placeholder ($1, $2 ...).
// We NEVER glue user text into the SQL string, so SQL injection is impossible.
//
// Every function is "async": talking to a database takes time, so we `await` the answer.
const db = require('./db');

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

const INSERT_TASK =
  'INSERT INTO tasks (text, category_id, done) VALUES ($1, (SELECT id FROM categories WHERE name = $2), $3) RETURNING id';

const SET_FLAG =
  "INSERT INTO app_meta (key, value) VALUES ('starter_seeded', '1') ON CONFLICT (key) DO UPDATE SET value = excluded.value";

const toIso = (value) => (value === null || value === undefined ? null : new Date(value).toISOString());

// The database uses snake_case names; the API keeps the Project 2 shape.
function toTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    text: row.text,
    category: row.category,
    done: Boolean(row.done),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function find(id) {
  const result = await db.query(`${SELECT_TASK} WHERE t.id = $1`, [id]);
  return toTask(result.rows[0]);
}

// Back to the four starter tasks. A transaction makes it "all or nothing".
// Inserted in reverse so "Drink 8 glasses of water" stays on top
// (the newest task = highest id = first in the list, just like Project 1 and 2).
async function reset() {
  return db.transaction(async (q) => {
    if (db.isPostgres) {
      await q('TRUNCATE tasks RESTART IDENTITY'); // empty the table and start ids from 1 again
    } else {
      await q('DELETE FROM tasks');
      await q("DELETE FROM sqlite_sequence WHERE name = 'tasks'");
    }
    for (const t of [...STARTER].reverse()) await q(INSERT_TASK, [t.text, t.category, false]);
    await q(SET_FLAG);
    return STARTER.length;
  });
}

// First run only: a brand-new database gets the starter tasks.
// (If you later delete every task and restart, the list stays empty - your data is respected.)
async function seedIfNew() {
  const flag = await db.query("SELECT value FROM app_meta WHERE key = 'starter_seeded'");
  if (flag.rows.length > 0) return;
  const count = await db.query('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM tasks');
  if (count.rows[0].n > 0) await db.query(SET_FLAG); // database already has tasks: just remember that
  else await reset();
}

let ready = null;

module.exports = {
  // Opens the database, builds the tables, adds starter tasks if it is brand new.
  init: () => (ready = ready || db.init().then(seedIfNew)),

  // READ: list with filters + pagination. Filtering happens INSIDE the database (WHERE ... LIMIT).
  async list({ category, done, search, limit = 100, offset = 0 } = {}) {
    const where = [];
    const params = [];
    const add = (value) => { params.push(value); return `$${params.length}`; }; // returns "$1", "$2", ...

    if (category) where.push(`c.name = ${add(category)}`);
    if (done !== undefined) where.push(`t.done = ${add(done)}`);
    if (search) {
      // LIKE = "contains". Escape % and _ typed by the user so they count as plain characters.
      where.push(`lower(t.text) LIKE ${add(`%${search.replace(/[\\%_]/g, '\\$&').toLowerCase()}%`)} ESCAPE '\\'`);
    }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const total = (
      await db.query(`SELECT CAST(COUNT(*) AS INTEGER) AS n FROM tasks t JOIN categories c ON c.id = t.category_id${clause}`, params)
    ).rows[0].n;

    const n = params.length;
    const rows = (
      await db.query(`${SELECT_TASK}${clause} ORDER BY t.id DESC LIMIT $${n + 1} OFFSET $${n + 2}`, [...params, limit, offset])
    ).rows;

    return { tasks: rows.map(toTask), total };
  },

  find,

  // CREATE (POST -> INSERT)
  async create(data) {
    const result = await db.query(INSERT_TASK, [data.text, data.category, Boolean(data.done)]);
    return find(result.rows[0].id);
  },

  // UPDATE (PUT / PATCH -> UPDATE). Only the fields present in `data` are changed.
  // The SQL pieces below are fixed text written by us; the values still use placeholders.
  async update(id, data) {
    const sets = [];
    const params = [];
    const add = (value) => { params.push(value); return `$${params.length}`; };

    if ('text' in data) sets.push(`text = ${add(data.text)}`);
    if ('category' in data) sets.push(`category_id = (SELECT id FROM categories WHERE name = ${add(data.category)})`);
    if ('done' in data) sets.push(`done = ${add(Boolean(data.done))}`);
    sets.push(`updated_at = ${db.NOW}`);

    const result = await db.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ${add(id)} RETURNING id`, params);
    return result.rowCount === 0 ? null : find(id);
  },

  // DELETE one task. Returns true if a row was really deleted.
  async remove(id) {
    return (await db.query('DELETE FROM tasks WHERE id = $1', [id])).rowCount > 0;
  },

  // DELETE all finished tasks. Returns how many were removed.
  async removeDone() {
    return (await db.query('DELETE FROM tasks WHERE done = $1', [true])).rowCount;
  },

  reset,

  // Progress numbers worked out by the database itself (COUNT / SUM / GROUP BY).
  async stats() {
    const totals = (
      await db.query('SELECT CAST(COUNT(*) AS INTEGER) AS total, CAST(COALESCE(SUM(CAST(done AS INTEGER)), 0) AS INTEGER) AS done FROM tasks')
    ).rows[0];
    const byCategory = {};
    (await this.categories()).forEach((c) => { byCategory[c.name] = { total: c.total, done: c.done }; });
    return {
      total: totals.total,
      done: totals.done,
      remaining: totals.total - totals.done,
      percent: totals.total === 0 ? 0 : Math.round((totals.done / totals.total) * 100),
      byCategory,
    };
  },

  // The categories table with how many tasks each one has (a one-to-many relationship in action).
  async categories() {
    const result = await db.query(`
      SELECT c.name,
             CAST(COUNT(t.id) AS INTEGER) AS total,
             CAST(COALESCE(SUM(CAST(t.done AS INTEGER)), 0) AS INTEGER) AS done
      FROM categories c LEFT JOIN tasks t ON t.category_id = c.id
      GROUP BY c.id, c.name ORDER BY c.id`);
    return result.rows.map((r) => ({ name: r.name, total: r.total, done: r.done }));
  },
};
