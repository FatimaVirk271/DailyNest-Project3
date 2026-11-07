// server.js - the entry point. It wires everything together.
const express = require('express');
const path = require('path');
const { db } = require('./db');             // opening the database happens here (db.js runs once)
const tasksRouter = require('./routes/tasks');
const statsRouter = require('./routes/stats');
const categoriesRouter = require('./routes/categories');
const adminRouter = require('./routes/admin');
const {
  requestLogger,
  rateLimiter,
  notFound,
  errorHandler,
} = require('./middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10kb' })); // read JSON bodies (max 10 KB)
app.use(requestLogger);                   // log every request

// The DailyNest page (HTML, CSS, JS) is served from the public folder,
// so the page and the API share one address: http://localhost:3000
app.use(express.static(path.join(__dirname, 'public')));

// Health check - also proves the database answers (not rate limited)
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.status(200).json({
      success: true,
      data: { status: 'ok', database: 'connected', uptimeSeconds: Math.round(process.uptime()) },
    });
  } catch (err) {
    res.status(503).json({
      success: false,
      error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is not reachable' },
    });
  }
});

app.use('/api', rateLimiter);                 // 429 if someone spams the API
app.use('/api/tasks', tasksRouter);           // GET / POST / PUT / PATCH / DELETE
app.use('/api/categories', categoriesRouter); // categories + how many tasks each has
app.use('/api/stats', statsRouter);           // progress numbers (calculated by SQL)
app.use('/api/admin', adminRouter);           // protected by an API key

app.use(notFound);     // unknown URL -> 404
app.use(errorHandler); // any error -> clean JSON (400 / 413 / 500)

// Only start listening when run directly (so tests can import the app)
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`DailyNest running on http://localhost:${PORT}`);
  });

  // Ctrl+C: stop taking requests, then close the database cleanly
  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = app;
