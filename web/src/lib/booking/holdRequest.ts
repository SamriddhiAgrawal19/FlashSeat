// Retry policy for POST /shows/:showId/reservations. Every attempt of one click sends the SAME
// Idempotency-Key and the SAME seatIds, so a retry after a lost response replays the hold that
// was already made instead of making a second one.
import { ApiError, createReservation, type Reservation } from '../api';
import { GATEWAY_CODES, RETRY_DELAYS_MS, withRetries } from './retry';

export { RETRY_DELAYS_MS as HOLD_RETRY_DELAYS_MS };

/** Transient by the API's own definition (docs/api.md): the request can be sent again as is. */
const RETRYABLE_503 = new Set(['SERVICE_BUSY', 'DB_UNAVAILABLE', 'DB_TIMEOUT']);
const RETRYABLE_409 = new Set(['LOCK_TIMEOUT', 'RETRYABLE_CONFLICT']);

export function isRetryableHoldError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 0) return true; // NETWORK_ERROR or TIMEOUT
  if (error.status === 503 && RETRYABLE_503.has(error.code)) return true;
  if (error.status === 409 && RETRYABLE_409.has(error.code)) return true;
  return GATEWAY_CODES.has(error.code);
}

interface HoldOptions {
  showId: string;
  seatIds: string[];
  key: string;
  /** How many retries after the first attempt (3 for a click, 0 for resuming after a reload). */
  retries?: number;
  onRetry?: (retry: number, delayMs: number, error: ApiError) => void;
}

/**
 * Holds the seats, retrying transient failures up to `retries` times with backoff. Throws the
 * last ApiError when it gives up, or the first non-retryable one straight away.
 */
export function holdSeatsWithRetry({ showId, seatIds, key, retries, onRetry }: HoldOptions): Promise<Reservation> {
  return withRetries((signal) => createReservation(showId, seatIds, key, signal), { retries, isRetryable: isRetryableHoldError, onRetry });
}
