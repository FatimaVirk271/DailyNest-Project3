// test.js - automated checks. Run with: npm test
// It starts the API on a random port, sends real HTTP requests, and checks the answers.
// New in Project 3: it also checks the database rules, SQL injection, and that data survives a restart.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Use throwaway database files + quiet logs + known settings
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dn3-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.SILENT = '1';
process.env.RATE_LIMIT_MAX = '100';
process.env.API_KEY = 'test-key';
process.env.NODE_NO_WARNINGS = '1';
process.env.DATABASE_URL = ''; // tests must NEVER touch the real cloud database

const app = require('./server');
const db = require('./db');
const store = require('./store');
const { DatabaseSync } = require('node:sqlite'); // used only to peek into the test database file

let passed = 0;
let failed = 0;
function check(name, condition, extra = '') {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${extra}`); }
}
// true if the (async) database call fails with a message matching the pattern
async function rejectsWith(sql, pattern, params = []) {
  try { await db.query(sql, params); return false; } catch (err) { return pattern.test(String(err.message)); }
}

// Starts a REAL second server process (to prove data survives a restart)
function startServer(file, port) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, DB_FILE: file, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('running')) resolve(child); });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`server exited early (${code})`)));
    setTimeout(() => reject(new Error('server did not start')), 8000);
  });
}
const stopServer = (child) => new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGINT'); });

let server;
store.init().then(() => {
if (db.isPostgres) { console.log('Refusing to run the tests on a real database.'); process.exit(1); }
server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { 'Content-Type': 'application/json' };
  const call = async (method, url, body, headers = json, root = base) => {
    const res = await fetch(root + url, {
      method, headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };

  try {
    console.log('Health and page');
    let r = await call('GET', '/api/health');
    check('GET /api/health -> 200 and database connected', r.status === 200 && r.body.data.database === 'connected');
    const page = await fetch(base + '/');
    const html = await page.text();
    check('GET / serves the DailyNest page', page.status === 200 && html.includes('DailyNest'));
    const js = await fetch(base + '/script.js');
    check('GET /script.js is served', js.status === 200);

    console.log('Database schema');
    const tables = await db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tasks','categories')");
    check('both tables exist (tasks, categories)', tables.rows.length === 2);
    check('foreign keys are switched on', (await db.query('PRAGMA foreign_keys')).rows[0].foreign_keys === 1);
    r = await call('GET', '/api/categories');
    check('GET /api/categories -> the 4 categories with task counts',
      r.status === 200 && r.body.data.length === 4 && r.body.data.every((c) => c.total === 1), JSON.stringify(r.body));

    console.log('GET /api/tasks (starter data)');
    r = await call('GET', '/api/tasks');
    check('list -> 200 with the 4 starter tasks', r.status === 200 && r.body.meta.total === 4);
    check('starter tasks keep Project 1 order', r.body.data[0].text === 'Drink 8 glasses of water');
    check('done is a real true/false (not 0/1)', r.body.data[0].done === false);
    check('task has id, createdAt and category name', typeof r.body.data[0].id === 'number'
      && typeof r.body.data[0].createdAt === 'string' && r.body.data[0].category === 'health');
    const waterId = r.body.data[0].id;

    console.log('POST /api/tasks');
    r = await call('POST', '/api/tasks', { text: '  Read   a book  ', category: 'Study' });
    check('valid task -> 201', r.status === 201, r.status);
    check('text is tidied (spaces)', r.body.data.text === 'Read a book');
    check('category is lower-cased', r.body.data.category === 'study');
    check('done defaults to false', r.body.data.done === false);
    check('Location header is set', r.headers.get('location') === `/api/tasks/${r.body.data.id}`);
    const bookId = r.body.data.id;
    r = await call('POST', '/api/tasks', { text: 'Plan my week' });
    check('category defaults to "home"', r.status === 201 && r.body.data.category === 'home');
    const planId = r.body.data.id;
    r = await call('GET', '/api/tasks');
    check('newest task is first in the list', r.body.data[0].id === planId);

    r = await call('POST', '/api/tasks', { text: '   ', category: 'gym', done: 'yes' });
    check('invalid data -> 400', r.status === 400);
    check('400 lists every bad field', r.body.error.details.length === 3, JSON.stringify(r.body.error.details));
    r = await call('POST', '/api/tasks', { text: '!!!' });
    check('symbols-only text -> 400', r.status === 400);
    r = await call('POST', '/api/tasks', { text: 'x'.repeat(81) });
    check('text over 80 characters -> 400', r.status === 400);
    r = await call('POST', '/api/tasks', { text: 123 });
    check('text that is not a string -> 400', r.status === 400);
    r = await call('POST', '/api/tasks', '{ bad json', json);
    check('broken JSON -> 400', r.status === 400 && r.body.error.code === 'INVALID_JSON');
    r = await call('POST', '/api/tasks', 'text=x', { 'Content-Type': 'text/plain' });
    check('wrong Content-Type -> 415', r.status === 415);
    r = await call('POST', '/api/tasks', [1, 2, 3]);
    check('array body -> 400', r.status === 400);

    console.log('GET filters (now done by SQL)');
    r = await call('GET', '/api/tasks?category=study');
    check('filter by category works', r.body.meta.total === 2);
    r = await call('GET', '/api/tasks?category=gym');
    check('bad category -> 400', r.status === 400);
    r = await call('GET', '/api/tasks?done=maybe');
    check('bad done value -> 400', r.status === 400);
    r = await call('GET', '/api/tasks?done=false&category=home');
    check('two filters together (AND)', r.body.meta.total === 2);
    r = await call('GET', '/api/tasks?search=WATER');
    check('search works (any letter case)', r.body.data.length === 1);
    r = await call('GET', '/api/tasks?limit=2&page=3');
    check('pagination works', r.body.data.length === 2 && r.body.meta.totalPages === 3);
    check('pagination meta total is the full count', r.body.meta.total === 6);
    r = await call('GET', '/api/tasks?page=0');
    check('page=0 -> 400', r.status === 400);
    r = await call('GET', '/api/tasks?limit=500');
    check('limit=500 -> 400', r.status === 400);

    console.log('GET /api/tasks/:id');
    r = await call('GET', `/api/tasks/${bookId}`);
    check('existing task -> 200', r.status === 200 && r.body.data.text === 'Read a book');
    r = await call('GET', '/api/tasks/9999');
    check('missing task -> 404', r.status === 404);
    r = await call('GET', '/api/tasks/abc');
    check('non-numeric id -> 400', r.status === 400);

    console.log('PATCH /api/tasks/:id');
    r = await call('PATCH', `/api/tasks/${bookId}`, { done: true });
    check('mark done -> 200', r.status === 200 && r.body.data.done === true);
    check('PATCH keeps the other fields', r.body.data.text === 'Read a book' && r.body.data.category === 'study');
    check('updatedAt is filled after a change', typeof r.body.data.updatedAt === 'string');
    r = await call('PATCH', `/api/tasks/${bookId}`, { category: 'health' });
    check('PATCH can move a task to another category', r.body.data.category === 'health' && r.body.data.done === true);
    await call('PATCH', `/api/tasks/${bookId}`, { category: 'study' });
    r = await call('PATCH', `/api/tasks/${bookId}`, {});
    check('PATCH with nothing to change -> 400', r.status === 400);
    r = await call('PATCH', `/api/tasks/${bookId}`, { done: 'x' });
    check('PATCH with bad done -> 400', r.status === 400);
    r = await call('PATCH', '/api/tasks/9999', { done: true });
    check('PATCH missing task -> 404', r.status === 404);

    console.log('PUT /api/tasks/:id');
    r = await call('PUT', `/api/tasks/${bookId}`, { text: 'Read two chapters', category: 'study' });
    check('replace task -> 200', r.status === 200 && r.body.data.text === 'Read two chapters');
    check('PUT resets fields that were not sent (done)', r.body.data.done === false);
    r = await call('PUT', `/api/tasks/${bookId}`, { category: 'study' });
    check('PUT without text -> 400', r.status === 400);
    r = await call('PUT', '/api/tasks/9999', { text: 'Ghost task' });
    check('PUT missing task -> 404', r.status === 404);

    console.log('GET /api/stats (calculated by SQL)');
    await call('PATCH', `/api/tasks/${waterId}`, { done: true });
    r = await call('GET', '/api/stats');
    check('stats -> 200', r.status === 200);
    check('stats numbers are right', r.body.data.total === 6 && r.body.data.done === 1
      && r.body.data.remaining === 5 && r.body.data.percent === 17, JSON.stringify(r.body.data));
    check('stats by category', r.body.data.byCategory.health.done === 1 && r.body.data.byCategory.study.total === 2);

    console.log('DELETE');
    r = await call('DELETE', `/api/tasks/${planId}`, undefined, {});
    check('delete one task -> 204', r.status === 204);
    r = await call('DELETE', `/api/tasks/${planId}`, undefined, {});
    check('delete it again -> 404', r.status === 404);
    check('the row is really gone from the table',
      (await db.query('SELECT COUNT(*) AS n FROM tasks WHERE id = $1', [planId])).rows[0].n === 0);
    r = await call('DELETE', '/api/tasks/abc', undefined, {});
    check('delete bad id -> 400', r.status === 400);
    r = await call('DELETE', '/api/tasks?done=true', undefined, {});
    check('clear finished tasks -> 200', r.status === 200 && r.body.data.deleted === 1, JSON.stringify(r.body));
    r = await call('GET', '/api/tasks');
    check('4 tasks are left', r.body.meta.total === 4);
    r = await call('DELETE', '/api/tasks', undefined, {});
    check('delete-all without done=true -> 400', r.status === 400);

    console.log('SQL injection (Pillar 4: The Shield)');
    const evil = "x'); DROP TABLE tasks; --";
    r = await call('POST', '/api/tasks', { text: evil });
    check('malicious text is saved as harmless text', r.status === 201 && r.body.data.text === evil);
    const evilId = r.body.data.id;
    r = await call('GET', '/api/tasks');
    check('the tasks table still exists after the attack', r.status === 200 && r.body.meta.total === 5);
    r = await call('GET', `/api/tasks?search=${encodeURIComponent("' OR 1=1 --")}`);
    check("search for ' OR 1=1 -- finds nothing (not everything)", r.status === 200 && r.body.meta.total === 0);
    r = await call('GET', `/api/tasks?category=${encodeURIComponent("home' OR '1'='1")}`);
    check('injection in a filter -> 400', r.status === 400);
    r = await call('GET', `/api/tasks?search=${encodeURIComponent('%')}`);
    check('search for "%" is treated as a plain character', r.body.meta.total === 0);
    r = await call('GET', '/api/tasks/1%20OR%201=1', undefined, {});
    check('injection in the id -> 400', r.status === 400);
    await call('DELETE', `/api/tasks/${evilId}`, undefined, {});

    console.log('Database rules (even if the app code is bypassed)');
    check('empty text is refused by CHECK',
      await rejectsWith("INSERT INTO tasks (text, category_id) VALUES ('   ', 1)", /CHECK/));
    check('text over 80 chars is refused by CHECK',
      await rejectsWith('INSERT INTO tasks (text, category_id) VALUES ($1, 1)', /CHECK/, ['a'.repeat(81)]));
    check('done must be 0 or 1 (CHECK)',
      await rejectsWith("INSERT INTO tasks (text, category_id, done) VALUES ('ok', 1, 2)", /CHECK/));
    check('missing category is refused (NOT NULL)',
      await rejectsWith("INSERT INTO tasks (text, category_id) VALUES ('ok', NULL)", /NOT NULL/));
    check('unknown category id is refused (FOREIGN KEY)',
      await rejectsWith("INSERT INTO tasks (text, category_id) VALUES ('ok', 999)", /FOREIGN KEY/));
    check('duplicate category name is refused (UNIQUE)',
      await rejectsWith("INSERT INTO categories (name) VALUES ('home')", /UNIQUE/));
    check('a category that still has tasks cannot be deleted (RESTRICT)',
      await rejectsWith("DELETE FROM categories WHERE name = 'home'", /FOREIGN KEY/));
    check('a failed step undoes the whole transaction (all or nothing)', await (async () => {
      const before = (await db.query('SELECT COUNT(*) AS n FROM tasks')).rows[0].n;
      try {
        await db.transaction(async (q) => {
          await q("INSERT INTO tasks (text, category_id) VALUES ('half done', 1)");
          await q("INSERT INTO tasks (text, category_id) VALUES ('', 1)"); // fails -> everything is undone
        });
      } catch (err) { /* expected */ }
      return (await db.query('SELECT COUNT(*) AS n FROM tasks')).rows[0].n === before;
    })());

    console.log('POST /api/admin/reset (API key)');
    r = await call('POST', '/api/admin/reset', undefined, {});
    check('no API key -> 401', r.status === 401);
    r = await call('POST', '/api/admin/reset', undefined, { 'x-api-key': 'wrong' });
    check('wrong API key -> 403', r.status === 403);
    await call('POST', '/api/tasks', { text: 'Temporary task' });
    r = await call('POST', '/api/admin/reset', undefined, { 'x-api-key': 'test-key' });
    check('correct key -> 200 and says how many tasks were added', r.status === 200 && r.body.data.tasks === 4);
    r = await call('GET', '/api/tasks');
    check('starter tasks are back', r.body.meta.total === 4 && r.body.data[0].text === 'Drink 8 glasses of water');
    check('ids start again from 1 after reset', Math.min(...r.body.data.map((t) => t.id)) === 1);

    console.log('Other');
    r = await call('GET', '/api/nothing-here');
    check('unknown route -> 404 JSON', r.status === 404 && r.body.success === false);

    console.log('Persistence (data longevity)');
    await call('POST', '/api/tasks', { text: 'Survive a restart' });
    const second = new DatabaseSync(process.env.DB_FILE); // a brand-new connection reading the file on disk
    check('a new connection to the file sees the saved task',
      second.prepare("SELECT COUNT(*) AS n FROM tasks WHERE text = 'Survive a restart'").get().n === 1);
    second.close();

    const file = path.join(tmp, 'restart.db');
    const port = 3200 + Math.floor(Math.random() * 600);
    const url = `http://127.0.0.1:${port}`;
    let child = await startServer(file, port);
    r = await call('POST', '/api/tasks', { text: 'Still here after restart', category: 'study' }, json, url);
    check('task created on a real running server', r.status === 201);
    await stopServer(child);
    child = await startServer(file, port); // the server process is brand new
    r = await call('GET', '/api/tasks?search=still%20here', undefined, {}, url);
    check('SERVER RESTARTED: the task is still there', r.body.meta.total === 1);
    r = await call('GET', '/api/tasks', undefined, {}, url);
    for (const t of r.body.data) await call('PATCH', `/api/tasks/${t.id}`, { done: true }, json, url);
    r = await call('DELETE', '/api/tasks?done=true', undefined, {}, url);
    check('every task deleted', r.body.data.deleted === 5, JSON.stringify(r.body));
    await stopServer(child);
    child = await startServer(file, port);
    r = await call('GET', '/api/tasks', undefined, {}, url);
    check('an emptied list stays empty after restart (starter tasks not re-added)', r.body.meta.total === 0);
    await stopServer(child);

    console.log('Migration script (Project 2 data.json -> database)');
    const jsonFile = path.join(tmp, 'data.json');
    fs.writeFileSync(jsonFile, JSON.stringify({
      tasks: [
        { id: 3, text: 'Newest task', category: 'home', done: true, createdAt: '2026-10-03T10:00:00.000Z' },
        { id: 2, text: '!!!', category: 'home', done: false },
        { id: 1, text: 'Oldest task', category: 'study', done: false, createdAt: '2026-10-01T10:00:00.000Z' },
      ],
      nextId: 4,
    }));
    const migDb = path.join(tmp, 'migrated.db');
    const run = await new Promise((resolve) => {
      let out = '';
      const p = spawn(process.execPath, ['scripts/migrate-json.js', jsonFile], {
        cwd: __dirname, env: { ...process.env, DB_FILE: migDb },
      });
      p.stdout.on('data', (d) => { out += d; });
      p.on('exit', (code) => resolve({ code, out }));
    });
    check('migration runs and reports 2 imported, 1 skipped',
      run.code === 0 && /Imported 2 task\(s\), skipped 1/.test(run.out), run.out);
    const mig = new DatabaseSync(migDb);
    const rows = mig.prepare('SELECT t.id, t.text, t.done, t.created_at FROM tasks t ORDER BY t.id').all();
    check('oldest task gets the smallest id, newest stays on top', rows.length === 2
      && rows[0].text === 'Oldest task' && rows[1].text === 'Newest task');
    check('done flag and original date are kept', rows[1].done === 1 && rows[0].created_at === '2026-10-01T10:00:00.000Z');
    mig.close();

    console.log('Old local database (Project 3 first version) is not wiped');
    const oldFile = path.join(tmp, 'old.db');
    const old = new DatabaseSync(oldFile);
    old.exec(fs.readFileSync(path.join(__dirname, 'schema.sqlite.sql'), 'utf8').replace(/CREATE TABLE IF NOT EXISTS app_meta[\s\S]*?\);/, ''));
    old.exec("INSERT INTO categories (name) VALUES ('home'), ('study'), ('health'), ('shopping')");
    old.exec("INSERT INTO tasks (text, category_id) VALUES ('my old task one', 1), ('my old task two', 2)");
    old.exec('PRAGMA user_version = 1');
    old.close();
    const upgraded = await new Promise((resolve) => {
      let out = '';
      const p = spawn(process.execPath, ['-e',
        "const s=require('./store');s.init().then(()=>s.list()).then(r=>{console.log('TOTAL='+r.total);process.exit(0)})"], {
        cwd: __dirname, env: { ...process.env, DB_FILE: oldFile },
      });
      p.stdout.on('data', (d) => { out += d; });
      p.on('exit', () => resolve(out));
    });
    check('existing tasks stay (2 tasks, starter tasks not forced in)', /TOTAL=2/.test(upgraded), upgraded);

    console.log('Database failure does not crash the app');
    await db.query('ALTER TABLE tasks RENAME TO tasks_hidden');
    const realError = console.error;
    console.error = () => {}; // hide the expected error message
    r = await call('GET', '/api/tasks');
    check('broken database -> clean 500 JSON (no secrets leaked)',
      r.status === 500 && r.body.error.code === 'INTERNAL_ERROR' && !JSON.stringify(r.body).includes('tasks_hidden'));
    r = await call('GET', '/api/health');
    console.error = realError;
    await db.query('ALTER TABLE tasks_hidden RENAME TO tasks');
    r = await call('GET', '/api/tasks');
    check('app works again once the database is fixed', r.status === 200);

    console.log('Rate limit');
    let got429 = false;
    for (let i = 0; i < 120; i++) {
      r = await call('GET', '/api/tasks');
      if (r.status === 429) { got429 = true; break; }
    }
    check('too many requests -> 429', got429);
    check('429 has Retry-After header', got429 && !!r.headers.get('retry-after'));
  } catch (err) {
    failed++;
    console.log('  FAIL  test crashed:', err);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  server.close();
  await db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
});
});
