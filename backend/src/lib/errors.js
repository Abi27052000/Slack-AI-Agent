/**
 * Operational error with an HTTP status and a stable machine-readable code.
 * Throw it from controllers/services; the error handler turns it into a JSON response.
 */
export class AppError extends Error {
  constructor(status, message, code = 'APP_ERROR', details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Bad request', details) {
    return new AppError(400, message, 'BAD_REQUEST', details);
  }

  static unauthorized(message = 'Unauthorized') {
    return new AppError(401, message, 'UNAUTHORIZED');
  }

  static notFound(message = 'Resource not found') {
    return new AppError(404, message, 'NOT_FOUND');
  }
}
