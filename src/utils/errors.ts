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

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code: string = 'UNAUTHORIZED', details?: any) {
    super(401, message, code, details);
    this.name = 'UnauthorizedError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code: string | number = 'NOT_FOUND', details?: any) {
    super(404, message, code, details);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code: string | number = 'FORBIDDEN', details?: any) {
    super(403, message, code, details);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code: string | number = 'CONFLICT', details?: any) {
    super(409, message, code, details);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', code: string | number = 'VALIDATION_ERROR', details?: any) {
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
