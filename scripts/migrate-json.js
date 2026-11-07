// scripts/migrate-json.js - moves your Project 2 tasks (data.json) into the database.
// Usage:  npm run migrate                 (reads ./data.json)
//         npm run migrate -- path/to/data.json
// WARNING: this REPLACES the tasks currently in the database with the ones from the file.
const fs = require('fs');
const path = require('path');
const { db, FILE } = require('../db');
const { validateTask } = require('../validators');

const source = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data.json'));
if (!fs.existsSync(source)) {
  console.log(`No file found at ${source}\nCopy your Project 2 data.json here, or pass its path.`);
  process.exit(1);
}

const saved = JSON.parse(fs.readFileSync(source, 'utf8'));
if (!Array.isArray(saved.tasks)) {
  console.log('That file has no "tasks" list - nothing to import.');
  process.exit(1);
}

const insert = db.prepare(
  `INSERT INTO tasks (text, category_id, done, created_at, updated_at)
   VALUES (?, (SELECT id FROM categories WHERE name = ?), ?, ?, ?)`
);
const iso = (value) => {
  const d = new Date(value);
  return value && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};

let imported = 0;
let skipped = 0;

db.exec('BEGIN');
try {
  db.exec('DELETE FROM tasks');
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'tasks'");
  // Project 2 stored the newest task first, so import from the end: oldest gets the smallest id.
  for (const t of [...saved.tasks].reverse()) {
    const { errors, clean } = validateTask(t); // the same Gatekeeper rules as the API
    if (errors.length) { skipped++; continue; }
    insert.run(clean.text, clean.category, clean.done ? 1 : 0,
      iso(t.createdAt) || new Date().toISOString(), iso(t.updatedAt));
    imported++;
  }
  db.exec('PRAGMA user_version = 1');
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK'); // all or nothing
  throw err;
}

console.log(`Imported ${imported} task(s), skipped ${skipped} invalid one(s) into ${FILE}`);
db.close();
