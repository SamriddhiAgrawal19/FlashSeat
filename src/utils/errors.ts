export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string | number = statusCode,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code: string | number = 404, details?: any) {
    super(404, message, code, details);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code: string | number = 403, details?: any) {
    super(403, message, code, details);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code: string | number = 409, details?: any) {
    super(409, message, code, details);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', code: string | number = 400, details?: any) {
    super(400, message, code, details);
    this.name = 'ValidationError';
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(
    message = 'Unprocessable Entity',
    code: string | number = 'IDEMPOTENCY_KEY_REUSED',
    details?: any
  ) {
    super(422, message, code, details);
    this.name = 'UnprocessableEntityError';
  }
}

export { UnprocessableEntityError as IdempotencyKeyReusedError };
