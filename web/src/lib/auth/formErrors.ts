import { ApiError } from '../api';

/**
 * VALIDATION_ERROR details are Zod issues: [{ path: ['email'], message: '...' }, ...]
 * (src/middleware/errorHandler.ts). Returns the first message per top-level field.
 */
export function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR' || !Array.isArray(error.details)) return {};
  const out: Record<string, string> = {};
  for (const issue of error.details as unknown[]) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { path, message } = issue as { path?: unknown; message?: unknown };
    const field = Array.isArray(path) ? path[0] : undefined;
    if (typeof field === 'string' && typeof message === 'string' && !out[field]) out[field] = message;
  }
  return out;
}
