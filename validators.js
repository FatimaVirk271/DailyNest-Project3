// validators.js - "The Gatekeeper Rule": Never trust the client.
//
// Layer 1 - SYNTACTIC validation: is the format correct? (types, lengths)
// Layer 2 - SEMANTIC validation: is the logic valid? (allowed categories,
//           the text must contain a real letter or number, not just symbols)

const CATEGORIES = ['home', 'study', 'health', 'shopping'];
const MAX_TEXT = 80; // same limit as the input box in the page (maxlength="80")
const HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

// partial = false -> used by POST and PUT (a full task is expected)
// partial = true  -> used by PATCH (send only the fields you want to change)
function validateTask(body, { partial = false } = {}) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { errors: [{ field: 'body', message: 'Request body must be a JSON object' }] };
  }

  const errors = [];
  const clean = {};

  // --- text (required unless partial) ---
  if (body.text !== undefined || !partial) {
    if (typeof body.text !== 'string') {
      errors.push({ field: 'text', message: 'text is required and must be text' });
    } else {
      const text = body.text.trim().replace(/\s+/g, ' '); // tidy extra spaces
      if (text.length < 1 || text.length > MAX_TEXT) {
        errors.push({ field: 'text', message: `text must be between 1 and ${MAX_TEXT} characters` });
      } else if (!HAS_LETTER_OR_NUMBER.test(text)) {
        errors.push({ field: 'text', message: 'text must contain at least one letter or number' });
      } else {
        clean.text = text;
      }
    }
  }

  // --- category (optional, must be one of the four, default "home") ---
  if (body.category !== undefined) {
    const category = typeof body.category === 'string' ? body.category.trim().toLowerCase() : null;
    if (!CATEGORIES.includes(category)) {
      errors.push({ field: 'category', message: `category must be one of: ${CATEGORIES.join(', ')}` });
    } else {
      clean.category = category;
    }
  } else if (!partial) {
    clean.category = 'home';
  }

  // --- done (optional, true or false, default false) ---
  if (body.done !== undefined) {
    if (typeof body.done !== 'boolean') {
      errors.push({ field: 'done', message: 'done must be true or false' });
    } else {
      clean.done = body.done;
    }
  } else if (!partial) {
    clean.done = false;
  }

  // PATCH with nothing to change makes no sense
  if (partial && errors.length === 0 && Object.keys(clean).length === 0) {
    errors.push({ field: 'body', message: 'Send at least one of: text, category, done' });
  }

  return { errors, clean };
}

module.exports = { validateTask, CATEGORIES, MAX_TEXT };
