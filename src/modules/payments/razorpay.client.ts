/**
 * Razorpay behind a small interface. The HTTP implementation talks to
 * https://api.razorpay.com/v1 with Basic auth (key id : key secret). Tests inject a
 * fake (tests/fakes/fakeRazorpay.ts) and never touch the network.
 *
 * Nothing here logs or returns the key secret: errors carry Razorpay's own error
 * code/description and the HTTP status only.
 */

export interface ProviderOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface ProviderPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  /** created | authorized | captured | refunded | failed */
  status: string;
  error_description?: string | null;
}

export interface ProviderRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
  receipt?: string | null;
}

export interface PaymentProviderClient {
  createOrder(input: { amountPaise: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<ProviderOrder>;
  fetchPayment(paymentId: string): Promise<ProviderPayment>;
  capturePayment(paymentId: string, amountPaise: number, currency: string): Promise<ProviderPayment>;
  createRefund(paymentId: string, input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<ProviderRefund>;
  listRefunds(paymentId: string): Promise<ProviderRefund[]>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number | null,
    public readonly providerCode: string | null
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

const BASE_URL = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 10_000;

export function createRazorpayHttpClient(keyId: string, keySecret: string): PaymentProviderClient {
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: { Authorization: auth, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err: any) {
      throw new PaymentProviderError(`Razorpay request failed: ${err?.name ?? 'network error'}`, null, null);
    }
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      const code = data?.error?.code ?? null;
      const description = data?.error?.description ?? `HTTP ${res.status}`;
      throw new PaymentProviderError(`Razorpay ${method} ${path.split('/')[1]}: ${description}`, res.status, code);
    }
    return data as T;
  }

  return {
    createOrder: ({ amountPaise, currency, receipt, notes }) =>
      call<ProviderOrder>('POST', '/orders', { amount: amountPaise, currency, receipt, notes }),
    fetchPayment: (paymentId) => call<ProviderPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`),
    capturePayment: (paymentId, amountPaise, currency) =>
      call<ProviderPayment>('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency }),
    createRefund: (paymentId, { amountPaise, receipt, notes }) =>
      call<ProviderRefund>('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, receipt, notes, speed: 'normal' }),
    listRefunds: async (paymentId) =>
      (await call<{ items: ProviderRefund[] }>('GET', `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`)).items ?? [],
  };
}
