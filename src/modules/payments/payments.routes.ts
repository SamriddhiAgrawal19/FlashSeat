import express, { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { admissionGate } from '../../middleware/admissionControl';
import * as controller from './payments.controller';

/** JSON routes (mounted after express.json). */
export const paymentsRouter = Router();

// Create (or replay) the Razorpay order for a PENDING_PAYMENT booking. Owner only.
paymentsRouter.post('/bookings/:bookingId/payments', requireAuth, admissionGate, controller.createOrder);

// Razorpay Checkout callback: signature + captured payment -> tickets.
paymentsRouter.post('/payments/razorpay/verify', requireAuth, admissionGate, controller.verify);

/**
 * The webhook needs the RAW body for its signature, so app.ts mounts this router
 * BEFORE express.json. No auth, no rate limiter, no admission gate: dropping a
 * Razorpay delivery would only make it retry later.
 */
export const webhookRouter = Router();
webhookRouter.post('/webhooks/razorpay', express.raw({ type: () => true, limit: '1mb' }), controller.webhook);
