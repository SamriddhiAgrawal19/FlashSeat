/**
 * The payment provider configuration the API and the sweeper actually use. Built
 * once from env (src/config/env.ts) on first use. Tests replace it with
 * setPaymentsRuntimeForTests() (a fake client and throwaway secrets), so they never
 * depend on PAYMENT_PROVIDER or the RAZORPAY_* values in .env.
 *
 * The secrets live only in this object. Never log it.
 */
import { env } from '../../config/env';
import { NotFoundError } from '../../utils/errors';
import { createRazorpayHttpClient, type PaymentProviderClient } from './razorpay.client';

export interface RazorpayRuntime {
  provider: 'razorpay';
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  client: PaymentProviderClient;
}

export type PaymentsRuntime = { provider: 'mock' } | RazorpayRuntime;

let runtime: PaymentsRuntime | null = null;

function fromEnv(): PaymentsRuntime {
  if (env.PAYMENT_PROVIDER !== 'razorpay') return { provider: 'mock' };
  // env.ts has already failed fast if any of these is missing.
  const keyId = env.RAZORPAY_KEY_ID!;
  const keySecret = env.RAZORPAY_KEY_SECRET!;
  return {
    provider: 'razorpay',
    keyId,
    keySecret,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET!,
    client: createRazorpayHttpClient(keyId, keySecret),
  };
}

export function getPaymentsRuntime(): PaymentsRuntime {
  if (!runtime) runtime = fromEnv();
  return runtime;
}

/** The Razorpay runtime, or 404 "Endpoint not available" when the provider is mock. */
export function requireRazorpay(): RazorpayRuntime {
  const rt = getPaymentsRuntime();
  if (rt.provider !== 'razorpay') throw new NotFoundError('Endpoint not available');
  return rt;
}

/** TEST ONLY: swap the provider (fake client, fake secrets). Pass null to go back to env. */
export function setPaymentsRuntimeForTests(next: PaymentsRuntime | null): void {
  runtime = next;
}
