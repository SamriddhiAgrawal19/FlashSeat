/**
 * Payment background jobs, run by the sweeper process after each sweep:
 *   1. discover REFUND_PENDING bookings with a CAPTURED Razorpay payment and no refund
 *      row yet (safety net; cancelEvent creates them in its own transaction),
 *   2. retry webhook events whose processing failed,
 *   3. pay out PENDING refunds.
 *
 * Short transactions only, SKIP LOCKED claims (like the sweeper), and no database
 * lock is held during a provider call. Never refunds a payment twice: one refunds
 * row per payment (UNIQUE), the PENDING -> PROCESSED transition is conditional, and
 * before creating a provider refund the worker looks for one it already made
 * (receipt = refund row id) in case an earlier attempt succeeded but wasn't recorded.
 */
import pino from 'pino';
import { env } from '../../config/env';
import { pool, withTransaction } from '../../db/pool';
import * as repo from './payments.repository';
import { getPaymentsRuntime } from './payments.runtime';
import { processWebhookEvent } from './payments.service';
import { PaymentProviderError } from './razorpay.client';

const logger = pino({ name: 'payment-jobs' });

/** A claimed row is invisible to other workers for this long (provider call in flight). */
const LEASE_SECONDS = 120;
const WEBHOOK_MAX_ATTEMPTS = 10;

/** 30 s, 60 s, 2 min, 4 min, ... capped at 1 h. */
export function backoffSeconds(attempts: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));
}

export interface PaymentJobsResult {
  refundsDiscovered: number;
  refundsProcessed: number;
  refundsFailedAttempts: number;
  refundsGivenUp: number;
  webhooksRetried: number;
  skipped?: 'mock-provider';
}

const describe = (err: unknown) => (err instanceof PaymentProviderError ? err.message : err instanceof Error ? err.message : String(err));

export async function runPaymentJobsOnce(opts: { batchSize?: number } = {}): Promise<PaymentJobsResult> {
  const out: PaymentJobsResult = { refundsDiscovered: 0, refundsProcessed: 0, refundsFailedAttempts: 0, refundsGivenUp: 0, webhooksRetried: 0 };
  const rt = getPaymentsRuntime();
  if (rt.provider !== 'razorpay') return { ...out, skipped: 'mock-provider' };
  const batch = opts.batchSize ?? env.PAYMENT_JOBS_BATCH_SIZE;

  // 1. Discovery (idempotent INSERT ... ON CONFLICT DO NOTHING).
  out.refundsDiscovered = await repo.createEventCancelledRefunds(pool, null);

  // 2. Webhook retries.
  const events = await withTransaction((c) => repo.claimDueWebhookEvents(c, batch, LEASE_SECONDS, WEBHOOK_MAX_ATTEMPTS));
  for (const ev of events) {
    try {
      const note = await processWebhookEvent(ev.event_type, ev.payload);
      await repo.markWebhookProcessed(pool, ev.id, note);
      out.webhooksRetried++;
    } catch (err) {
      await repo.recordWebhookFailure(pool, ev.id, describe(err), backoffSeconds(ev.attempts + 1));
      logger.error({ webhookEventId: ev.id, err: describe(err) }, 'Webhook retry failed');
    }
  }

  // 3. Refunds.
  const due = await withTransaction((c) => repo.claimDueRefunds(c, batch, LEASE_SECONDS));
  for (const refund of due) {
    const amountPaise = Number(refund.amount_paise);
    try {
      // An earlier attempt may have created the refund and then failed to record it.
      const existing = (await rt.client.listRefunds(refund.provider_payment_id)).find((r) => r.receipt === refund.id);
      const providerRefund =
        existing ??
        (await rt.client.createRefund(refund.provider_payment_id, {
          amountPaise,
          receipt: refund.id,
          notes: { bookingId: refund.booking_id, reason: refund.reason },
        }));
      const done = await withTransaction((c) => repo.completeRefund(c, refund, providerRefund.id));
      if (done) {
        out.refundsProcessed++;
        logger.info({ refundId: refund.id, bookingId: refund.booking_id, reason: refund.reason }, 'Refund processed');
      }
    } catch (err) {
      const r = await repo.recordRefundFailure(pool, refund.id, describe(err), env.REFUND_MAX_ATTEMPTS, backoffSeconds(refund.attempts + 1));
      out.refundsFailedAttempts++;
      if (r.failed) {
        out.refundsGivenUp++;
        logger.error({ refundId: refund.id, bookingId: refund.booking_id, attempts: r.attempts }, 'Refund FAILED after max attempts: needs manual action');
      } else {
        logger.warn({ refundId: refund.id, attempts: r.attempts, err: describe(err) }, 'Refund attempt failed; will retry');
      }
    }
  }

  return out;
}
