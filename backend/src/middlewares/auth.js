import { createHash, timingSafeEqual } from 'node:crypto';
import config from '../config/index.js';
import { AppError } from '../lib/errors.js';

const digest = (value) => createHash('sha256').update(value).digest();

/** Constant-time comparison (hashing first makes the lengths equal, as timingSafeEqual requires). */
export function safeEqual(a, b) {
  return timingSafeEqual(digest(a), digest(b));
}

/** Reads the key from `Authorization: Bearer <key>` or `X-API-Key: <key>`. */
function extractKey(req) {
  const header = req.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return req.get('x-api-key')?.trim() || null;
}

/**
 * Protects the admin/dashboard API with a shared API key.
 * When no key is configured (development only; config validation forbids it in production),
 * requests pass through and the server logs a warning at startup.
 */
export function createRequireAdmin(options = {}) {
  // `'apiKey' in options`, not a default parameter: an explicit `undefined` means "no key".
  const apiKey = 'apiKey' in options ? options.apiKey : config.admin.apiKey;

  return function requireAdmin(req, res, next) {
    if (!apiKey) return next();

    const provided = extractKey(req);
    if (!provided || !safeEqual(provided, apiKey)) {
      res.set('WWW-Authenticate', 'Bearer realm="admin"');
      return next(AppError.unauthorized('A valid API key is required (Authorization: Bearer <ADMIN_API_KEY>)'));
    }
    return next();
  };
}

export const requireAdmin = createRequireAdmin();
