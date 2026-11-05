import { useId, type ReactNode } from 'react';
import { formatPaise } from '../../lib/format';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { Countdown } from './Countdown';

// Obviously fake values. The fields are decoration: they are never read, validated, stored or
// sent (no <form>, no name attributes, autocomplete off).
const FAKE_CARD = [
  { label: 'Card number', value: '4242 4242 4242 4242', span: 'col-span-2' },
  { label: 'Expiry', value: '12 / 34', span: '' },
  { label: 'CVC', value: '123', span: '' },
  { label: 'Name on card', value: 'Test Cardholder', span: 'col-span-2' },
];

function FakeField({ label, value, span }: { label: string; value: string; span: string }) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-2', span)}>
      <label htmlFor={id} className="label-mono text-text-2">
        {label}
      </label>
      <input
        id={id}
        defaultValue={value}
        autoComplete="off"
        spellCheck={false}
        inputMode={label === 'Name on card' ? 'text' : 'numeric'}
        className="h-12 min-w-0 rounded-[2px] border border-text/20 bg-bg px-3 font-mono text-[15px] text-text outline-none focus-visible:border-lime"
      />
    </div>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="inline-block size-4 animate-spin rounded-full border-2 border-bg/30 border-t-bg" />;
}

interface PaymentPanelProps {
  totalPaise: number;
  payBefore: string;
  paying: boolean;
  /** "Retrying…" while a lost request is being sent again. */
  payingNote: string | null;
  onPay: () => void;
  onExpire: () => void;
  /** Errors and the release control, under the button. */
  children?: ReactNode;
}

/** Test-mode payment: the notice, a countdown to payBefore, a decorative card form and "Pay ₹X". */
export function PaymentPanel({ totalPaise, payBefore, paying, payingNote, onPay, onExpire, children }: PaymentPanelProps) {
  return (
    <div className="border border-rule bg-surface p-6 md:p-8">
      <p className="label-mono flex items-center gap-2 border border-lime/40 px-3 py-2 text-lime">
        <span aria-hidden="true" className="size-1.5 shrink-0 bg-lime" />
        Test mode · No real payment is taken
      </p>

      <div className="mt-8">
        <Countdown expiresAt={payBefore} onExpire={onExpire} label="Pay within" size="md" />
      </div>

      <div role="group" aria-label="Card details (test mode, not sent anywhere)" className="mt-8 grid grid-cols-2 gap-4">
        {FAKE_CARD.map((field) => (
          <FakeField key={field.label} {...field} />
        ))}
      </div>
      <p className="mt-3 text-[13px] text-text-2">These card fields are for show. Nothing typed here leaves this page.</p>

      <Button size="lg" onClick={onPay} disabled={paying} aria-busy={paying} className={cn('mt-8 w-full', paying && 'disabled:opacity-100')}>
        {paying ? (
          <>
            <Spinner /> Processing…
          </>
        ) : (
          `Pay ${formatPaise(totalPaise)}`
        )}
      </Button>
      <p aria-live="polite" className="mt-3 min-h-5 text-center text-[13px] text-text-2">
        {payingNote}
      </p>

      {children}
    </div>
  );
}
