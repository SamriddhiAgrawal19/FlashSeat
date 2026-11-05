import type { BookingStatus } from '../../lib/api';
import { cn } from '../../lib/cn';

const LABELS: Record<BookingStatus, string> = {
  CONFIRMED: 'Confirmed',
  PENDING_PAYMENT: 'Payment pending',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  PAYMENT_FAILED: 'Payment failed',
  REFUND_PENDING: 'Refund pending',
  REFUNDED: 'Refunded',
};

// Lime marks the good state only; open states are warm white, closed ones recede.
const TONES: Record<BookingStatus, string> = {
  CONFIRMED: 'border-lime/60 text-lime',
  PENDING_PAYMENT: 'border-text/40 text-text',
  REFUND_PENDING: 'border-text/40 text-text',
  EXPIRED: 'border-rule text-text-2',
  CANCELLED: 'border-rule text-text-2',
  PAYMENT_FAILED: 'border-danger/50 text-danger',
  REFUNDED: 'border-rule text-text-2',
};

export function statusLabel(status: BookingStatus): string {
  return LABELS[status];
}

/** Shared shape of every status pill (booking and organizer event/show statuses). */
export const PILL_BASE = 'label-mono inline-flex h-7 items-center gap-2 rounded-[2px] border px-2.5 whitespace-nowrap';

/** Small mono status label with a hairline border. */
export function StatusPill({ status, className }: { status: BookingStatus; className?: string }) {
  return (
    <span className={cn(PILL_BASE, TONES[status], className)}>
      {status === 'CONFIRMED' && <span aria-hidden="true" className="size-1.5 bg-lime" />}
      {LABELS[status]}
    </span>
  );
}
