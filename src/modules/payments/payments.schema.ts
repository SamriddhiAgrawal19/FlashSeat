import { z } from 'zod';

const providerId = (name: string) => z.string().trim().min(1, `${name} is required`).max(100);

export const verifyBodySchema = z.object({
  razorpay_order_id: providerId('razorpay_order_id'),
  razorpay_payment_id: providerId('razorpay_payment_id'),
  razorpay_signature: providerId('razorpay_signature'),
});
