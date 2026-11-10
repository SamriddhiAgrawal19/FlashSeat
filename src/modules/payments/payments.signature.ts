import { createHmac, timingSafeEqual } from 'node:crypto';

/** Constant-time comparison of two hex signatures; false (never throws) when lengths differ. */
function safeEqualHex(expectedHex: string, receivedHex: string): boolean {
  if (typeof receivedHex !== 'string' || !/^[0-9a-f]+$/i.test(receivedHex)) return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(receivedHex.toLowerCase(), 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key secret). */
export function isValidCheckoutSignature(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  const expected = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Webhook signature: HMAC_SHA256(raw request body, webhook secret). */
export function isValidWebhookSignature(rawBody: Buffer, signature: string, webhookSecret: string): boolean {
  const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}
