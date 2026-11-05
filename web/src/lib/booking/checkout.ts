// Checkout and mock payment. Both are idempotent on the server without a key (one booking per
// reservation; a CONFIRMED booking replays), so a lost response can be retried as is.
import { ApiError, checkoutReservation, confirmMockPayment, type Booking } from '../api';
import { GATEWAY_CODES, withRetries } from './retry';

/** Only failures where nothing (or the same thing again) can happen: no response, or a 503. */
export function isRetryableBookingError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 0 || error.status === 503 || GATEWAY_CODES.has(error.code);
}

type OnRetry = (retry: number, delayMs: number, error: ApiError) => void;

export function checkoutWithRetry(reservationId: string, onRetry?: OnRetry): Promise<Booking> {
  return withRetries((signal) => checkoutReservation(reservationId, signal), { isRetryable: isRetryableBookingError, onRetry });
}

export function payWithRetry(bookingId: string, onRetry?: OnRetry): Promise<Booking> {
  return withRetries((signal) => confirmMockPayment(bookingId, signal), { isRetryable: isRetryableBookingError, onRetry });
}

/** The hold or booking can no longer be paid for: the user has to pick seats again. */
export const HOLD_ENDED_CODES = new Set(['HOLD_LOST', 'RESERVATION_NOT_ACTIVE', 'BOOKING_NOT_PAYABLE', 'SHOW_NOT_BOOKABLE']);

/** confirm-mock answers 404 "Endpoint not available" when ENABLE_MOCK_PAYMENT is off. */
export function isPaymentsDisabled(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.message === 'Endpoint not available';
}
