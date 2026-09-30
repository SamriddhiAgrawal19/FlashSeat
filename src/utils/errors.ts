export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(409, message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(400, message);
    this.name = 'ValidationError';
  }
}
