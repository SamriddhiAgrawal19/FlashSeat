/**
 * In-memory stand-in for Razorpay (PaymentProviderClient). No network, ever.
 * Tests drive it: create orders through the API, then fake.pay(orderId) plays the
 * customer completing Checkout.
 */
import {
  PaymentProviderError,
  type PaymentProviderClient,
  type ProviderOrder,
  type ProviderPayment,
  type ProviderRefund,
} from '../../src/modules/payments/razorpay.client';

export class FakeRazorpay implements PaymentProviderClient {
  orders = new Map<string, ProviderOrder & { receipt: string; notes: Record<string, string> }>();
  payments = new Map<string, ProviderPayment>();
  refunds: ProviderRefund[] = [];
  calls = { createOrder: 0, fetchPayment: 0, capturePayment: 0, createRefund: 0, listRefunds: 0 };
  /** When set, createRefund throws this many more times. */
  failRefunds = 0;
  private seq = 0;

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}_FAKE${Date.now().toString(36)}${this.seq}`;
  }

  async createOrder(input: { amountPaise: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<ProviderOrder> {
    this.calls.createOrder++;
    const order = { id: this.id('order'), amount: input.amountPaise, currency: input.currency, status: 'created', receipt: input.receipt, notes: input.notes };
    this.orders.set(order.id, order);
    return { id: order.id, amount: order.amount, currency: order.currency, status: order.status };
  }

  /** The customer pays: a payment on the order (captured by default; amount defaults to the order's). */
  pay(orderId: string, { amount, status = 'captured' }: { amount?: number; status?: string } = {}): string {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`fake: unknown order ${orderId}`);
    const payment: ProviderPayment = { id: this.id('pay'), order_id: orderId, amount: amount ?? order.amount, currency: order.currency, status };
    this.payments.set(payment.id, payment);
    return payment.id;
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    this.calls.fetchPayment++;
    const p = this.payments.get(paymentId);
    if (!p) throw new PaymentProviderError('The id provided does not exist', 400, 'BAD_REQUEST_ERROR');
    return { ...p };
  }

  async capturePayment(paymentId: string): Promise<ProviderPayment> {
    this.calls.capturePayment++;
    const p = this.payments.get(paymentId);
    if (!p) throw new PaymentProviderError('The id provided does not exist', 400, 'BAD_REQUEST_ERROR');
    p.status = 'captured';
    return { ...p };
  }

  async createRefund(paymentId: string, input: { amountPaise: number; receipt: string }): Promise<ProviderRefund> {
    this.calls.createRefund++;
    if (this.failRefunds > 0) {
      this.failRefunds--;
      throw new PaymentProviderError('fake: refund temporarily unavailable', 503, 'SERVER_ERROR');
    }
    const refunded = this.refunds.filter((r) => r.payment_id === paymentId).reduce((n, r) => n + r.amount, 0);
    const payment = this.payments.get(paymentId);
    if (!payment || refunded + input.amountPaise > payment.amount) {
      throw new PaymentProviderError('The refund amount provided is greater than amount captured', 400, 'BAD_REQUEST_ERROR');
    }
    const refund: ProviderRefund = { id: this.id('rfnd'), payment_id: paymentId, amount: input.amountPaise, status: 'processed', receipt: input.receipt };
    this.refunds.push(refund);
    return { ...refund };
  }

  async listRefunds(paymentId: string): Promise<ProviderRefund[]> {
    this.calls.listRefunds++;
    return this.refunds.filter((r) => r.payment_id === paymentId).map((r) => ({ ...r }));
  }

  refundsFor(paymentId: string): ProviderRefund[] {
    return this.refunds.filter((r) => r.payment_id === paymentId);
  }
}
