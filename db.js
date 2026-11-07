// db.js - THE BRIDGE (Pillar 2): connects Node.js to the database file.
// We use a "native driver" (SQLite built into Node) and write raw SQL ourselves.
// Only THIS file knows which driver is used, so it is the only file you would change to swap it.
const fs = require('fs');
const path = require('path');

let Driver;
try {
  ({ DatabaseSync: Driver } = require('node:sqlite')); // built into Node 22.13 or newer
} catch (err) {
  try {
    Driver = require('better-sqlite3'); // same methods (prepare / run / get / all); use on older Node
  } catch (err2) {
    throw new Error('No SQLite driver found. Use Node 22.13+ (node -v) or run: npm install better-sqlite3');
  }
}

const CATEGORIES = ['home', 'study', 'health', 'shopping'];

// Open (or create) the database file, switch on the safety rules and build the tables.
function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Driver(file);
  db.exec('PRAGMA foreign_keys = ON;'); // SQLite ignores foreign keys unless this is switched on
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

  const addCategory = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
  CATEGORIES.forEach((name) => addCategory.run(name));
  return db;
}

const FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'dailynest.db');
const db = open(FILE);

module.exports = { db, open, FILE };
