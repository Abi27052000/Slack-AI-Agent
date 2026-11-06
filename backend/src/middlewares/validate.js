import { AppError } from '../lib/errors.js';

const formatIssues = (issues, location) =>
  issues.map((issue) => ({
    location,
    path: issue.path.join('.'),
    message: issue.message,
  }));

/**
 * Validates request parts with zod schemas and exposes the parsed (coerced, defaulted) values on
 * `req.validated.{params,query,body}`. Express 5 makes `req.query` read-only, hence the separate field.
 *
 * @example router.get('/', validate({ query: listSchema }), handler)
 */
export function validate(schemas) {
  return function validateRequest(req, res, next) {
    req.validated = {};
    const issues = [];

    for (const location of ['params', 'query', 'body']) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location] ?? {});
      if (result.success) req.validated[location] = result.data;
      else issues.push(...formatIssues(result.error.issues, location));
    }

    if (issues.length > 0) return next(AppError.badRequest('Invalid request', issues));
    return next();
  };
}
