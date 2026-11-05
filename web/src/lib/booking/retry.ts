// Shared retry loop for the booking writes (hold, checkout, pay). Each caller decides which
// failures are safe to send again; every retry sends the identical request.
import { ApiError } from '../api';

/** Backoff before retry 1, 2 and 3. A Retry-After header, when present, wins. */
export const RETRY_DELAYS_MS = [500, 1000, 2000] as const;
/** An attempt that takes longer than this is abandoned (and retried, if allowed). */
export const ATTEMPT_TIMEOUT_MS = 15_000;

/** No API error body: the proxy/gateway answered because the API couldn't be reached. */
export const GATEWAY_CODES = new Set(['HTTP_502', 'HTTP_503', 'HTTP_504']);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  /** Retries after the first attempt. */
  retries?: number;
  isRetryable: (error: unknown) => boolean;
  /** Called before each retry with its number (1-based) and the delay. */
  onRetry?: (retry: number, delayMs: number, error: ApiError) => void;
}

/**
 * Runs `send` (given an AbortSignal that fires after ATTEMPT_TIMEOUT_MS) until it succeeds, a
 * failure isn't retryable, or the retries run out. A timeout surfaces as ApiError(0, 'TIMEOUT').
 */
export async function withRetries<T>(send: (signal: AbortSignal) => Promise<T>, { retries = RETRY_DELAYS_MS.length, isRetryable, onRetry }: RetryOptions): Promise<T> {
  for (let retry = 0; ; retry++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      return await send(controller.signal);
    } catch (caught) {
      const error = caught instanceof DOMException && caught.name === 'AbortError' ? new ApiError(0, 'TIMEOUT', 'The request timed out.') : caught;
      if (!(error instanceof ApiError) || retry >= retries || !isRetryable(error)) throw error;
      const backoff = RETRY_DELAYS_MS[Math.min(retry, RETRY_DELAYS_MS.length - 1)] ?? 2000;
      const delay = error.retryAfterSeconds !== undefined ? error.retryAfterSeconds * 1000 : backoff;
      onRetry?.(retry + 1, delay, error);
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
}
