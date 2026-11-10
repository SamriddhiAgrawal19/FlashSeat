/**
 * Razorpay payments (migration 003): create order, verify, webhook, refunds.
 *
 * Razorpay is NEVER called: the payment routes run on an in-process copy of the app
 * (src/app.ts on an ephemeral port) with a fake client and throwaway secrets
 * installed through setPaymentsRuntimeForTests(). Everything else (register, hold,
 * checkout, event cancel) goes through the running API, against the same database.
 */
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { setPaymentsRuntimeForTests } from '../src/modules/payments/payments.runtime';
import { runPaymentJobsOnce } from '../src/modules/payments/payment-jobs.service';
import { FakeRazorpay } from './fakes/fakeRazorpay';
import {
  cancelEvent,
  checkout,
  confirmMock,
  db,
  expireReservation,
  hold,
  invariantViolations,
  register,
  setupShow,
  type User,
} from './helpers';

// Throwaway values, used only by this file. Not the real (or any) Razorpay secrets.
const KEY_ID = 'rzp_test_FAKEKEYID';
const KEY_SECRET = 'fake_key_secret_for_tests_only';
const WEBHOOK_SECRET = 'fake_webhook_secret_for_tests_only';

let fake: FakeRazorpay;
let server: Server;
let base = '';

function install() {
  fake = new FakeRazorpay();
  setPaymentsRuntimeForTests({ provider: 'razorpay', keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, client: fake });
}

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  setPaymentsRuntimeForTests(null);
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => install());

async function local(method: string, path: string, { token, body, headers = {}, raw }: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) {
  const h: Record<string, string> = { ...headers };
  if (body !== undefined || raw !== undefined) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* empty */
  }
  return { status: res.status, data, text };
}

const sign = (orderId: string, paymentId: string, secret = KEY_SECRET) => createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

function webhook(event: string, entity: Record<string, unknown>, { eventId = `evt_${Math.random().toString(36).slice(2)}`, secret = WEBHOOK_SECRET } = {}) {
  const raw = JSON.stringify({ entity: 'event', event, payload: { payment: { entity } }, created_at: Math.floor(Date.now() / 1000) });
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  return { eventId, send: () => local('POST', '/webhooks/razorpay', { raw, headers: { 'X-Razorpay-Signature': signature, 'X-Razorpay-Event-Id': eventId } }) };
}

interface Pending {
  user: User;
  org: User;
  eventId: string;
  reservationId: string;
  bookingId: string;
  total: number;
}

/** A user with a PENDING_PAYMENT booking for 2 seats (₹500 each = 100000 paise). */
async function pendingBooking(tag: string): Promise<Pending> {
  const s = await setupShow(tag, 2);
  const h = await hold(s.user, s.showId, `k-${tag}-${Date.now()}`, s.seatIds);
  expect(h.status).toBe(201);
  const c = await checkout(s.user, h.data.reservation.id);
  expect(c.status).toBe(201);
  return { user: s.user, org: s.org, eventId: s.eventId, reservationId: h.data.reservation.id, bookingId: c.data.booking.id, total: c.data.booking.totalPaise };
}

async function createOrder(p: Pending) {
  const r = await local('POST', `/bookings/${p.bookingId}/payments`, { token: p.user.token });
  expect(r.status).toBe(201);
  return r.data as { keyId: string; orderId: string; amount: number; currency: string; bookingId: string };
}

const bookingRow = async (id: string) => (await db(`SELECT status FROM bookings WHERE id = $1`, [id]))[0];
const liveTickets = async (id: string) =>
  (await db(`SELECT ticket_code FROM booking_seats WHERE booking_id = $1 AND released_at IS NULL ORDER BY ticket_code`, [id])).map((r) => r.ticket_code);
const paymentRows = async (bookingId: string) => db(`SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at`, [bookingId]);
const refundRows = async (bookingId: string) => db(`SELECT * FROM refunds WHERE booking_id = $1`, [bookingId]);

// ====================================================================== create order

describe('POST /bookings/:id/payments', () => {
  it('uses the amount from the database, never the request, and returns only public fields', async () => {
    const p = await pendingBooking('pay_amt');
    const dbTotal = Number((await db(`SELECT total_amount_paise FROM bookings WHERE id = $1`, [p.bookingId]))[0].total_amount_paise);
    const r = await local('POST', `/bookings/${p.bookingId}/payments`, { token: p.user.token, body: { amount: 1, currency: 'USD' } });
    expect(r.status).toBe(201);
    expect(Object.keys(r.data).sort()).toEqual(['amount', 'bookingId', 'currency', 'keyId', 'orderId']);
    expect(r.data).toMatchObject({ keyId: KEY_ID, amount: dbTotal, currency: 'INR', bookingId: p.bookingId });
    expect(dbTotal).toBe(100000);
    expect(r.text).not.toContain(KEY_SECRET);
    const order = fake.orders.get(r.data.orderId)!;
    expect(order).toMatchObject({ amount: dbTotal, currency: 'INR', receipt: p.bookingId, notes: { bookingId: p.bookingId } });
    const rows = await paymentRows(p.bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'CREATED', provider: 'razorpay', provider_order_id: r.data.orderId, amount_paise: String(dbTotal) });
  });

  it('is idempotent: a second call returns the same open order without a new provider call', async () => {
    const p = await pendingBooking('pay_idem');
    const first = await createOrder(p);
    const [a, b] = await Promise.all([
      local('POST', `/bookings/${p.bookingId}/payments`, { token: p.user.token }),
      local('POST', `/bookings/${p.bookingId}/payments`, { token: p.user.token }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.data.orderId).toBe(first.orderId);
    expect(b.data.orderId).toBe(first.orderId);
    expect(fake.calls.createOrder).toBe(1);
    expect(await paymentRows(p.bookingId)).toHaveLength(1);
  });

  it('409 HOLD_TOO_SHORT when less than 2 minutes remain, without calling Razorpay', async () => {
    const p = await pendingBooking('pay_short');
    await db(`UPDATE reservations SET expires_at = now() + interval '90 seconds' WHERE id = $1`, [p.reservationId]);
    await db(`UPDATE show_seats SET held_until = now() + interval '90 seconds' WHERE reservation_id = $1`, [p.reservationId]);
    const r = await local('POST', `/bookings/${p.bookingId}/payments`, { token: p.user.token });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('HOLD_TOO_SHORT');
    expect(r.data.error.message).toBe('Not enough time left to pay; please hold seats again');
    expect(fake.calls.createOrder).toBe(0);
    expect(await paymentRows(p.bookingId)).toHaveLength(0);
  });

  it('404 for somebody else\'s booking (and an unknown one)', async () => {
    const p = await pendingBooking('pay_owner');
    const other = await register('pay_other');
    const r = await local('POST', `/bookings/${p.bookingId}/payments`, { token: other.token });
    expect(r.status).toBe(404);
    const unknown = await local('POST', `/bookings/00000000-0000-4000-8000-000000000000/payments`, { token: p.user.token });
    expect(unknown.status).toBe(404);
    expect(fake.calls.createOrder).toBe(0);
  });

  it('404 Endpoint not available with the mock provider', async () => {
    const p = await pendingBooking('pay_mockprov');
    setPaymentsRuntimeForTests({ provider: 'mock' });
    const r = await local('POST', `/bookings/${p.bookingId}/payments`, { token: p.user.token });
    expect(r.status).toBe(404);
    expect(r.data.error.message).toBe('Endpoint not available');
  });
});

// ====================================================================== verify

describe('POST /payments/razorpay/verify', () => {
  it('good signature -> CONFIRMED with tickets; the payment is CAPTURED', async () => {
    const p = await pendingBooking('ver_ok');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId);
    const r = await local('POST', '/payments/razorpay/verify', {
      token: p.user.token,
      body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId) },
    });
    expect(r.status).toBe(200);
    expect(r.data.booking.status).toBe('CONFIRMED');
    expect(r.data.booking.seats).toHaveLength(2);
    expect(r.data.booking.seats.every((s: any) => typeof s.ticketCode === 'string')).toBe(true);
    const [pay] = await paymentRows(p.bookingId);
    expect(pay).toMatchObject({ status: 'CAPTURED', provider_payment_id: paymentId });
    expect(await invariantViolations()).toEqual([]);
  });

  it('bad signature -> 400 INVALID_SIGNATURE and nothing changes', async () => {
    const p = await pendingBooking('ver_badsig');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId);
    const r = await local('POST', '/payments/razorpay/verify', {
      token: p.user.token,
      body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId, 'wrong-secret') },
    });
    expect(r.status).toBe(400);
    expect(r.data.error.code).toBe('INVALID_SIGNATURE');
    const short = await local('POST', '/payments/razorpay/verify', {
      token: p.user.token,
      body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: 'abc' },
    });
    expect(short.status).toBe(400);
    expect(fake.calls.fetchPayment).toBe(0);
    expect((await bookingRow(p.bookingId)).status).toBe('PENDING_PAYMENT');
    expect((await paymentRows(p.bookingId))[0].status).toBe('CREATED');
    expect(await liveTickets(p.bookingId)).toEqual([]);
  });

  it('amount mismatch -> 409 and nothing is confirmed', async () => {
    const p = await pendingBooking('ver_amt');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId, { amount: 100 });
    const r = await local('POST', '/payments/razorpay/verify', {
      token: p.user.token,
      body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId) },
    });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');
    expect((await bookingRow(p.bookingId)).status).toBe('PENDING_PAYMENT');
    expect((await paymentRows(p.bookingId))[0].status).toBe('CREATED');
  });

  it('authorized (manual capture) payments are captured for the stored amount', async () => {
    const p = await pendingBooking('ver_auth');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId, { status: 'authorized' });
    const r = await local('POST', '/payments/razorpay/verify', {
      token: p.user.token,
      body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId) },
    });
    expect(r.status).toBe(200);
    expect(fake.calls.capturePayment).toBe(1);
  });

  it('verify twice -> same booking, no duplicate tickets', async () => {
    const p = await pendingBooking('ver_twice');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId);
    const body = { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId) };
    const a = await local('POST', '/payments/razorpay/verify', { token: p.user.token, body });
    const b = await local('POST', '/payments/razorpay/verify', { token: p.user.token, body });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.data.booking.id).toBe(a.data.booking.id);
    expect(b.data.booking.seats.map((s: any) => s.ticketCode).sort()).toEqual(a.data.booking.seats.map((s: any) => s.ticketCode).sort());
    expect(await liveTickets(p.bookingId)).toHaveLength(2);
  });

  it('only the booking owner can verify; confirm-mock refuses a booking paid through Razorpay', async () => {
    const p = await pendingBooking('ver_owner');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId);
    const other = await register('ver_other');
    const r = await local('POST', '/payments/razorpay/verify', {
      token: other.token,
      body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId) },
    });
    expect(r.status).toBe(404);
    const mock = await confirmMock(p.user, p.bookingId);
    // 409 when the mock endpoint is enabled on the running API, 404 when it is disabled.
    expect([409, 404]).toContain(mock.status);
    if (mock.status === 409) expect(mock.data.error.code).toBe('PAYMENT_PROVIDER_IN_USE');
    expect(await liveTickets(p.bookingId)).toEqual([]);
  });
});

// ====================================================================== webhook

describe('POST /webhooks/razorpay', () => {
  const captured = (orderId: string, paymentId: string, amount: number) => ({ id: paymentId, order_id: orderId, amount, currency: 'INR', status: 'captured' });

  it('bad signature -> 400 and the event is not recorded', async () => {
    const p = await pendingBooking('wh_badsig');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId);
    const w = webhook('payment.captured', captured(o.orderId, paymentId, o.amount), { secret: 'not-the-webhook-secret' });
    const r = await w.send();
    expect(r.status).toBe(400);
    expect(await db(`SELECT 1 FROM webhook_events WHERE event_id = $1`, [w.eventId])).toHaveLength(0);
    expect((await bookingRow(p.bookingId)).status).toBe('PENDING_PAYMENT');
  });

  it('the same event id twice is processed once', async () => {
    const p = await pendingBooking('wh_dupe');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId);
    const w = webhook('payment.captured', captured(o.orderId, paymentId, o.amount));
    const first = await w.send();
    const second = await w.send();
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.data.status).toBe('ok');
    expect(second.data.status).toBe('duplicate');
    const rows = await db(`SELECT processed_at, last_error FROM webhook_events WHERE event_id = $1`, [w.eventId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].processed_at).not.toBeNull();
    expect(rows[0].last_error).toBe('confirmed');
    expect((await bookingRow(p.bookingId)).status).toBe('CONFIRMED');
    expect(await liveTickets(p.bookingId)).toHaveLength(2);
  });

  it('payment.captured after verify already confirmed -> no-op', async () => {
    const p = await pendingBooking('wh_after');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId);
    const v = await local('POST', '/payments/razorpay/verify', {
      token: p.user.token,
      body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId) },
    });
    expect(v.status).toBe(200);
    const before = await liveTickets(p.bookingId);
    const w = webhook('payment.captured', captured(o.orderId, paymentId, o.amount));
    expect((await w.send()).status).toBe(200);
    expect((await db(`SELECT last_error FROM webhook_events WHERE event_id = $1`, [w.eventId]))[0].last_error).toBe('already confirmed');
    expect(await liveTickets(p.bookingId)).toEqual(before);
  });

  it('verify and webhook at the same time -> exactly one confirmation and one ticket set', async () => {
    for (let i = 0; i < 3; i++) {
      const p = await pendingBooking(`wh_race${i}`);
      const o = await createOrder(p);
      const paymentId = fake.pay(o.orderId);
      const w = webhook('payment.captured', captured(o.orderId, paymentId, o.amount));
      const [v, h] = await Promise.all([
        local('POST', '/payments/razorpay/verify', {
          token: p.user.token,
          body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId) },
        }),
        w.send(),
      ]);
      expect(v.status).toBe(200);
      expect(h.status).toBe(200);
      expect((await bookingRow(p.bookingId)).status).toBe('CONFIRMED');
      expect(await db(`SELECT id FROM booking_seats WHERE booking_id = $1`, [p.bookingId])).toHaveLength(2);
      expect((await paymentRows(p.bookingId)).filter((x) => x.status === 'CAPTURED')).toHaveLength(1);
    }
    expect(await invariantViolations()).toEqual([]);
  });

  it('payment.failed marks the payment FAILED; the booking stays payable and a new order can be made', async () => {
    const p = await pendingBooking('wh_failed');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId, { status: 'failed' });
    const w = webhook('payment.failed', { id: paymentId, order_id: o.orderId, amount: o.amount, status: 'failed', error_description: 'Card declined (test)' });
    expect((await w.send()).status).toBe(200);
    const [pay] = await paymentRows(p.bookingId);
    expect(pay).toMatchObject({ status: 'FAILED', failure_reason: 'Card declined (test)' });
    expect((await bookingRow(p.bookingId)).status).toBe('PENDING_PAYMENT');
    const again = await local('POST', `/bookings/${p.bookingId}/payments`, { token: p.user.token });
    expect(again.status).toBe(201);
    expect(again.data.orderId).not.toBe(o.orderId);
  });
});

// ====================================================================== refunds

describe('refunds', () => {
  it('hold expired before capture -> REFUND_PENDING + refunds row; worker -> REFUNDED; one provider refund even if run twice', async () => {
    const p = await pendingBooking('rf_expired');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId);
    await expireReservation(p.reservationId);

    const r = await local('POST', '/payments/razorpay/verify', {
      token: p.user.token,
      body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId) },
    });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('PAYMENT_CAPTURED_SEATS_UNAVAILABLE');
    expect(r.data.error.details).toMatchObject({ bookingId: p.bookingId, refund: 'PENDING' });
    expect((await bookingRow(p.bookingId)).status).toBe('REFUND_PENDING');
    expect(await liveTickets(p.bookingId)).toEqual([]);
    const [refund] = await refundRows(p.bookingId);
    expect(refund).toMatchObject({ status: 'PENDING', reason: 'HOLD_EXPIRED', amount_paise: String(o.amount) });

    // The same capture arriving again (webhook) changes nothing.
    const w = webhook('payment.captured', { id: paymentId, order_id: o.orderId, amount: o.amount, currency: 'INR', status: 'captured' });
    expect((await w.send()).status).toBe(200);
    expect(await refundRows(p.bookingId)).toHaveLength(1);

    // Two workers at once, then a third run: one provider refund.
    await Promise.all([runPaymentJobsOnce(), runPaymentJobsOnce()]);
    await runPaymentJobsOnce();
    expect(fake.refundsFor(paymentId)).toHaveLength(1);
    const [done] = await refundRows(p.bookingId);
    expect(done).toMatchObject({ status: 'PROCESSED', provider_refund_id: fake.refundsFor(paymentId)[0].id });
    expect((await bookingRow(p.bookingId)).status).toBe('REFUNDED');
    expect(await invariantViolations()).toEqual([]);
  });

  it('event cancelled after a Razorpay payment -> refund created with the cancel, then paid out', async () => {
    const p = await pendingBooking('rf_cancel');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId);
    const v = await local('POST', '/payments/razorpay/verify', {
      token: p.user.token,
      body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId) },
    });
    expect(v.status).toBe(200);

    expect((await cancelEvent(p.org, p.eventId)).status).toBe(200);
    expect((await bookingRow(p.bookingId)).status).toBe('REFUND_PENDING');
    const [refund] = await refundRows(p.bookingId);
    expect(refund).toMatchObject({ status: 'PENDING', reason: 'EVENT_CANCELLED', amount_paise: String(o.amount) });

    await runPaymentJobsOnce();
    expect(fake.refundsFor(paymentId)).toHaveLength(1);
    expect((await refundRows(p.bookingId))[0].status).toBe('PROCESSED');
    expect((await bookingRow(p.bookingId)).status).toBe('REFUNDED');
    expect(await liveTickets(p.bookingId)).toEqual([]);
    expect(await db(`SELECT id FROM show_seats WHERE booking_id = $1`, [p.bookingId])).toHaveLength(0);
    expect(await invariantViolations()).toEqual([]);
  });

  it('provider errors back off and the refund is marked FAILED after 5 attempts (no secrets in last_error)', async () => {
    const p = await pendingBooking('rf_fail');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId);
    await expireReservation(p.reservationId);
    const r = await local('POST', '/payments/razorpay/verify', {
      token: p.user.token,
      body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId) },
    });
    expect(r.status).toBe(409);
    fake.failRefunds = 100;

    for (let i = 1; i <= 5; i++) {
      await runPaymentJobsOnce();
      const [row] = await refundRows(p.bookingId);
      expect(row.attempts).toBe(i);
      expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
      await db(`UPDATE refunds SET next_attempt_at = now() WHERE id = $1`, [row.id]); // skip the backoff wait
    }
    const [row] = await refundRows(p.bookingId);
    expect(row.status).toBe('FAILED');
    expect(row.last_error).toContain('refund temporarily unavailable');
    expect(row.last_error).not.toContain(KEY_SECRET);
    await runPaymentJobsOnce();
    expect((await refundRows(p.bookingId))[0].attempts).toBe(5); // FAILED is final
    expect(fake.refundsFor(paymentId)).toHaveLength(0);
    expect((await bookingRow(p.bookingId)).status).toBe('REFUND_PENDING');
  });

  it('mock-paid bookings of a cancelled event stay REFUND_PENDING with no provider call', async () => {
    const s = await setupShow('rf_mock', 1);
    const h = await hold(s.user, s.showId, `k-rfmock-${Date.now()}`, s.seatIds);
    const c = await checkout(s.user, h.data.reservation.id);
    const m = await confirmMock(s.user, c.data.booking.id);
    if (m.status !== 200) return; // mock payments disabled on the running API: nothing to check
    expect((await cancelEvent(s.org, s.eventId)).status).toBe(200);
    await runPaymentJobsOnce();
    expect((await bookingRow(c.data.booking.id)).status).toBe('REFUND_PENDING');
    expect(await refundRows(c.data.booking.id)).toHaveLength(0);
  });
});

// ====================================================================== booking reads

describe('GET /bookings/:id and /bookings/mine: payment and refund', () => {
  const read = async (p: Pending) => {
    const one = await local('GET', `/bookings/${p.bookingId}`, { token: p.user.token });
    expect(one.status).toBe(200);
    const mine = await local('GET', '/bookings/mine', { token: p.user.token });
    expect(mine.status).toBe(200);
    const listed = mine.data.bookings.find((b: any) => b.id === p.bookingId);
    expect(listed).toBeTruthy();
    return { one: one.data.booking, listed };
  };

  it('null payment and refund before any order', async () => {
    const p = await pendingBooking('rd_none');
    const { one, listed } = await read(p);
    for (const b of [one, listed]) expect(b).toMatchObject({ payment: null, refund: null });
  });

  it('latest payment: CREATED after an order, CAPTURED after verify; refund stays null', async () => {
    const p = await pendingBooking('rd_paid');
    const o = await createOrder(p);
    expect((await read(p)).one.payment).toEqual({ provider: 'razorpay', status: 'CREATED' });
    const paymentId = fake.pay(o.orderId);
    const v = await local('POST', '/payments/razorpay/verify', {
      token: p.user.token,
      body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId) },
    });
    expect(v.status).toBe(200);
    const { one, listed } = await read(p);
    for (const b of [one, listed]) expect(b).toMatchObject({ status: 'CONFIRMED', payment: { provider: 'razorpay', status: 'CAPTURED' }, refund: null });
  });

  it('after a failed order and a new one, the latest (CREATED) payment is reported', async () => {
    const p = await pendingBooking('rd_latest');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId, { status: 'failed' });
    const w = webhook('payment.failed', { id: paymentId, order_id: o.orderId, amount: o.amount, status: 'failed', error_description: 'declined' });
    expect((await w.send()).status).toBe(200);
    expect((await read(p)).one.payment).toEqual({ provider: 'razorpay', status: 'FAILED' });
    expect((await local('POST', `/bookings/${p.bookingId}/payments`, { token: p.user.token })).status).toBe(201);
    expect((await read(p)).one.payment).toEqual({ provider: 'razorpay', status: 'CREATED' });
  });

  it('refund: HOLD_EXPIRED pending, then processed', async () => {
    const p = await pendingBooking('rd_rf_exp');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId);
    await expireReservation(p.reservationId);
    const r = await local('POST', '/payments/razorpay/verify', {
      token: p.user.token,
      body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId) },
    });
    expect(r.status).toBe(409);
    let { one, listed } = await read(p);
    for (const b of [one, listed]) expect(b).toMatchObject({ status: 'REFUND_PENDING', payment: { provider: 'razorpay', status: 'CAPTURED' }, refund: { status: 'PENDING', reason: 'HOLD_EXPIRED' } });
    await runPaymentJobsOnce();
    ({ one, listed } = await read(p));
    for (const b of [one, listed]) expect(b).toMatchObject({ status: 'REFUNDED', refund: { status: 'PROCESSED', reason: 'HOLD_EXPIRED' } });
  });

  it('refund: EVENT_CANCELLED', async () => {
    const p = await pendingBooking('rd_rf_cancel');
    const o = await createOrder(p);
    const paymentId = fake.pay(o.orderId);
    const v = await local('POST', '/payments/razorpay/verify', {
      token: p.user.token,
      body: { razorpay_order_id: o.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(o.orderId, paymentId) },
    });
    expect(v.status).toBe(200);
    expect((await cancelEvent(p.org, p.eventId)).status).toBe(200);
    const { one, listed } = await read(p);
    for (const b of [one, listed]) expect(b).toMatchObject({ status: 'REFUND_PENDING', refund: { status: 'PENDING', reason: 'EVENT_CANCELLED' } });
  });

  it('mock-paid booking: payment and refund are null', async () => {
    const s = await setupShow('rd_mock', 1);
    const h = await hold(s.user, s.showId, `k-rdmock-${Date.now()}`, s.seatIds);
    const c = await checkout(s.user, h.data.reservation.id);
    const m = await confirmMock(s.user, c.data.booking.id);
    if (m.status !== 200) return; // mock payments disabled on the running API
    const r = await local('GET', `/bookings/${c.data.booking.id}`, { token: s.user.token });
    expect(r.data.booking).toMatchObject({ status: 'CONFIRMED', payment: null, refund: null });
  });
});
