// scripts/migrate-json.js - moves your Project 2 tasks (data.json) into the database.
// Usage:  npm run migrate                 (reads ./data.json)
//         npm run migrate -- path/to/data.json
// It writes into whichever database is active (the cloud one if DATABASE_URL is set).
// WARNING: this REPLACES the tasks currently in the database with the ones from the file.
const fs = require('fs');
const path = require('path');
const db = require('../db');
const store = require('../store');
const { validateTask } = require('../validators');

async function main() {
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

  await store.init();

  const iso = (value) => {
    const d = new Date(value);
    return value && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  };

  let imported = 0;
  let skipped = 0;

  await db.transaction(async (q) => {
    await q('DELETE FROM tasks'); // (ids keep counting; that is fine)
    // Project 2 stored the newest task first, so import from the end: oldest gets the smallest id.
    for (const t of [...saved.tasks].reverse()) {
      const { errors, clean } = validateTask(t); // the same Gatekeeper rules as the API
      if (errors.length) { skipped++; continue; }
      await q(
        `INSERT INTO tasks (text, category_id, done, created_at, updated_at)
         VALUES ($1, (SELECT id FROM categories WHERE name = $2), $3, $4, $5)`,
        [clean.text, clean.category, Boolean(clean.done), iso(t.createdAt) || new Date().toISOString(), iso(t.updatedAt)]
      );
      imported++;
    }
    await q("INSERT INTO app_meta (key, value) VALUES ('starter_seeded', '1') ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  });

  console.log(`Imported ${imported} task(s), skipped ${skipped} invalid one(s) into ${db.describe()}`);
  await db.close();
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
