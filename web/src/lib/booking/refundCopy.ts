import type { Booking } from '../api';

export interface RefundCopy {
  title: string;
  body: string;
}

const DONE = 'has been refunded.';
const PENDING = 'Your refund is being processed.';

/**
 * Text for REFUND_PENDING / REFUNDED bookings, from refund.reason. Mock-paid bookings have no
 * refund row: they keep the original "event was cancelled" text.
 */
export function refundCopy(booking: Booking): RefundCopy | null {
  if (booking.status !== 'REFUND_PENDING' && booking.status !== 'REFUNDED') return null;
  const done = booking.status === 'REFUNDED';
  if (booking.refund?.reason === 'HOLD_EXPIRED') {
    return {
      title: done
        ? "Your payment arrived after your hold ended, so the seats weren't confirmed. Your payment " + DONE
        : "Your payment arrived after your hold ended, so the seats weren't confirmed. " + PENDING,
      body: 'No tickets were issued.',
    };
  }
  return {
    title: done ? 'This event was cancelled. Your payment ' + DONE : 'This event was cancelled. ' + PENDING,
    body: 'These tickets are no longer valid.',
  };
}

export const paidWithRazorpay = (booking: Booking) => booking.status === 'CONFIRMED' && booking.payment?.provider === 'razorpay' && booking.payment.status === 'CAPTURED';
