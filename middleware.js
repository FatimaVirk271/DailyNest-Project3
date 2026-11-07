// middleware.js - small helper functions that run BEFORE / AFTER our routes.

// Consistent error format so the client never has to guess
function sendError(res, status, code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(status).json({ success: false, error });
}

// Prints: GET /api/tasks 200 3ms
function requestLogger(req, res, next) {
  if (process.env.SILENT === '1') return next();
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
}

// Rate limiter: max N requests per minute per IP, otherwise 429 Too Many Requests
const WINDOW_MS = 60 * 1000;
const hits = new Map(); // ip -> { count, resetAt }

function rateLimiter(req, res, next) {
  const max = Number(process.env.RATE_LIMIT_MAX) || 200;
  const now = Date.now();
  let entry = hits.get(req.ip);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    hits.set(req.ip, entry);
  }
  entry.count++;

  res.set('X-RateLimit-Limit', String(max));
  res.set('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));

  if (entry.count > max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return sendError(res, 429, 'TOO_MANY_REQUESTS', `Too many requests. Please try again in ${retryAfter}s.`);
  }
  next();
}

// Authentication / Authorization (basic version) - used by the admin endpoint
// 401 = "I don't know who you are" (no key)   -> AuthN
// 403 = "I know you, but you can't do this"   -> AuthZ
function requireApiKey(req, res, next) {
  const expected = process.env.API_KEY || 'decodelabs-secret';
  const key = req.get('x-api-key');
  if (!key) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Missing x-api-key header');
  }
  if (key !== expected) {
    return sendError(res, 403, 'FORBIDDEN', 'Invalid API key - you are not allowed to do this');
  }
  next();
}

// Only accept JSON bodies on POST/PUT/PATCH
function requireJson(req, res, next) {
  if (!req.is('application/json')) {
    return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
  next();
}

// Unknown URL -> 404
function notFound(req, res) {
  sendError(res, 404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} does not exist`);
}

// Last line of defence: any error ends up here
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
  if (err.type === 'entity.too.large') {
    return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  console.error('Unexpected error:', err);
  // Never leak internal details to the client
  sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong on the server');
}

module.exports = {
  sendError,
  requestLogger,
  rateLimiter,
  requireApiKey,
  requireJson,
  notFound,
  errorHandler,
};
