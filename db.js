// db.js - THE BRIDGE (Pillar 2): connects Node.js to the database.
//
// Which database is used?
//   - DATABASE_URL is set  -> the shared CLOUD database (PostgreSQL, e.g. Neon).
//                             Local app and live app use the SAME data.
//   - DATABASE_URL is empty -> a local SQLite file (data/dailynest.db), only for your own computer.
//
// Only THIS file knows which one is used. The rest of the project calls db.query(sql, [values]).
// In SQL we write placeholders as $1, $2, ... (PostgreSQL style). Values never go inside the SQL text.
const fs = require('fs');
const path = require('path');

// Local convenience: if a .env file exists, read it (it holds DATABASE_URL). Never upload .env to GitHub.
if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (err) { /* no .env file - that is fine */ }
}

const DATABASE_URL = process.env.DATABASE_URL || '';
const isPostgres = DATABASE_URL !== '';
const FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'dailynest.db');

const CATEGORIES = ['home', 'study', 'health', 'shopping'];

// "Current time" is written differently in each database
const NOW = isPostgres ? 'now()' : "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/* ------------------------- PostgreSQL (cloud) ------------------------- */
function createPostgres() {
  const { Pool } = require('pg'); // only loaded when DATABASE_URL is set
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10000,       // drop idle connections early (free cloud databases close them when idle)
    connectionTimeoutMillis: 20000, // a sleeping free database can take a few seconds to wake up
  });
  pool.on('error', (err) => console.error('Database connection problem:', err.message));

  // Same shape for pool and for a single client: { rows, rowCount }
  const runner = (target) => async (sql, params = []) => {
    const result = params.length ? await target.query(sql, params) : await target.query(sql);
    return { rows: result.rows, rowCount: result.rowCount };
  };

  return {
    query: runner(pool),
    exec: runner(pool), // several statements at once (used for schema.sql)
    // A transaction = all or nothing. Every step must use the SAME connection (the client).
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(runner(client));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/* ------------------------- SQLite (local file) ------------------------- */
function createSqlite() {
  let Driver;
  try {
    ({ DatabaseSync: Driver } = require('node:sqlite')); // built into Node 22.13 or newer
  } catch (err) {
    try {
      Driver = require('better-sqlite3'); // same methods; for older Node: npm install better-sqlite3
    } catch (err2) {
      throw new Error('No SQLite driver found. Use Node 22.13+, or set DATABASE_URL to use the cloud database.');
    }
  }
  if (FILE !== ':memory:') fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const raw = new Driver(FILE);
  raw.exec('PRAGMA foreign_keys = ON;'); // SQLite ignores foreign keys unless this is switched on

  const cache = new Map();
  const returnsRows = (sql) => /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);

  function run(sql, params = []) {
    const text = sql.replace(/\$(\d+)/g, '?$1'); // $1 -> ?1 (SQLite's way to write numbered placeholders)
    const values = params.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)); // SQLite has no true/false
    let stmt = cache.get(text);
    if (!stmt) { stmt = raw.prepare(text); cache.set(text, stmt); }
    if (returnsRows(text)) {
      const rows = stmt.all(...values).map((r) => ({ ...r }));
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: Number(stmt.run(...values).changes) };
  }

  return {
    query: async (sql, params) => run(sql, params),
    exec: async (sql) => { raw.exec(sql); },
    async transaction(fn) {
      raw.exec('BEGIN');
      try {
        const out = await fn(async (sql, params) => run(sql, params));
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
    close: async () => { raw.close(); },
  };
}

/* ------------------------------ start-up ------------------------------ */
let driver = null;
let ready = null;

async function start() {
  driver = isPostgres ? createPostgres() : createSqlite();
  // Create the tables if they do not exist yet (safe to run on every start)
  await driver.exec(fs.readFileSync(path.join(__dirname, isPostgres ? 'schema.sql' : 'schema.sqlite.sql'), 'utf8'));
  // Make sure the 4 categories exist (only inserts the missing ones)
  for (const name of CATEGORIES) {
    await driver.query(
      'INSERT INTO categories (name) SELECT CAST($1 AS TEXT) WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = $1)',
      [name]
    );
  }
}

const need = () => {
  if (!driver) throw new Error('Database is not ready: call init() first');
  return driver;
};

module.exports = {
  init: () => (ready = ready || start()),
  query: (sql, params) => need().query(sql, params),
  transaction: (fn) => need().transaction(fn),
  close: () => (driver ? driver.close() : Promise.resolve()),
  isPostgres,
  NOW,
  CATEGORIES,
  FILE,
  describe: () => (isPostgres ? 'PostgreSQL (cloud database)' : `SQLite file ${FILE}`),
};
