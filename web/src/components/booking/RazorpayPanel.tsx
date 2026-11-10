import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { formatPaise } from '../../lib/format';
import { RAZORPAY_TEST_DOCS } from '../../lib/booking/razorpay';

const METHODS = ['UPI', 'CARDS', 'NETBANKING'];

interface RazorpayPanelProps {
  totalPaise: number;
  testMode: boolean;
  /** Button disabled + spinner (script loading, window open, verifying). */
  busy: boolean;
  busyLabel: string;
  /** Hide the button (post-payment states: verifying, polling, refund). */
  hideButton?: boolean;
  note: string | null;
  onPay: () => void;
  children?: ReactNode;
}

/** Razorpay mode of /pay/:bookingId: who takes the payment, the methods, and "Pay ₹X". */
export function RazorpayPanel({ totalPaise, testMode, busy, busyLabel, hideButton, note, onPay, children }: RazorpayPanelProps) {
  return (
    <section aria-labelledby="pay-title" className="bk-card bk-paycard">
      {testMode && <span className="bk-badge">TEST MODE</span>}
      <h2 id="pay-title" className="bk-h2">
        Payment
      </h2>
      <div className="bk-rzp">
        <p className="bk-rzp-title">
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="7" width="10" height="7" rx="1.5" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
          </svg>
          Secure payment by Razorpay
        </p>
        <ul aria-label="Accepted methods" className="bk-rzp-chips">
          {METHODS.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        {testMode && (
          <p className="bk-rzp-hint">
            Test mode: no money moves. Use a{' '}
            <a href={RAZORPAY_TEST_DOCS} target="_blank" rel="noreferrer">
              Razorpay test card or UPI id
            </a>
            .
          </p>
        )}
      </div>
      {!hideButton && (
        <button type="button" onClick={onPay} disabled={busy} aria-busy={busy} className={cn('site-btn site-btn-accent bk-btn-block', busy && 'is-busy')}>
          {busy && <span aria-hidden="true" className="bk-spin" />}
          {busy ? busyLabel : `Pay ${formatPaise(totalPaise)}`}
        </button>
      )}
      <p aria-live="polite" className={cn('bk-note is-center', !note && 'is-empty')}>
        {note}
      </p>
      {children}
    </section>
  );
}
