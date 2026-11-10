/**
 * Razorpay payments: create order, verify the checkout callback, process webhooks.
 * docs/booking-flow.md ("Paying with Razorpay") has the sequence diagram.
 *
 * Rules:
 *  - The amount always comes from bookings.total_amount_paise, never from a request.
 *  - No network call is made while holding database locks.
 *  - onPaymentCaptured is the ONE place a Razorpay payment turns into tickets. It is
 *    idempotent and safe to run concurrently (verify + webhook): both serialize on
 *    the reservation/booking row locks, the second one sees CONFIRMED and replays.
 *  - Secrets are never logged.
 */
import pino from 'pino';
import { PoolClient } from 'pg';
import { pool, withTransaction } from '../../db/pool';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { confirmBookingCore, type FormattedBookingResponse } from '../bookings/bookings.service';
import * as repo from './payments.repository';
import { requireRazorpay } from './payments.runtime';
import { isValidCheckoutSignature } from './payments.signature';
import { PaymentProviderError, type ProviderPayment } from './razorpay.client';

const logger = pino({ name: 'payments' });

/** Less time than this left on the hold: don't start a payment that would likely outlive it. */
export const MIN_HOLD_SECONDS_TO_PAY = 120;
const CURRENCY = 'INR';

// ------------------------------------------------------------------ create order

export interface PaymentOrderResponse {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  bookingId: string;
}

/** Checks the booking can be paid now; runs under the show -> reservation -> booking locks. */
async function assertPayable(client: PoolClient, booking: repo.PayableBookingRow, { checkTime }: { checkTime: boolean }) {
  const locked = await repo.lockBookingChain(client, booking.show_id, booking.reservation_id, booking.id);
  if (!locked.show || !locked.reservation || !locked.booking) throw new NotFoundError('Booking not found');
  if (locked.booking.status !== 'PENDING_PAYMENT') {
    throw new ConflictError(`Booking is not in payable state (status: ${locked.booking.status})`, 'BOOKING_NOT_PAYABLE', {
      status: locked.booking.status,
    });
  }
  const bookable = locked.show.status === 'SCHEDULED' && locked.show.event_status === 'PUBLISHED' && locked.show.not_started;
  if (!bookable) throw new ConflictError('Show is not bookable', 'SHOW_NOT_BOOKABLE');
  if (!locked.reservation.hold_live) throw new ConflictError('Hold has expired or is no longer active', 'HOLD_LOST');
  if (checkTime && locked.reservation.hold_seconds_left < MIN_HOLD_SECONDS_TO_PAY) {
    throw new ConflictError('Not enough time left to pay; please hold seats again', 'HOLD_TOO_SHORT', {
      secondsLeft: Math.max(0, Math.floor(locked.reservation.hold_seconds_left)),
    });
  }
  return locked;
}

function orderResponse(keyId: string, p: repo.PaymentRow): PaymentOrderResponse {
  return { keyId, orderId: p.provider_order_id, amount: Number(p.amount_paise), currency: p.currency, bookingId: p.booking_id };
}

/**
 * POST /bookings/:bookingId/payments. Idempotent: an open (CREATED) order for the
 * booking is returned as is. Otherwise: validate under locks (short tx), create the
 * Razorpay order (no locks held), then insert under the same checks (short tx). Two
 * concurrent callers converge on one CREATED row (partial unique index); the losing
 * Razorpay order is never shown to anyone and simply expires unpaid.
 */
export async function createPaymentOrder(userId: string, bookingId: string): Promise<{ order: PaymentOrderResponse; replayed: boolean }> {
  const rt = requireRazorpay();
  const booking = await repo.findBookingForPayment(pool, bookingId);
  if (!booking || booking.user_id !== userId) throw new NotFoundError('Booking not found');

  // 1. Validate (and replay an open order).
  const existing = await withTransaction(async (client) => {
    const locked = await assertPayable(client, booking, { checkTime: false });
    const open = await repo.findCreatedPayment(client, bookingId);
    if (open) return open;
    if (locked.reservation!.hold_seconds_left < MIN_HOLD_SECONDS_TO_PAY) {
      throw new ConflictError('Not enough time left to pay; please hold seats again', 'HOLD_TOO_SHORT', {
        secondsLeft: Math.max(0, Math.floor(locked.reservation!.hold_seconds_left)),
      });
    }
    return null;
  });
  if (existing) return { order: orderResponse(rt.keyId, existing), replayed: true };

  // 2. Create the provider order. Amount from the database row read under lock above;
  // re-read here so the value sent is exactly what the booking says.
  const amountPaise = Number(booking.total_amount_paise);
  let order;
  try {
    order = await rt.client.createOrder({ amountPaise, currency: CURRENCY, receipt: bookingId, notes: { bookingId } });
  } catch (err) {
    logger.error({ bookingId, err: err instanceof PaymentProviderError ? err.message : String(err) }, 'Razorpay order creation failed');
    throw new AppError(502, 'Payment provider unavailable, please retry', 'PAYMENT_PROVIDER_ERROR');
  }
  if (order.amount !== amountPaise) {
    logger.error({ bookingId, expected: amountPaise, got: order.amount }, 'Razorpay order amount mismatch');
    throw new AppError(502, 'Payment provider returned an unexpected amount', 'PAYMENT_PROVIDER_ERROR');
  }

  // 3. Store it (re-checking the booking is still payable; the hold may have ended meanwhile).
  return withTransaction(async (client) => {
    const locked = await assertPayable(client, booking, { checkTime: false });
    if (Number(locked.booking!.total_amount_paise) !== amountPaise) throw new ConflictError('Booking changed, please retry', 'RETRYABLE_CONFLICT');
    const inserted = await repo.insertCreatedPayment(client, { bookingId, orderId: order.id, amountPaise, currency: CURRENCY });
    if (inserted) return { order: orderResponse(rt.keyId, inserted), replayed: false };
    const winner = await repo.findCreatedPayment(client, bookingId);
    if (!winner) throw new ConflictError('Retryable conflict, please retry', 'RETRYABLE_CONFLICT');
    return { order: orderResponse(rt.keyId, winner), replayed: true };
  });
}

// ------------------------------------------------------------------ on payment captured

export type CapturedOutcome =
  | { kind: 'confirmed'; booking: FormattedBookingResponse; replayed: boolean }
  | { kind: 'refund'; bookingId: string; reason: 'EVENT_CANCELLED' | 'HOLD_EXPIRED' }
  | { kind: 'unknown_order' };

/** Booking-side reasons a captured payment cannot become tickets: refund instead. */
const NOT_CONFIRMABLE = new Set(['HOLD_LOST', 'SHOW_NOT_BOOKABLE', 'BOOKING_NOT_PAYABLE', 'RESERVATION_NOT_ACTIVE']);

/**
 * Shared by verify and the webhook. One transaction, global lock order:
 *   show (FOR SHARE) -> reservation -> booking -> payment -> show_seats (inside confirmBookingCore)
 * Marks the payment CAPTURED, then confirms. When the booking can no longer be
 * confirmed (hold lost/expired, booking cancelled or expired, show not bookable) the
 * booking becomes REFUND_PENDING with a refunds row; nothing else is released.
 */
export async function onPaymentCaptured(input: { orderId: string; providerPaymentId: string; amountPaise: number }): Promise<CapturedOutcome> {
  return withTransaction(async (client) => {
    const payment = await repo.findPaymentByOrderId(client, input.orderId);
    if (!payment) return { kind: 'unknown_order' } as const;
    if (Number(payment.amount_paise) !== input.amountPaise) {
      logger.error({ paymentId: payment.id, stored: payment.amount_paise, got: input.amountPaise }, 'Captured amount does not match the order');
      throw new ConflictError('Payment amount does not match the order', 'PAYMENT_AMOUNT_MISMATCH');
    }
    const booking = await repo.findBookingForPayment(client, payment.booking_id);
    if (!booking) throw new NotFoundError('Booking not found');

    // Hierarchy: show -> reservation -> booking, then the payment row.
    const chain = await repo.lockBookingChain(client, booking.show_id, booking.reservation_id, booking.id);
    if (!chain.booking) throw new NotFoundError('Booking not found');
    const locked = await repo.lockPayment(client, payment.id);
    if (!locked) throw new NotFoundError('Payment not found');

    if (locked.status === 'CAPTURED' && locked.provider_payment_id !== input.providerPaymentId) {
      logger.error({ paymentId: locked.id }, 'Order already captured by a different payment id; needs manual review');
      throw new ConflictError('This order was already paid by another payment', 'PAYMENT_MISMATCH');
    }
    if (locked.status !== 'CAPTURED') await repo.markPaymentCaptured(client, locked.id, input.providerPaymentId);

    const bookingStatus = chain.booking.status;
    if (bookingStatus === 'REFUND_PENDING' || bookingStatus === 'REFUNDED') {
      // Already handled as a refund (an earlier delivery); make sure the refund row exists.
      const reason = chain.show?.event_status === 'CANCELLED' ? 'EVENT_CANCELLED' : 'HOLD_EXPIRED';
      if (bookingStatus === 'REFUND_PENDING') {
        await repo.insertRefund(client, { paymentId: locked.id, bookingId: booking.id, amountPaise: Number(locked.amount_paise), reason });
      }
      return { kind: 'refund', bookingId: booking.id, reason } as const;
    }

    await client.query('SAVEPOINT confirm_attempt');
    try {
      const result = await confirmBookingCore(client, booking.id);
      await client.query('RELEASE SAVEPOINT confirm_attempt');
      return { kind: 'confirmed', booking: result.booking, replayed: result.replayed } as const;
    } catch (err) {
      if (!(err instanceof ConflictError) || !NOT_CONFIRMABLE.has(String(err.code))) throw err;
      await client.query('ROLLBACK TO SAVEPOINT confirm_attempt');
      const reason = chain.show?.event_status === 'CANCELLED' || chain.show?.status === 'CANCELLED' ? 'EVENT_CANCELLED' : 'HOLD_EXPIRED';
      await repo.setBookingRefundPending(client, booking.id);
      await repo.insertRefund(client, { paymentId: locked.id, bookingId: booking.id, amountPaise: Number(locked.amount_paise), reason });
      logger.warn({ bookingId: booking.id, paymentId: locked.id, cause: err.code, reason }, 'Payment captured but booking not confirmable; refund queued');
      return { kind: 'refund', bookingId: booking.id, reason } as const;
    }
  });
}

/** The user-facing error for a captured payment that could not become tickets. */
export function refundStartedError(bookingId: string): ConflictError {
  return new ConflictError(
    'Payment received, but your seats are no longer available. A full refund has been started.',
    'PAYMENT_CAPTURED_SEATS_UNAVAILABLE',
    { bookingId, refund: 'PENDING' }
  );
}

// ------------------------------------------------------------------ verify

export interface VerifyInput {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

/** POST /payments/razorpay/verify: the checkout callback. */
export async function verifyCheckout(userId: string, input: VerifyInput): Promise<{ booking: FormattedBookingResponse; replayed: boolean }> {
  const rt = requireRazorpay();
  if (!isValidCheckoutSignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature, rt.keySecret)) {
    logger.warn({ orderId: input.razorpay_order_id, userId }, 'Rejected checkout callback: invalid signature');
    throw new ValidationError('Invalid payment signature', 'INVALID_SIGNATURE');
  }

  const payment = await repo.findPaymentByOrderId(pool, input.razorpay_order_id);
  if (!payment || payment.user_id !== userId) throw new NotFoundError('Payment not found');

  let provider: ProviderPayment;
  try {
    provider = await rt.client.fetchPayment(input.razorpay_payment_id);
    if (provider.status === 'authorized') {
      provider = await rt.client.capturePayment(provider.id, Number(payment.amount_paise), payment.currency);
    }
  } catch (err) {
    logger.error({ orderId: input.razorpay_order_id, err: err instanceof PaymentProviderError ? err.message : String(err) }, 'Razorpay payment fetch/capture failed');
    throw new AppError(502, 'Payment provider unavailable, please retry', 'PAYMENT_PROVIDER_ERROR');
  }

  if (provider.order_id !== payment.provider_order_id) {
    throw new ConflictError('Payment does not belong to this order', 'PAYMENT_MISMATCH');
  }
  if (provider.status !== 'captured') {
    throw new ConflictError(`Payment is not captured (status: ${provider.status})`, 'PAYMENT_NOT_CAPTURED', { status: provider.status });
  }
  if (provider.amount !== Number(payment.amount_paise) || provider.currency !== payment.currency) {
    logger.error({ orderId: payment.provider_order_id, stored: payment.amount_paise, got: provider.amount }, 'Captured amount mismatch on verify');
    throw new ConflictError('Payment amount does not match the order', 'PAYMENT_AMOUNT_MISMATCH');
  }

  const outcome = await onPaymentCaptured({ orderId: payment.provider_order_id, providerPaymentId: provider.id, amountPaise: provider.amount });
  if (outcome.kind === 'confirmed') return { booking: outcome.booking, replayed: outcome.replayed };
  if (outcome.kind === 'refund') throw refundStartedError(outcome.bookingId);
  throw new NotFoundError('Payment not found');
}

// ------------------------------------------------------------------ webhook processing

/**
 * Processes one recorded webhook event. Throws on transient failures (the worker
 * retries); returns a note for events that are done (including ignored ones).
 */
export async function processWebhookEvent(eventType: string, payload: any): Promise<string | null> {
  const entity = payload?.payload?.payment?.entity;
  switch (eventType) {
    case 'payment.captured': {
      if (!entity?.order_id || !entity?.id) return 'ignored: no payment entity';
      if (entity.status !== 'captured') return `ignored: status ${entity.status}`;
      try {
        const outcome = await onPaymentCaptured({ orderId: entity.order_id, providerPaymentId: entity.id, amountPaise: Number(entity.amount) });
        if (outcome.kind === 'unknown_order') return 'ignored: unknown order';
        return outcome.kind === 'refund' ? 'refund queued' : outcome.replayed ? 'already confirmed' : 'confirmed';
      } catch (err) {
        // A definitive business answer (amount mismatch, ...) will not change on retry.
        if (err instanceof AppError && err.statusCode < 500) return `rejected: ${err.code}`;
        throw err;
      }
    }
    case 'payment.failed': {
      if (!entity?.order_id) return 'ignored: no payment entity';
      const reason = String(entity.error_description ?? entity.error_reason ?? 'Payment failed');
      const n = await repo.markPaymentFailed(pool, entity.order_id, entity.id ?? null, reason);
      return n > 0 ? 'payment marked FAILED' : 'ignored: no open order';
    }
    default:
      return `ignored: ${eventType}`;
  }
}
