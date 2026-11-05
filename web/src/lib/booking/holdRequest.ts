// Retry policy for POST /shows/:showId/reservations. Every attempt of one click sends the SAME
// Idempotency-Key and the SAME seatIds, so a retry after a lost response replays the hold that
// was already made instead of making a second one.
import { ApiError, createReservation, type Reservation } from '../api';

/** Backoff before retry 1, 2 and 3. A Retry-After header, when present, wins. */
export const HOLD_RETRY_DELAYS_MS = [500, 1000, 2000] as const;
/** An attempt that takes longer than this is abandoned and retried (same key). */
export const HOLD_ATTEMPT_TIMEOUT_MS = 15_000;

/** Transient by the API's own definition (docs/api.md): the request can be sent again as is. */
const RETRYABLE_503 = new Set(['SERVICE_BUSY', 'DB_UNAVAILABLE', 'DB_TIMEOUT']);
const RETRYABLE_409 = new Set(['LOCK_TIMEOUT', 'RETRYABLE_CONFLICT']);
/** No API error body: the proxy/gateway answered because the API couldn't be reached. */
const GATEWAY_CODES = new Set(['HTTP_502', 'HTTP_503', 'HTTP_504']);

export function isRetryableHoldError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 0) return true; // NETWORK_ERROR or TIMEOUT
  if (error.status === 503 && RETRYABLE_503.has(error.code)) return true;
  if (error.status === 409 && RETRYABLE_409.has(error.code)) return true;
  return GATEWAY_CODES.has(error.code);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function attempt(showId: string, seatIds: string[], key: string): Promise<Reservation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOLD_ATTEMPT_TIMEOUT_MS);
  try {
    return await createReservation(showId, seatIds, key, controller.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', 'The request timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

interface HoldOptions {
  showId: string;
  seatIds: string[];
  key: string;
  /** How many retries after the first attempt (3 for a click, 0 for resuming after a reload). */
  retries?: number;
  /** Called before each retry, with its number (1-based) and the delay. */
  onRetry?: (retry: number, delayMs: number, error: ApiError) => void;
}

/**
 * Holds the seats, retrying transient failures up to `retries` times with backoff. Throws the
 * last ApiError when it gives up, or the first non-retryable one straight away.
 */
export async function holdSeatsWithRetry({ showId, seatIds, key, retries = HOLD_RETRY_DELAYS_MS.length, onRetry }: HoldOptions): Promise<Reservation> {
  for (let retry = 0; ; retry++) {
    try {
      return await attempt(showId, seatIds, key);
    } catch (error) {
      if (!(error instanceof ApiError) || retry >= retries || !isRetryableHoldError(error)) throw error;
      const backoff = HOLD_RETRY_DELAYS_MS[Math.min(retry, HOLD_RETRY_DELAYS_MS.length - 1)] ?? 2000;
      const delay = error.retryAfterSeconds !== undefined ? error.retryAfterSeconds * 1000 : backoff;
      onRetry?.(retry + 1, delay, error);
      await sleep(delay);
    }
  }
}
