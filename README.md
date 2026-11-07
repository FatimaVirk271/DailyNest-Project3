# DailyNest - Project 3: Database Integration

DailyNest is a daily life planner (Home, Study, Health, Shopping tasks).

- **Project 1** was the skin: the responsive frontend.
- **Project 2** was the nervous system: a backend API.
- **Project 3** is the memory: a real **database**, so tasks are stored permanently and safely.

Built for the DecodeLabs Full Stack Development internship (Batch 2026) with **Node.js + Express + PostgreSQL**
(a shared cloud database), with a **local SQLite file** as an offline fallback.

Built by: _Your Name_

## What changed since Project 2

| Project 2 | Project 3 |
|-----------|-----------|
| Tasks lived in memory and were copied to `data.json` | Tasks live in a **SQL database** with two tables: shared cloud PostgreSQL (local app + live demo use the SAME data), or a local file when no cloud database is set |
| The whole file was rewritten on every change | Only the changed row is touched (INSERT / UPDATE / DELETE) |
| Filtering and paging were done in JavaScript | The database filters and pages (`WHERE`, `LIMIT`, `OFFSET`) |
| Progress numbers were counted in JavaScript | The database counts them (`COUNT`, `SUM`, `GROUP BY`) |
| Only the API checked the data | The API checks it **and** the database enforces rules (`NOT NULL`, `UNIQUE`, `CHECK`, foreign key) |
| Nothing protected against SQL | Every query uses `?` placeholders (**parameterized queries**) |

The page (`public/`), the routes, the validators and the middleware are the same as Project 2.
Only `store.js` was rewritten (and `db.js` + `schema.sql` were added). That is the point of keeping the
persistence layer separate: you can change where data lives without touching the rest.

## One database for the local app AND the live demo

A SQLite file lives on one computer only, so your laptop and the hosted app would each have their own data.
To share one database, both connect to the same **cloud PostgreSQL** database (free on Neon).
The app chooses automatically:

| `DATABASE_URL` is... | The app uses... |
|----------------------|-----------------|
| set | the shared cloud PostgreSQL database |
| empty | the local file `data/dailynest.db` (only for your own computer) |

### Set it up (once)
1. Create a free database at **neon.com** (sign in with GitHub, create a project). Click **Connect** and copy the
   connection string. It looks like `postgresql://user:password@ep-xxxx.neon.tech/neondb?sslmode=require`.
2. **Local app:** copy `.env.example` to a new file named `.env` and paste your string after `DATABASE_URL=`.
3. **Live app (SnapDeploy):** open the container settings, add an environment variable `DATABASE_URL` with the same string,
   then redeploy.

The connection string is a password: keep it only in `.env` and in the host's settings, never on GitHub.

## Run it

```bash
npm install     # downloads Express and pg (the PostgreSQL driver)
npm start       # open http://localhost:3000
npm test        # runs the automated checks (they use a temporary file and NEVER touch your cloud database)
```

Open **http://localhost:3000** (not the HTML file directly). On start the terminal prints which database is used:
`Database: PostgreSQL (cloud database)` or `Database: SQLite file ...`. The first start creates the tables and adds
the 4 starter tasks. Add a task, press Ctrl+C, start again: the task is still there. With the cloud database the same
task also appears on the live link.

Without `DATABASE_URL` the local fallback needs **Node.js 22.13 or newer** (`node -v`). With the cloud database any Node 18+ works.
(Node prints a one-line "SQLite is an experimental feature" warning on Node 22. That is normal.)

**Bring your Project 2 tasks:** copy your old `data.json` into this folder and run `npm run migrate`.
It writes into the active database and *replaces* the tasks currently in it.

To look inside the cloud database use the **Tables / SQL Editor** pages in the Neon dashboard.
To look inside the local file, open `data/dailynest.db` with **DB Browser for SQLite**.

## Project structure

```
DailyNest-Project3/
├── server.js          # starts the app, connects all pieces
├── db.js              # THE BRIDGE: connects Node.js to the database (cloud or file) (new)
├── schema.sql         # THE BLUEPRINT: tables, keys and rules (PostgreSQL)       (new)
├── schema.sqlite.sql  # the same blueprint for the local SQLite file             (new)
├── store.js           # THE ACTIONS: CRUD written in SQL (rewritten from P2)
├── routes/
│   ├── tasks.js       # GET / POST / PUT / PATCH / DELETE for tasks (tiny changes)
│   ├── categories.js  # GET /api/categories  (the second table)                  (new)
│   ├── stats.js       # GET /api/stats  (numbers now calculated by SQL)
│   └── admin.js       # POST /api/admin/reset  (needs an API key)
├── validators.js      # checks incoming data (same as P2)
├── middleware.js      # logger, rate limiter, API key check, error handlers (same as P2)
├── scripts/
│   └── migrate-json.js  # moves Project 2's data.json into the database           (new)
├── public/            # the DailyNest page (same as P2)
├── data/              # dailynest.db is created here (only when no cloud database is set)
├── .env.example       # template for your DATABASE_URL (copy to .env)
├── test.js            # automated tests
└── package.json
```

## The database design (Pillar 1: The Blueprint)

```
categories                         tasks
+----+----------+                  +----+----------------+-------------+------+------------+------------+
| id | name     |<-----------------| id | text           | category_id | done | created_at | updated_at |
+----+----------+   one-to-many    +----+----------------+-------------+------+------------+------------+
| 1  | home     |  (one category   | 4  | Drink 8 gl...  |      3      |  0   | 2026-...   | NULL       |
| 2  | study    |   has many tasks)| 3  | Study for 1 h  |      2      |  0   | 2026-...   | NULL       |
| 3  | health   |                  +----+----------------+-------------+------+------------+------------+
| 4  | shopping |
+----+----------+
```

- **Primary key (`id`)**: the unique ID of every row.
- **Foreign key (`tasks.category_id` -> `categories.id`)**: the glue. A task must point to a real category.
  `ON DELETE RESTRICT` means a category that still has tasks cannot be deleted.
- **Rules inside the database** (the database is the final source of truth):

| Rule | Where | What it stops |
|------|-------|---------------|
| `NOT NULL` | text, category_id, done | empty required values |
| `UNIQUE` | categories.name | two categories with the same name |
| `CHECK` | text length 1-80, done is 0 or 1 | impossible values |
| `DEFAULT` | done = 0, created_at = now | forgetting to send a value |
| `FOREIGN KEY` | tasks.category_id | tasks of a category that does not exist |

**Why SQL (PostgreSQL) and not NoSQL?** Our data is connected (category -> tasks) and has a fixed shape, which is what
relational databases are best at. PostgreSQL lives in the cloud, so the local app and the live demo can share it.
SQLite (a single file) stays as the offline fallback; `store.js` is written once and works with both.

**Why a native driver and not an ORM?** A native driver (`pg` for PostgreSQL) means we write the SQL ourselves, so you can see exactly what
happens. An ORM (Prisma, Sequelize) writes SQL for you: faster to build, but it hides the details.

## CRUD = HTTP = SQL (Pillar 3: The Action)

| CRUD | HTTP | SQL | Example |
|------|------|-----|---------|
| Create | POST | INSERT | `POST /api/tasks` |
| Read | GET | SELECT | `GET /api/tasks`, `GET /api/tasks/2` |
| Update | PUT (whole) / PATCH (part) | UPDATE | `PATCH /api/tasks/2` with `{"done": true}` |
| Delete | DELETE | DELETE | `DELETE /api/tasks/2` |

## API reference

Base URL: `http://localhost:3000`. All request and response bodies are JSON.
The API is the same as Project 2, plus `GET /api/categories`.

| Method | URL | What it does | Success |
|--------|-----|--------------|---------|
| GET | `/api/health` | Is the server (and the database) alive? | 200 |
| GET | `/api/tasks` | List tasks. Optional: `?category=study&done=false&search=milk&page=1&limit=100` | 200 |
| GET | `/api/tasks/:id` | Get one task | 200 |
| POST | `/api/tasks` | Create a task | 201 |
| PUT | `/api/tasks/:id` | Replace a task (send all fields) | 200 |
| PATCH | `/api/tasks/:id` | Change some fields, e.g. `{"done": true}` | 200 |
| DELETE | `/api/tasks/:id` | Delete one task | 204 |
| DELETE | `/api/tasks?done=true` | Clear all finished tasks | 200 |
| GET | `/api/categories` | The categories and how many tasks each has | 200 |
| GET | `/api/stats` | Totals and progress percentage | 200 |
| POST | `/api/admin/reset` | Put the 4 starter tasks back. Needs header `x-api-key` | 200 |

### Task fields

| Field | Rules |
|-------|-------|
| `text` | required, 1-80 characters, must contain a letter or a number (extra spaces are tidied) |
| `category` | optional: `home`, `study`, `health` or `shopping` (default `home`) |
| `done` | optional: `true` or `false` (default `false`) |

The database adds `id`, `createdAt` and (after a change) `updatedAt`.

Response format and status codes are the same as Project 2:
success `{ "success": true, "data": ... }`, error `{ "success": false, "error": { "code", "message", "details" } }`;
200, 201, 204, 400, 401, 403, 404, 413, 415, 429, 500. New: **503** from `/api/health` if the database cannot be reached.

## Examples (copy and run)

On Windows PowerShell use `curl.exe` instead of `curl`. The easiest way to try everything is the DailyNest page itself.

```bash
# Create
curl -i -X POST http://localhost:3000/api/tasks -H "Content-Type: application/json" \
  -d '{"text":"Buy milk and eggs","category":"shopping"}'

# Read (filters are done by SQL)
curl "http://localhost:3000/api/tasks?category=study&done=false"
curl http://localhost:3000/api/categories
curl http://localhost:3000/api/stats

# Update (only one field)
curl -X PATCH http://localhost:3000/api/tasks/2 -H "Content-Type: application/json" -d '{"done":true}'

# Delete
curl -X DELETE http://localhost:3000/api/tasks/2
curl -X DELETE "http://localhost:3000/api/tasks?done=true"

# Try an attack - it is saved as harmless text and nothing breaks
curl -X POST http://localhost:3000/api/tasks -H "Content-Type: application/json" \
  -d "{\"text\":\"x'); DROP TABLE tasks; --\"}"
```

## Protecting the data (Pillar 4: The Shield)

1. **Validation in the API** (`validators.js`): friendly 400 errors before anything reaches the database.
2. **Rules in the database** (`schema.sql`): `NOT NULL`, `UNIQUE`, `CHECK`, foreign key. Even if someone talks to the
   database directly or the code has a bug, bad data is refused.
3. **Parameterized queries** (`store.js`): user values only ever travel through `$1, $2 ...` placeholders.

```js
// DANGEROUS - never do this: the user's text becomes part of the SQL command
db.query("SELECT * FROM tasks WHERE text = '" + userInput + "'");

// SAFE - this project: the SQL and the data travel separately, the input is only ever DATA
db.query('SELECT * FROM tasks WHERE text = $1', [userInput]);
```

   `store.update` builds its `SET` list from fixed text written by us, never from the names the user sends.
4. **Transactions** (`BEGIN ... COMMIT`): `reset` and `migrate` are "all or nothing" - if anything fails halfway,
   everything is undone.
5. **Same safety as Project 2**: API key (401/403), rate limit (429), body size limit, errors never leak internals.

## Settings (environment variables)

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | 3000 | Port to listen on |
| `DATABASE_URL` | (empty) | Cloud PostgreSQL connection string. Empty = use the local SQLite file |
| `DB_FILE` | ./data/dailynest.db | Where the local SQLite file lives (only when `DATABASE_URL` is empty) |
| `API_KEY` | decodelabs-secret | Key needed for `/api/admin/reset` |
| `RATE_LIMIT_MAX` | 200 | Requests per minute per IP |
| `SILENT` | (off) | Set to `1` to hide request logs |

## How this covers the Project 3 requirements

| Requirement (from the brief) | Where |
|------------------------------|-------|
| Design a simple database schema | `schema.sql`: 2 tables, primary keys, a foreign key, a one-to-many relationship |
| Perform basic CRUD operations | `store.js` + `routes/tasks.js`: INSERT, SELECT, UPDATE, DELETE through POST, GET, PUT/PATCH, DELETE |
| Ensure proper data handling | validation + `NOT NULL / UNIQUE / CHECK / DEFAULT / FOREIGN KEY` + transactions + correct status codes |
| Pillar 2: connect with the right tool | `db.js`: native drivers (`pg` for PostgreSQL, built-in SQLite for the local file), choice explained above |
| Pillar 3: CRUD mapped to RESTful HTTP | table above; identical API to Project 2 so the page keeps working |
| Pillar 4: constraints and parameterization | the section above, proven by tests (SQL injection and direct-database checks) |
| Data longevity | data lives in a database, not in memory; `npm test` restarts a real server and checks the data is still there |
| One shared database | `DATABASE_URL` points the local app and the live demo at the same cloud database |

## Explain it in simple words

**What is persistence?** Data that stays saved after the program stops, because it is written to a file on disk, not kept in memory.
Project 2 faked it by copying a list into a JSON file. A database does it properly.

**Primary key vs foreign key?** The primary key is the unique ID of a row in its own table. A foreign key is a column that stores
another table's primary key, so the two tables are linked (`tasks.category_id` points to `categories.id`).

**What is a one-to-many relationship?** One row on one side connects to many rows on the other: one category has many tasks.

**PUT vs PATCH?** PUT replaces the whole task; PATCH changes only the fields you send.

**What is SQL injection and how is it stopped?** An attacker types SQL code into an input box hoping it runs.
Parameterized queries (`?`) make the database treat the input as plain data, never as a command.

**Why check data in the API *and* in the database?** The API gives friendly messages. The database is the last line of
defence: it cannot be bypassed by a bug in the code.

**What is a transaction?** A group of steps that either all succeed or are all undone, so you never end up half-finished.

**Why does `reset` also reset the ids?** It clears the table and the id counter so the starter tasks get ids 1 to 4 again
(`TRUNCATE ... RESTART IDENTITY` in PostgreSQL).

**Why do the local app and the live demo show the same tasks now?** Both connect to the same cloud database through `DATABASE_URL`.
A SQLite file would exist separately on each computer.

**Why are the functions `async` / `await`?** Asking a cloud database takes time (the network). `await` waits for the answer
without freezing the server.

## Ideas for next steps

- Add user accounts and login so each person has their own tasks (a `users` table with `tasks.user_id` as a second foreign key)
- Add due dates and reminders
