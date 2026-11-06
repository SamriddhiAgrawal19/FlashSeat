import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import '../components/booking/booking.css';
import { BookingHeader } from '../components/booking/BookingHeader';
import { MiniCountdown } from '../components/booking/Countdown';
import { HoldStatusPanel } from '../components/booking/HoldStatusPanel';
import { OrderSummary } from '../components/booking/OrderSummary';
import { PaymentPanel } from '../components/booking/PaymentPanel';
import { BookingStatusPill } from '../components/booking/StatusPill';
import { useEventPhoto } from '../components/booking/useEventPhoto';
import { AccentButton, Arrow, Eyebrow, GhostButton, PrimaryButton } from '../components/site/ui';
import { ApiError, releaseReservation, type Booking } from '../lib/api';
import { HOLD_ENDED_CODES, isPaymentsDisabled, payWithRetry } from '../lib/booking/checkout';
import { serverNow } from '../lib/booking/serverClock';
import { isNotFound, useBooking } from '../lib/queries';
import { showToast } from '../lib/toast';

/** Also used by /bookings/:id (under the site header). */
export function BookingNotFound() {
  useEffect(() => {
    document.title = 'Booking not found · FlashSeat';
  }, []);
  return (
    <section className="bk-main bk-narrow bk-step-in">
      <Eyebrow>404</Eyebrow>
      <h1 className="bk-h1-lg">
        Booking not <span className="site-serif">found.</span>
      </h1>
      <p className="bk-lede">This booking doesn't exist, or it belongs to another account.</p>
      <GhostButton to="/bookings" size="lg">
        My bookings <Arrow />
      </GhostButton>
    </section>
  );
}

export function PageSkeleton({ label }: { label: string }) {
  return (
    <section aria-busy="true" className="bk-main bk-pay">
      <p className="sr-only" role="status">
        {label}
      </p>
      <div aria-hidden="true" className="bk-order">
        <span className="site-skel" style={{ width: 160, height: 12 }} />
        <span className="site-skel" style={{ width: '70%', height: 84, borderRadius: 14 }} />
        <span className="site-skel" style={{ width: '100%', height: 180, borderRadius: 16 }} />
      </div>
      <span aria-hidden="true" className="site-skel" style={{ width: '100%', height: 420, borderRadius: 20 }} />
    </section>
  );
}

type PayProblem =
  | { kind: 'ended' }
  | { kind: 'payments-off' }
  | { kind: 'busy'; wait: number }
  | { kind: 'failed' };

type ReleaseState = 'idle' | 'confirm' | 'releasing';

/** Why this booking can't be paid, when it arrives in a closed state. */
function ClosedBooking({ booking }: { booking: Booking }) {
  const copy: Partial<Record<Booking['status'], { title: string; body: string }>> = {
    EXPIRED: { title: 'Your hold expired before payment.', body: 'The seats went back on sale. They may still be free.' },
    CANCELLED: { title: 'This booking was cancelled.', body: 'The seats were released. Nothing was charged.' },
    PAYMENT_FAILED: { title: 'The payment did not go through.', body: 'Nothing was charged. Pick your seats again to try once more.' },
    REFUND_PENDING: { title: 'This event was cancelled.', body: 'Your refund is being processed.' },
    REFUNDED: { title: 'This event was cancelled.', body: 'Your payment has been refunded.' },
  };
  const text = copy[booking.status] ?? { title: 'This booking can no longer be paid.', body: '' };
  return (
    <HoldStatusPanel
      tone="muted"
      title={text.title}
      action={
        <PrimaryButton to={`/events/${booking.event.id}`} size="sm">
          Back to the event <Arrow />
        </PrimaryButton>
      }
    >
      {text.body}
    </HoldStatusPanel>
  );
}

/** /pay/:bookingId: order summary and the test-mode payment panel. */
export function PayPage() {
  const { bookingId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useBooking(bookingId);
  const booking = query.data;
  const { photo, onError: onPhotoError } = useEventPhoto(booking?.event);

  const [paying, setPaying] = useState(false);
  const [payingNote, setPayingNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<PayProblem | null>(null);
  const [expiredHere, setExpiredHere] = useState(false);
  const [release, setRelease] = useState<ReleaseState>('idle');
  const [releaseError, setReleaseError] = useState<string | null>(null);
  // A second click before React re-renders must not send a second request.
  const inFlight = useRef(false);

  useEffect(() => {
    document.title = booking ? `Pay · ${booking.event.title} · FlashSeat` : 'Pay · FlashSeat';
  }, [booking]);

  if (query.isError && isNotFound(query.error)) {
    return (
      <>
        <BookingHeader step="pay" />
        <BookingNotFound />
      </>
    );
  }
  if (query.isPending) {
    return (
      <>
        <BookingHeader step="pay" />
        <PageSkeleton label="Loading your order" />
      </>
    );
  }
  if (!booking) {
    return (
      <>
        <BookingHeader step="pay" />
        <section className="bk-main bk-narrow">
          <HoldStatusPanel
            tone="error"
            role="alert"
            title="We couldn't load your order right now."
            action={
              <GhostButton size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
                {query.isFetching ? 'Retrying…' : 'Try again'}
              </GhostButton>
            }
          >
            Check your connection, or try again in a moment.
          </HoldStatusPanel>
        </section>
      </>
    );
  }

  // Already paid (e.g. a second tab, or Back after paying): straight to the tickets.
  if (booking.status === 'CONFIRMED' && !paying) return <Navigate to={`/bookings/${booking.id}`} replace />;

  const payBefore = booking.payBefore;
  const payable = booking.status === 'PENDING_PAYMENT' && !!payBefore && !expiredHere && Date.parse(payBefore) > serverNow();
  const seatMapUrl = `/shows/${booking.show.id}`;

  async function onPay() {
    if (!booking || inFlight.current) return;
    inFlight.current = true;
    setPaying(true);
    setProblem(null);
    try {
      // Idempotent on the server: an already confirmed booking answers 200 with the same tickets.
      const confirmed = await payWithRetry(booking.id, (n) => setPayingNote(`Connection hiccup. Retrying (${n} of 3)…`));
      queryClient.setQueryData(['booking', confirmed.id], confirmed);
      void queryClient.invalidateQueries({ queryKey: ['bookings', 'mine'] });
      navigate(`/bookings/${confirmed.id}?new=1`);
    } catch (error) {
      inFlight.current = false;
      setPaying(false);
      setPayingNote(null);
      if (isPaymentsDisabled(error)) setProblem({ kind: 'payments-off' });
      else if (error instanceof ApiError && HOLD_ENDED_CODES.has(error.code)) {
        setProblem({ kind: 'ended' });
        void query.refetch();
      } else if (error instanceof ApiError && (error.status === 503 || error.status === 429)) {
        setProblem({ kind: 'busy', wait: error.retryAfterSeconds ?? 1 });
      } else if (error instanceof ApiError && error.status === 404) {
        void query.refetch(); // gone for real: the page switches to "Booking not found"
      } else setProblem({ kind: 'failed' });
    }
  }

  async function onRelease() {
    if (!booking) return;
    setRelease('releasing');
    setReleaseError(null);
    try {
      // Releasing the hold also cancels this PENDING_PAYMENT booking (one transaction).
      await releaseReservation(booking.reservationId);
      queryClient.removeQueries({ queryKey: ['booking', booking.id] });
      void queryClient.invalidateQueries({ queryKey: ['bookings', 'mine'] });
      void queryClient.invalidateQueries({ queryKey: ['seatMap', booking.show.id] });
      showToast('Seats released.');
      navigate(`/events/${booking.event.id}`);
    } catch (error) {
      setRelease('idle');
      if (error instanceof ApiError && error.code === 'CANNOT_RELEASE_CONFIRMED') {
        setReleaseError('This booking is already paid, so its seats can no longer be released.');
        void query.refetch();
      } else {
        setReleaseError("We couldn't release your seats. Please try again.");
      }
    }
  }

  const shownStatus = expiredHere && booking.status === 'PENDING_PAYMENT' ? 'EXPIRED' : booking.status;

  return (
    <>
      <BookingHeader step="pay" event={booking.event} startsAt={booking.show.startsAt} venue={booking.show.venue} />
      <div className="bk-main bk-pay bk-step-in">
        <OrderSummary
          booking={booking}
          photo={photo}
          onPhotoError={onPhotoError}
          clock={
            payable && payBefore ? (
              <MiniCountdown
                expiresAt={payBefore}
                onExpire={() => {
                  setExpiredHere(true);
                  void query.refetch();
                }}
              />
            ) : undefined
          }
        />

        {payable && payBefore ? (
          <PaymentPanel totalPaise={booking.totalPaise} paying={paying} payingNote={payingNote} onPay={() => void onPay()}>
            {problem?.kind === 'ended' && (
              <HoldStatusPanel
                tone="error"
                role="alert"
                title="Your hold ended before payment. Your seats may have been taken."
                action={
                  <GhostButton to={seatMapUrl} size="sm">
                    Seat map <Arrow />
                  </GhostButton>
                }
              />
            )}
            {problem?.kind === 'payments-off' && (
              <HoldStatusPanel tone="error" role="alert" title="Payments are not available right now.">
                Your seats stay held until the timer runs out. Please try again later.
              </HoldStatusPanel>
            )}
            {problem?.kind === 'busy' && (
              <HoldStatusPanel tone="error" role="alert" title="We're very busy right now.">
                Nothing was charged. Please try again in {problem.wait} second{problem.wait === 1 ? '' : 's'}.
              </HoldStatusPanel>
            )}
            {problem?.kind === 'failed' && (
              <HoldStatusPanel tone="error" role="alert" title="The payment didn't go through.">
                Nothing was charged. Please try again.
              </HoldStatusPanel>
            )}

            {release === 'idle' ? (
              <button type="button" className="bk-textbtn is-sm is-center" onClick={() => setRelease('confirm')} disabled={paying}>
                Cancel and release seats
              </button>
            ) : (
              <HoldStatusPanel
                tone="muted"
                title="Cancel this order?"
                action={
                  <>
                    <GhostButton size="sm" onClick={() => void onRelease()} disabled={release === 'releasing'}>
                      {release === 'releasing' ? 'Releasing…' : 'Yes, release seats'}
                    </GhostButton>
                    <PrimaryButton size="sm" onClick={() => setRelease('idle')} disabled={release === 'releasing'}>
                      Keep my order
                    </PrimaryButton>
                  </>
                }
              >
                Your seats go back on sale straight away.
              </HoldStatusPanel>
            )}
            {releaseError && (
              <p role="alert" className="bk-error-text">
                {releaseError}
              </p>
            )}
          </PaymentPanel>
        ) : (
          <section aria-label="Payment" className="bk-card bk-paycard">
            <BookingStatusPill status={shownStatus} />
            <h2 className="bk-h2">Payment</h2>
            {booking.status === 'PENDING_PAYMENT' ? (
              <HoldStatusPanel
                tone="muted"
                title="Your hold expired before payment."
                action={
                  <AccentButton to={`/events/${booking.event.id}`} size="sm">
                    Back to the event <Arrow />
                  </AccentButton>
                }
              >
                The seats went back on sale. They may still be free.
              </HoldStatusPanel>
            ) : (
              <ClosedBooking booking={booking} />
            )}
          </section>
        )}
      </div>
    </>
  );
}
