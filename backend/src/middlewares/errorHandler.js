import config from '../config/index.js';
import logger from '../lib/logger.js';
import { AppError } from '../lib/errors.js';

export const notFound = (req, res, next) => {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

/** Maps body-parser errors (malformed JSON, payload too large) to client errors. */
function normalizeError(err) {
  if (err instanceof AppError) return err;
  if (err.type === 'entity.parse.failed') {
    return new AppError(400, 'Malformed JSON in request body', 'INVALID_JSON');
  }
  if (err.type === 'entity.too.large') {
    return new AppError(413, 'Request body too large', 'PAYLOAD_TOO_LARGE');
  }
  return null;
}

// Express identifies error handlers by their 4-argument signature.
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  const known = normalizeError(err);
  const status = known?.status ?? 500;
  // 4xx responses are already logged (as warn) by the request logger; only 5xx need the error detail.
  if (status >= 500) {
    (req.log ?? logger).error({ err }, 'Unhandled error');
  }

  res.status(status).json({
    error: {
      code: known?.code ?? 'INTERNAL_ERROR',
      message: known?.message ?? 'Internal Server Error',
      ...(known?.details && { details: known.details }),
      ...(req.id && { requestId: req.id }),
      ...(config.isDev && status >= 500 && { stack: err.stack }),
    },
  });
};
