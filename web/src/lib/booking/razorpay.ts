// Razorpay Checkout (docs/booking-flow.md "Paying with Razorpay"). The script is loaded only by the
// pay page, once per page load. Only the public key id ever reaches the browser.
import { ApiError, getBooking, verifyRazorpayPayment, type Booking, type RazorpaySuccess } from '../api';
import { isRetryableBookingError } from './checkout';
import { withRetries } from './retry';

export const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
export const RAZORPAY_TEST_DOCS = 'https://razorpay.com/docs/payments/payments/test-card-details/';

export interface RazorpayFailure {
  error?: { code?: string; description?: string; reason?: string; metadata?: { order_id?: string; payment_id?: string } };
}

export interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
  handler: (response: RazorpaySuccess) => void;
}

export interface RazorpayInstance {
  open: () => void;
  close: () => void;
  on: (event: 'payment.failed', cb: (response: RazorpayFailure) => void) => void;
}

type RazorpayCtor = new (options: RazorpayOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

let loading: Promise<RazorpayCtor> | null = null;

/** Adds checkout.js once. A failed load is forgotten, so "Retry" really tries again. */
export function loadRazorpay(): Promise<RazorpayCtor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loading) return loading;
  loading = new Promise<RazorpayCtor>((resolve, reject) => {
    document.querySelector(`script[src="${CHECKOUT_SRC}"]`)?.remove(); // a previous failed tag
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay missing after load')));
    script.onerror = () => reject(new Error('Could not load Razorpay Checkout'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export const isTestKey = (keyId: string) => keyId.startsWith('rzp_test_');

/** Network errors, 503s and Razorpay being briefly unreachable (502): verify is idempotent, so resend as is. */
function isRetryableVerifyError(error: unknown): boolean {
  return isRetryableBookingError(error) || (error instanceof ApiError && error.code === 'PAYMENT_PROVIDER_ERROR');
}

/** POST /payments/razorpay/verify, retried up to 3 times with the same payload. */
export function verifyWithRetry(body: RazorpaySuccess, onRetry?: (retry: number) => void): Promise<Booking> {
  return withRetries((signal) => verifyRazorpayPayment(body, signal), { isRetryable: isRetryableVerifyError, onRetry: (n) => onRetry?.(n) });
}

export const POLL_INTERVAL_MS = 3_000;
export const POLL_LIMIT_MS = 60_000;

/**
 * After verify could not finish: the webhook may still confirm the booking. Polls the booking
 * until it leaves PENDING_PAYMENT (or reads EXPIRED for good) or the time runs out (null).
 */
export async function pollBooking(bookingId: string, isCancelled: () => boolean): Promise<Booking | null> {
  const until = Date.now() + POLL_LIMIT_MS;
  while (Date.now() < until && !isCancelled()) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (isCancelled()) return null;
    try {
      const booking = await getBooking(bookingId);
      if (booking.status === 'CONFIRMED' || booking.status === 'REFUND_PENDING' || booking.status === 'REFUNDED') return booking;
    } catch {
      /* keep polling */
    }
  }
  return null;
}
