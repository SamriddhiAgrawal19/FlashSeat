import { Request, Response, NextFunction } from 'express';
import { AppError, ConflictError, ValidationError } from '../utils/errors';
import { ZodError } from 'zod';
import pino from 'pino';

const logger = pino({ name: 'error-handler' });

const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '57P03']);
const CONNECTION_ERROR_MESSAGES = [
  'Connection terminated',
  'timeout exceeded when trying to connect',
  'not queryable',
];

// Connection-class failures: SQLSTATE class 08xxx, Node socket codes and pg's
// connection-lifecycle messages.
function isConnectionError(err: any): boolean {
  const code = String(err?.code ?? err?.cause?.code ?? '');
  if (/^08/.test(code) || CONNECTION_ERROR_CODES.has(code)) return true;
  const msg = String(err?.message ?? '');
  return CONNECTION_ERROR_MESSAGES.some((m) => msg.includes(m));
}

interface MappedDatabaseError {
  appError: AppError;
  retryAfter?: number;
}

// Maps low-level (mostly pg) errors to AppErrors, keyed on SQLSTATE. SQL text and
// constraint names are never copied into the response — they go to the logs only.
function mapDatabaseError(err: any): MappedDatabaseError | null {
  if (isConnectionError(err)) {
    return { appError: new AppError(503, 'Database unavailable, please retry', 'DB_UNAVAILABLE'), retryAfter: 1 };
  }
  switch (err?.code) {
    // generic fallback only: services translate their specific constraints first
    case '23505':
    case '23P01':
    case '23503':
      return { appError: new ConflictError('Conflict', 'CONFLICT') };
    case '23514':
    case '22P02':
    case '22001':
    case '22003':
      return { appError: new ValidationError('Validation failed', 'VALIDATION_ERROR') };
    // deadlock_detected / serialization_failure: safe for the client to retry
    case '40P01':
    case '40001':
      return { appError: new ConflictError('Retryable conflict, please retry', 'RETRYABLE_CONFLICT'), retryAfter: 1 };
    case '55P03':
      return { appError: new ConflictError('Lock timeout, please retry', 'LOCK_TIMEOUT'), retryAfter: 1 };
    case '57014':
      return { appError: new AppError(503, 'Database timeout, please retry', 'DB_TIMEOUT'), retryAfter: 1 };
    default:
      return null;
  }
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { message: 'Validation failed', code: 'VALIDATION_ERROR', details: (err as any).errors || (err as any).issues }
    });
  }

  if (err instanceof AppError) {
    const errorBody: { message: string; code: string | number; details?: any } = {
      message: err.message,
      code: err.code,
    };
    if (err.details !== undefined) {
      errorBody.details = err.details;
    }
    return res.status(err.statusCode).json({
      error: errorBody,
    });
  }

  const mapped = mapDatabaseError(err);
  if (mapped) {
    logger.warn(
      { code: err?.code, constraint: err?.constraint, detail: err?.detail },
      'Mapped database error'
    );
    if (mapped.retryAfter !== undefined) {
      res.setHeader('Retry-After', String(mapped.retryAfter));
    }
    return res.status(mapped.appError.statusCode).json({
      error: { message: mapped.appError.message, code: mapped.appError.code },
    });
  }

  // Anything else: generic body, full error logged (code, constraint, detail).
  logger.error(
    { err, code: err?.code, constraint: err?.constraint, detail: err?.detail },
    'Unhandled error occurred'
  );
  res.status(500).json({ error: { message: 'Internal server error', code: 'INTERNAL' } });
}
