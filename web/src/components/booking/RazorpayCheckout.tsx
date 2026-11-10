import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, type Booking, type PaymentOrder, type RazorpaySuccess } from '../../lib/api';
import { useAuth } from '../../lib/auth/useAuth';
import { isTestKey, loadRazorpay, pollBooking, verifyWithRetry, type RazorpayInstance } from '../../lib/booking/razorpay';
import { AccentButton, Arrow, GhostButton, PrimaryButton } from '../site/ui';
import { HoldStatusPanel } from './HoldStatusPanel';
import { RazorpayPanel } from './RazorpayPanel';

/**
 * idle -> loading (checkout.js) -> open (Razorpay window) -> verifying -> (polling -> slow) | seats-gone.
 * The order comes from the page (POST /bookings/:id/payments on load) and is reused on every
 * click: this component never creates an order.
 */
type Phase = 'idle' | 'loading' | 'open' | 'verifying' | 'polling' | 'slow' | 'seats-gone';

export type OrderProblem = 'too-short' | 'ended' | null;

const POST_PAYMENT: Phase[] = ['verifying', 'polling', 'slow', 'seats-gone'];

interface Props {
  booking: Booking;
  order: PaymentOrder | null;
  orderProblem: OrderProblem;
  /** The hold countdown reached zero (server clock). */
  expired: boolean;
  /** Shown when the hold ended and no payment is in flight. */
  closedView: ReactNode;
  /** True while a payment is being confirmed: the page must not redirect or swap this out. */
  onLockedChange: (locked: boolean) => void;
  /** Release-seats control etc., under the idle panel. */
  children?: ReactNode;
}

export function RazorpayCheckout({ booking, order, orderProblem, expired, closedView, onLockedChange, children }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [scriptError, setScriptError] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const rzp = useRef<RazorpayInstance | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const lastSuccess = useRef<RazorpaySuccess | null>(null);
  const cancelled = useRef(false);

  // Read through a function: TypeScript would otherwise narrow the ref across awaits.
  const currentPhase = (): Phase => phaseRef.current;

  const go = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
    onLockedChange(POST_PAYMENT.includes(next));
  };

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      if (phaseRef.current === 'open') rzp.current?.close();
    };
  }, []);

  // The hold ran out while the Razorpay window was open (or loading): close it.
  useEffect(() => {
    if (!expired) return;
    if (phaseRef.current === 'open') rzp.current?.close();
    if (phaseRef.current === 'open' || phaseRef.current === 'loading') go('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  function finish(confirmed: Booking) {
    queryClient.setQueryData(['booking', confirmed.id], confirmed);
    void queryClient.invalidateQueries({ queryKey: ['bookings', 'mine'] });
    navigate(`/bookings/${confirmed.id}?new=1`);
  }

  function seatsGone() {
    go('seats-gone');
    setNote(null);
    void queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
    void queryClient.invalidateQueries({ queryKey: ['bookings', 'mine'] });
  }

  async function poll() {
    go('polling');
    setNote(null);
    const result = await pollBooking(booking.id, () => cancelled.current);
    if (cancelled.current) return;
    if (result?.status === 'CONFIRMED') finish(result);
    else if (result && (result.status === 'REFUND_PENDING' || result.status === 'REFUNDED')) seatsGone();
    else go('slow');
  }

  async function verify(body: RazorpaySuccess) {
    lastSuccess.current = body;
    go('verifying');
    setVerifyError(null);
    setFailure(null);
    setNote('Confirming your payment…');
    try {
      const confirmed = await verifyWithRetry(body, (n) => setNote(`Connection hiccup. Retrying (${n} of 3)…`));
      if (!cancelled.current) finish(confirmed);
    } catch (error) {
      if (cancelled.current) return;
      if (error instanceof ApiError && error.code === 'PAYMENT_CAPTURED_SEATS_UNAVAILABLE') return seatsGone();
      const transient = error instanceof ApiError && (error.status === 0 || error.status >= 500);
      if (transient) return void poll();
      go('idle');
      setNote(null);
      setVerifyError(error instanceof ApiError && error.code === 'INVALID_SIGNATURE' ? "We couldn't verify this payment." : "We couldn't confirm your payment.");
    }
  }

  async function onPay() {
    if (!order || phaseRef.current !== 'idle') return;
    setFailure(null);
    setVerifyError(null);
    setScriptError(false);
    go('loading');
    let Razorpay;
    try {
      Razorpay = await loadRazorpay();
    } catch {
      if (currentPhase() !== 'loading') return;
      go('idle');
      setScriptError(true);
      return;
    }
    if (currentPhase() !== 'loading' || cancelled.current) return; // expired meanwhile
    const instance = new Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: 'FlashSeat',
      description: booking.event.title,
      prefill: { name: user?.name, email: user?.email },
      theme: { color: '#FF6B4A' },
      modal: {
        ondismiss: () => {
          if (phaseRef.current === 'open') go('idle');
        },
      },
      handler: (response) => {
        void verify({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        });
      },
    });
    instance.on('payment.failed', (response) => {
      const description = response.error?.description?.trim() || 'The payment was declined';
      setFailure(description.replace(/\.$/, ''));
    });
    rzp.current = instance;
    go('open');
    instance.open();
  }

  // ---- post-payment states: shown whatever the countdown says
  if (phase === 'seats-gone') {
    return (
      <section aria-label="Payment" className="bk-card bk-paycard">
        <HoldStatusPanel
          tone="error"
          role="alert"
          title="Payment received, but your hold ended and the seats were taken. A full refund has started."
          action={
            <>
              <PrimaryButton to="/bookings" size="sm">
                My bookings <Arrow />
              </PrimaryButton>
              <GhostButton to={`/events/${booking.event.id}`} size="sm">
                Back to the event
              </GhostButton>
            </>
          }
        >
          The refund goes back to the same payment method. You'll see its status in My bookings.
        </HoldStatusPanel>
      </section>
    );
  }
  if (phase === 'polling' || phase === 'slow') {
    return (
      <section aria-label="Payment" className="bk-card bk-paycard">
        {phase === 'polling' ? (
          <HoldStatusPanel title="We received your payment and are confirming your seats.">
            <span className="bk-inline-spin">
              <span aria-hidden="true" className="bk-spin" /> This can take up to a minute. Please keep this page open.
            </span>
          </HoldStatusPanel>
        ) : (
          <HoldStatusPanel
            tone="muted"
            title="Still confirming."
            action={
              <PrimaryButton to="/bookings" size="sm">
                My bookings <Arrow />
              </PrimaryButton>
            }
          >
            You'll see it in My bookings; if seats were lost you'll be refunded automatically.
          </HoldStatusPanel>
        )}
      </section>
    );
  }

  const testMode = order ? isTestKey(order.keyId) : false;

  if (orderProblem === 'too-short') {
    return (
      <section aria-label="Payment" className="bk-card bk-paycard">
        <HoldStatusPanel
          tone="error"
          role="alert"
          title="Not enough time left to pay. Hold your seats again."
          action={
            <AccentButton to={`/shows/${booking.show.id}`} size="sm">
              Seat map <Arrow />
            </AccentButton>
          }
        >
          A payment needs at least 2 minutes of hold left. Release these seats or let the hold run out, then pick them again.
        </HoldStatusPanel>
        {children}
      </section>
    );
  }
  if (orderProblem === 'ended' || (expired && phase !== 'verifying')) return <>{closedView}</>;

  const busy = phase !== 'idle';
  const busyLabel = phase === 'loading' ? 'Opening Razorpay…' : phase === 'open' ? 'Waiting for payment…' : 'Confirming…';

  return (
    <RazorpayPanel totalPaise={order?.amount ?? booking.totalPaise} testMode={testMode} busy={busy || !order} busyLabel={busyLabel} note={note} onPay={() => void onPay()}>
      {scriptError && (
        <HoldStatusPanel
          tone="error"
          role="alert"
          title="Couldn't load the payment window."
          action={
            <GhostButton size="sm" onClick={() => void onPay()}>
              Retry
            </GhostButton>
          }
        >
          Check your connection or any blocker that stops checkout.razorpay.com. Nothing was charged.
        </HoldStatusPanel>
      )}
      {failure && (
        <HoldStatusPanel tone="error" role="alert" title={`Payment failed: ${failure}.`}>
          You weren't charged. Try again.
        </HoldStatusPanel>
      )}
      {verifyError && (
        <HoldStatusPanel
          tone="error"
          role="alert"
          title={verifyError}
          action={
            lastSuccess.current ? (
              <GhostButton size="sm" onClick={() => lastSuccess.current && void verify(lastSuccess.current)}>
                Check again
              </GhostButton>
            ) : undefined
          }
        >
          If money left your account it will be refunded automatically. You can also try paying again.
        </HoldStatusPanel>
      )}
      {phase === 'idle' && children}
    </RazorpayPanel>
  );
}
