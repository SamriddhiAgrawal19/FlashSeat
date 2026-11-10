import { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { bookingIdParamSchema } from '../bookings/bookings.schema';
import { ValidationError } from '../../utils/errors';
import * as service from './payments.service';
import * as repo from './payments.repository';
import { pool } from '../../db/pool';
import { requireRazorpay } from './payments.runtime';
import { isValidWebhookSignature } from './payments.signature';
import { verifyBodySchema } from './payments.schema';
import { backoffSeconds } from './payment-jobs.service';

const logger = pino({ name: 'payments-controller' });

export async function createOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const { order, replayed } = await service.createPaymentOrder(req.user!.userId, bookingId);
    res.status(replayed ? 200 : 201).json(order);
  } catch (err) {
    next(err);
  }
}

export async function verify(req: Request, res: Response, next: NextFunction) {
  try {
    const body = verifyBodySchema.parse(req.body);
    const { booking } = await service.verifyCheckout(req.user!.userId, body);
    res.status(200).json({ booking });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /webhooks/razorpay. req.body is the RAW Buffer (express.raw on this route only).
 * Valid + recorded => 200, even if processing fails afterwards (the worker retries).
 */
export async function webhook(req: Request, res: Response, next: NextFunction) {
  try {
    const rt = requireRazorpay();
    const raw: unknown = req.body;
    const signature = req.get('x-razorpay-signature') ?? '';
    if (!Buffer.isBuffer(raw) || raw.length === 0 || !isValidWebhookSignature(raw, signature, rt.webhookSecret)) {
      logger.warn({ hasSignature: signature !== '' }, 'Rejected webhook: invalid signature');
      throw new ValidationError('Invalid webhook signature', 'INVALID_SIGNATURE');
    }
    let payload: any;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new ValidationError('Webhook body is not JSON', 'VALIDATION_ERROR');
    }
    const eventId = req.get('x-razorpay-event-id');
    const eventType = typeof payload?.event === 'string' ? payload.event : '';
    if (!eventId || !eventType) throw new ValidationError('Missing event id or type', 'VALIDATION_ERROR');

    const recordId = await repo.insertWebhookEvent(pool, { eventId, eventType, payload });
    if (!recordId) {
      res.status(200).json({ status: 'duplicate' });
      return;
    }

    try {
      const note = await service.processWebhookEvent(eventType, payload);
      await repo.markWebhookProcessed(pool, recordId, note);
    } catch (err: any) {
      logger.error({ webhookEventId: recordId, eventType, err: err?.message ?? String(err) }, 'Webhook processing failed; the worker will retry');
      await repo.recordWebhookFailure(pool, recordId, err?.message ?? String(err), backoffSeconds(1)).catch(() => {});
    }
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
}
