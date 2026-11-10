/**
 * Payments, refunds and webhook_events SQL. Lock order (docs/lock-order.md):
 *   show (3) -> reservation (4) -> booking (5) -> payment / refund (5b) -> show_seats (6)
 * A transaction that locks a payment or refund row never locks a show, reservation
 * or booking after it.
 */
import { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

export interface PaymentRow {
  id: string;
  booking_id: string;
  provider: string;
  provider_order_id: string;
  provider_payment_id: string | null;
  amount_paise: string; // bigint as text
  currency: string;
  status: 'CREATED' | 'CAPTURED' | 'FAILED';
  failure_reason: string | null;
}

const PAYMENT_COLS = 'id, booking_id, provider, provider_order_id, provider_payment_id, amount_paise, currency, status, failure_reason';

// ---------------------------------------------------------------- bookings (payment view)

export interface PayableBookingRow {
  id: string;
  user_id: string;
  status: string;
  total_amount_paise: string;
  reservation_id: string;
  show_id: string;
  /** reservation ACTIVE and expires_at > now() */
  hold_live: boolean;
  /** seconds left on the hold by the DB clock (may be negative) */
  hold_seconds_left: number;
}

/** Plain read (no locks) of a booking with its hold state, for the owner check. */
export async function findBookingForPayment(db: Db, bookingId: string): Promise<PayableBookingRow | null> {
  const r = await db.query<PayableBookingRow>(
    `SELECT b.id, b.user_id, b.status, b.total_amount_paise, b.reservation_id, r.show_id,
            (r.status = 'ACTIVE' AND r.expires_at > now()) AS hold_live,
            EXTRACT(EPOCH FROM (r.expires_at - now()))::float8 AS hold_seconds_left
       FROM bookings b JOIN reservations r ON r.id = b.reservation_id
      WHERE b.id = $1`,
    [bookingId]
  );
  return r.rows[0] ?? null;
}

/** Locks the show (FOR SHARE), the reservation and the booking, in hierarchy order. */
export async function lockBookingChain(client: PoolClient, showId: string, reservationId: string, bookingId: string) {
  const show = await client.query<{ status: string; event_status: string; not_started: boolean }>(
    `SELECT s.status, e.status AS event_status, (s.starts_at > now()) AS not_started
       FROM shows s JOIN events e ON e.id = s.event_id
      WHERE s.id = $1 FOR SHARE OF s`,
    [showId]
  );
  const res = await client.query<{ hold_live: boolean; hold_seconds_left: number }>(
    `SELECT (status = 'ACTIVE' AND expires_at > now()) AS hold_live,
            EXTRACT(EPOCH FROM (expires_at - now()))::float8 AS hold_seconds_left
       FROM reservations WHERE id = $1 FOR UPDATE`,
    [reservationId]
  );
  const booking = await client.query<{ status: string; total_amount_paise: string }>(
    `SELECT status, total_amount_paise FROM bookings WHERE id = $1 FOR UPDATE`,
    [bookingId]
  );
  return { show: show.rows[0] ?? null, reservation: res.rows[0] ?? null, booking: booking.rows[0] ?? null };
}

export async function setBookingRefundPending(client: PoolClient, bookingId: string): Promise<void> {
  await client.query(`UPDATE bookings SET status = 'REFUND_PENDING' WHERE id = $1`, [bookingId]);
}

// ---------------------------------------------------------------- payments

export async function findCreatedPayment(db: Db, bookingId: string): Promise<PaymentRow | null> {
  const r = await db.query<PaymentRow>(`SELECT ${PAYMENT_COLS} FROM payments WHERE booking_id = $1 AND status = 'CREATED'`, [bookingId]);
  return r.rows[0] ?? null;
}

export async function countPaymentsForBooking(db: Db, bookingId: string): Promise<number> {
  const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM payments WHERE booking_id = $1`, [bookingId]);
  return r.rows[0]?.n ?? 0;
}

/** Inserts the CREATED payment; null when another CREATED payment won the race (partial unique index). */
export async function insertCreatedPayment(
  client: PoolClient,
  p: { bookingId: string; orderId: string; amountPaise: number; currency: string }
): Promise<PaymentRow | null> {
  const r = await client.query<PaymentRow>(
    `INSERT INTO payments (booking_id, provider, provider_order_id, amount_paise, currency, status)
     VALUES ($1, 'razorpay', $2, $3, $4, 'CREATED')
     ON CONFLICT (booking_id) WHERE status = 'CREATED' DO NOTHING
     RETURNING ${PAYMENT_COLS}`,
    [p.bookingId, p.orderId, p.amountPaise, p.currency]
  );
  return r.rows[0] ?? null;
}

/** Plain read by provider order id, with the booking owner. */
export async function findPaymentByOrderId(db: Db, orderId: string): Promise<(PaymentRow & { user_id: string }) | null> {
  const r = await db.query<PaymentRow & { user_id: string }>(
    `SELECT p.${PAYMENT_COLS.split(', ').join(', p.')}, b.user_id
       FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE p.provider_order_id = $1`,
    [orderId]
  );
  return r.rows[0] ?? null;
}

export async function lockPayment(client: PoolClient, paymentId: string): Promise<PaymentRow | null> {
  const r = await client.query<PaymentRow>(`SELECT ${PAYMENT_COLS} FROM payments WHERE id = $1 FOR UPDATE`, [paymentId]);
  return r.rows[0] ?? null;
}

export async function markPaymentCaptured(client: PoolClient, paymentId: string, providerPaymentId: string): Promise<void> {
  await client.query(
    `UPDATE payments SET status = 'CAPTURED', provider_payment_id = $2, failure_reason = NULL WHERE id = $1`,
    [paymentId, providerPaymentId]
  );
}

/** payment.failed: only an open order is marked FAILED (a later capture still wins). */
export async function markPaymentFailed(db: Db, orderId: string, providerPaymentId: string | null, reason: string): Promise<number> {
  const r = await db.query(
    `UPDATE payments
        SET status = 'FAILED', failure_reason = left($3, 500),
            provider_payment_id = COALESCE(provider_payment_id, $2)
      WHERE provider_order_id = $1 AND status = 'CREATED'
        AND ($2::text IS NULL OR NOT EXISTS (SELECT 1 FROM payments o WHERE o.provider_payment_id = $2))`,
    [orderId, providerPaymentId, reason]
  );
  return r.rowCount ?? 0;
}

// ---------------------------------------------------------------- refunds

export async function insertRefund(
  client: PoolClient,
  r: { paymentId: string; bookingId: string; amountPaise: number; reason: 'EVENT_CANCELLED' | 'HOLD_EXPIRED' }
): Promise<boolean> {
  const res = await client.query(
    `INSERT INTO refunds (payment_id, booking_id, amount_paise, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (payment_id) DO NOTHING`,
    [r.paymentId, r.bookingId, r.amountPaise, r.reason]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Event cancellation (and the worker's safety net): every REFUND_PENDING booking with
 * a CAPTURED Razorpay payment and no refund row yet gets one. Set-based, idempotent.
 */
export async function createEventCancelledRefunds(db: Db, eventId: string | null): Promise<number> {
  const r = await db.query(
    `INSERT INTO refunds (payment_id, booking_id, amount_paise, reason)
     SELECT p.id, b.id, p.amount_paise,
            CASE WHEN e.status = 'CANCELLED' OR s.status = 'CANCELLED' THEN 'EVENT_CANCELLED'::refund_reason ELSE 'HOLD_EXPIRED'::refund_reason END
       FROM bookings b
       JOIN payments p ON p.booking_id = b.id AND p.status = 'CAPTURED' AND p.provider = 'razorpay'
       JOIN shows s ON s.id = b.show_id
       JOIN events e ON e.id = s.event_id
      WHERE b.status = 'REFUND_PENDING'
        AND ($1::uuid IS NULL OR e.id = $1)
        AND NOT EXISTS (SELECT 1 FROM refunds x WHERE x.payment_id = p.id)
     ON CONFLICT (payment_id) DO NOTHING`,
    [eventId]
  );
  return r.rowCount ?? 0;
}

export interface DueRefundRow {
  id: string;
  payment_id: string;
  booking_id: string;
  amount_paise: string;
  reason: 'EVENT_CANCELLED' | 'HOLD_EXPIRED';
  attempts: number;
  provider_payment_id: string;
}

/**
 * Claims up to `limit` due refunds: SKIP LOCKED so two sweepers take disjoint rows,
 * and next_attempt_at is pushed out as a lease so nobody re-claims a refund while
 * its provider call is in flight. Short transaction; the provider call happens after.
 */
export async function claimDueRefunds(client: PoolClient, limit: number, leaseSeconds: number): Promise<DueRefundRow[]> {
  const r = await client.query<DueRefundRow>(
    `WITH due AS (
       SELECT id FROM refunds
        WHERE status = 'PENDING' AND next_attempt_at <= now()
        ORDER BY next_attempt_at, id
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE refunds f SET next_attempt_at = now() + make_interval(secs => $2)
       FROM due, payments p
      WHERE f.id = due.id AND p.id = f.payment_id
     RETURNING f.id, f.payment_id, f.booking_id, f.amount_paise, f.reason, f.attempts, p.provider_payment_id`,
    [limit, leaseSeconds]
  );
  return r.rows;
}

/** Booking -> refund -> seats, in hierarchy order. Returns false if the refund was no longer PENDING. */
export async function completeRefund(client: PoolClient, refund: { id: string; booking_id: string; reason: string }, providerRefundId: string): Promise<boolean> {
  await client.query(`SELECT id FROM bookings WHERE id = $1 FOR UPDATE`, [refund.booking_id]);
  const r = await client.query(
    `UPDATE refunds SET status = 'PROCESSED', provider_refund_id = $2, processed_at = now(), last_error = NULL
      WHERE id = $1 AND status = 'PENDING'`,
    [refund.id, providerRefundId]
  );
  if ((r.rowCount ?? 0) === 0) return false;
  await client.query(`UPDATE bookings SET status = 'REFUNDED' WHERE id = $1 AND status = 'REFUND_PENDING'`, [refund.booking_id]);
  // A refunded booking holds no seats: void its tickets and free its BOOKED seats
  // (event cancellations; a HOLD_EXPIRED booking never had any).
  const seats = await client.query<{ id: string }>(
    `SELECT id FROM show_seats WHERE booking_id = $1 ORDER BY id FOR UPDATE`,
    [refund.booking_id]
  );
  if (seats.rows.length > 0) {
    await client.query(`UPDATE booking_seats SET released_at = now() WHERE booking_id = $1 AND released_at IS NULL`, [refund.booking_id]);
    await client.query(
      `UPDATE show_seats SET status = 'AVAILABLE', booking_id = NULL WHERE booking_id = $1`,
      [refund.booking_id]
    );
  }
  return true;
}

export async function recordRefundFailure(db: Db, refundId: string, error: string, maxAttempts: number, backoffSeconds: number): Promise<{ attempts: number; failed: boolean }> {
  const r = await db.query<{ attempts: number; status: string }>(
    `UPDATE refunds
        SET attempts = attempts + 1,
            last_error = left($2, 500),
            status = CASE WHEN attempts + 1 >= $3 THEN 'FAILED'::refund_status ELSE status END,
            next_attempt_at = now() + make_interval(secs => $4)
      WHERE id = $1 AND status = 'PENDING'
      RETURNING attempts, status`,
    [refundId, error, maxAttempts, backoffSeconds]
  );
  const row = r.rows[0];
  return { attempts: row?.attempts ?? 0, failed: row?.status === 'FAILED' };
}

// ---------------------------------------------------------------- webhook events

export async function insertWebhookEvent(db: Db, e: { eventId: string; eventType: string; payload: unknown }): Promise<string | null> {
  const r = await db.query<{ id: string }>(
    // next_attempt_at in the future: the request processes it inline; the worker only
    // picks it up if that failed (or the process died mid-way).
    `INSERT INTO webhook_events (provider, event_id, event_type, payload, next_attempt_at)
     VALUES ('razorpay', $1, $2, $3, now() + interval '60 seconds')
     ON CONFLICT (provider, event_id) DO NOTHING
     RETURNING id`,
    [e.eventId, e.eventType, JSON.stringify(e.payload)]
  );
  return r.rows[0]?.id ?? null;
}

export async function markWebhookProcessed(db: Db, id: string, note: string | null = null): Promise<void> {
  await db.query(`UPDATE webhook_events SET processed_at = now(), last_error = $2 WHERE id = $1`, [id, note]);
}

export async function recordWebhookFailure(db: Db, id: string, error: string, backoffSeconds: number): Promise<void> {
  await db.query(
    `UPDATE webhook_events SET attempts = attempts + 1, last_error = left($2, 500),
            next_attempt_at = now() + make_interval(secs => $3)
      WHERE id = $1`,
    [id, error, backoffSeconds]
  );
}

/** Claims unprocessed webhook events that are due (lease via next_attempt_at, SKIP LOCKED). */
export async function claimDueWebhookEvents(client: PoolClient, limit: number, leaseSeconds: number, maxAttempts: number) {
  const r = await client.query<{ id: string; event_type: string; payload: any; attempts: number }>(
    `WITH due AS (
       SELECT id FROM webhook_events
        WHERE processed_at IS NULL AND next_attempt_at <= now() AND attempts < $3
        ORDER BY next_attempt_at, id
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE webhook_events w SET next_attempt_at = now() + make_interval(secs => $2)
       FROM due WHERE w.id = due.id
     RETURNING w.id, w.event_type, w.payload, w.attempts`,
    [limit, leaseSeconds, maxAttempts]
  );
  return r.rows;
}
