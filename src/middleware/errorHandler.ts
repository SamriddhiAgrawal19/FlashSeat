import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { ZodError } from 'zod';
import pino from 'pino';

const logger = pino({ name: 'error-handler' });

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { message: 'Validation failed', code: 400, details: (err as any).errors || (err as any).issues }
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { message: err.message, code: err.statusCode }
    });
  }

  // Handle generic / unexpected errors
  logger.error({ err }, 'Unhandled error occurred');
  res.status(500).json({ error: { message: 'Internal server error', code: 500 } });
}
