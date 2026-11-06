import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { formatPaise } from '../../lib/format';

// Obviously fake values, shown as plain text. They are decoration: not inputs, not a <form>, never
// read, validated, stored or sent.
const FAKE_CARD = [
  { label: 'CARD NUMBER', value: '4242 4242 4242 4242' },
  { label: 'EXPIRY', value: '12 / 30' },
  { label: 'CVC', value: '123' },
];

interface PaymentPanelProps {
  totalPaise: number;
  paying: boolean;
  /** "Retrying…" while a lost request is being sent again. */
  payingNote: string | null;
  onPay: () => void;
  /** Errors and the release control, under the button. */
  children?: ReactNode;
}

/** Test-mode payment (docs/booking-flow-design.html): the badge, decorative card details and "Pay ₹X". */
export function PaymentPanel({ totalPaise, paying, payingNote, onPay, children }: PaymentPanelProps) {
  const [number, expiry, cvc] = FAKE_CARD;
  return (
    <section aria-labelledby="pay-title" className="bk-card bk-paycard">
      <span className="bk-badge">TEST MODE · NO REAL PAYMENT IS TAKEN</span>
      <h2 id="pay-title" className="bk-h2">
        Payment
      </h2>
      <div role="group" aria-label="Card details (test mode, not sent anywhere)" className="bk-fields">
        {[number!, expiry!, cvc!].map((field, i) => (
          <div key={field.label} className={cn('bk-field', i === 0 && 'is-wide')}>
            <span className="bk-field-label">{field.label}</span>
            <span className="bk-field-value">{field.value}</span>
          </div>
        ))}
      </div>
      <button type="button" onClick={onPay} disabled={paying} aria-busy={paying} className={cn('site-btn site-btn-accent bk-btn-block', paying && 'is-busy')}>
        {paying && <span aria-hidden="true" className="bk-spin" />}
        {paying ? 'Processing…' : `Pay ${formatPaise(totalPaise)}`}
      </button>
      <p aria-live="polite" className={cn('bk-note is-center', !payingNote && 'is-empty')}>
        {payingNote}
      </p>
      {children}
    </section>
  );
}
