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

  // Handle generic / unexpected errors
  logger.error({ err }, 'Unhandled error occurred');
  res.status(500).json({ error: { message: 'Internal server error', code: 500 } });
}
