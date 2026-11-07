// routes/tasks.js - all endpoints for the "tasks" resource.
// Project 3: the routes are almost the same as Project 2. Only the store (now SQL) changed.
// RESTful rule: Resources are NOUNS (/tasks), methods are VERBS (GET, POST...).
const express = require('express');
const store = require('../store');
const { validateTask, CATEGORIES } = require('../validators');
const { sendError, requireJson } = require('../middleware');

const router = express.Router();

// Turns the :id in the URL into a number, or rejects it with 400
function parseId(req, res, next) {
  if (!/^\d+$/.test(req.params.id)) {
    return sendError(res, 400, 'INVALID_ID', 'id must be a positive whole number');
  }
  req.taskId = Number(req.params.id);
  next();
}

// ---------------------------------------------------------------
// GET /api/tasks
//   optional filters: ?category=study  ?done=true  ?search=milk  ?page=1  ?limit=100
// ---------------------------------------------------------------
router.get('/', (req, res) => {
  const { category, done, search } = req.query;
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);

  if (!Number.isInteger(page) || page < 1) {
    return sendError(res, 400, 'INVALID_QUERY', 'page must be a whole number >= 1');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return sendError(res, 400, 'INVALID_QUERY', 'limit must be a whole number between 1 and 200');
  }
  if (category !== undefined && !CATEGORIES.includes(category)) {
    return sendError(res, 400, 'INVALID_QUERY', `category must be one of: ${CATEGORIES.join(', ')}`);
  }
  if (done !== undefined && done !== 'true' && done !== 'false') {
    return sendError(res, 400, 'INVALID_QUERY', 'done must be true or false');
  }

  // The database does the filtering and paging (WHERE ... LIMIT ... OFFSET) - not JavaScript.
  const { tasks, total } = store.list({
    category,
    done: done === undefined ? undefined : done === 'true',
    search: typeof search === 'string' ? search.trim() : '',
    limit,
    offset: (page - 1) * limit,
  });

  res.status(200).json({
    success: true,
    data: tasks,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
});

// ---------------------------------------------------------------
// GET /api/tasks/:id    -> one task
// ---------------------------------------------------------------
router.get('/:id', parseId, (req, res) => {
  const task = store.find(req.taskId);
  if (!task) {
    return sendError(res, 404, 'NOT_FOUND', `Task ${req.taskId} not found`);
  }
  res.status(200).json({ success: true, data: task });
});

// ---------------------------------------------------------------
// POST /api/tasks       -> create a task  { "text": "...", "category": "home" }
// ---------------------------------------------------------------
router.post('/', requireJson, (req, res) => {
  const { errors, clean } = validateTask(req.body);
  if (errors.length) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid task data', errors);
  }
  const task = store.create(clean);
  res.status(201).location(`/api/tasks/${task.id}`).json({ success: true, data: task });
});

// ---------------------------------------------------------------
// PUT /api/tasks/:id    -> REPLACE a task (send text, category, done)
// ---------------------------------------------------------------
router.put('/:id', parseId, requireJson, (req, res) => {
  if (!store.find(req.taskId)) {
    return sendError(res, 404, 'NOT_FOUND', `Task ${req.taskId} not found`);
  }
  const { errors, clean } = validateTask(req.body);
  if (errors.length) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid task data', errors);
  }
  const task = store.update(req.taskId, clean);
  res.status(200).json({ success: true, data: task });
});

// ---------------------------------------------------------------
// PATCH /api/tasks/:id  -> change SOME fields, e.g. { "done": true }
// (this is what the "Mark done" button uses)
// ---------------------------------------------------------------
router.patch('/:id', parseId, requireJson, (req, res) => {
  if (!store.find(req.taskId)) {
    return sendError(res, 404, 'NOT_FOUND', `Task ${req.taskId} not found`);
  }
  const { errors, clean } = validateTask(req.body, { partial: true });
  if (errors.length) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid task data', errors);
  }
  const task = store.update(req.taskId, clean);
  res.status(200).json({ success: true, data: task });
});

// ---------------------------------------------------------------
// DELETE /api/tasks/:id -> remove one task
// ---------------------------------------------------------------
router.delete('/:id', parseId, (req, res) => {
  if (!store.remove(req.taskId)) {
    return sendError(res, 404, 'NOT_FOUND', `Task ${req.taskId} not found`);
  }
  res.status(204).end(); // 204 = success, nothing to send back
});

// ---------------------------------------------------------------
// DELETE /api/tasks?done=true -> "Clear finished tasks" button
// ---------------------------------------------------------------
router.delete('/', (req, res) => {
  if (req.query.done !== 'true') {
    return sendError(res, 400, 'INVALID_QUERY', 'Only finished tasks can be cleared: use DELETE /api/tasks?done=true');
  }
  const deleted = store.removeDone();
  res.status(200).json({ success: true, data: { deleted } });
});

module.exports = router;
