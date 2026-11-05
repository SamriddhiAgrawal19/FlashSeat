import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { HoldStatusPanel } from '../components/booking/HoldStatusPanel';
import { OrderSummary } from '../components/booking/OrderSummary';
import { PaymentPanel } from '../components/booking/PaymentPanel';
import { StatusPill } from '../components/booking/StatusPill';
import { Arrow, Button, ButtonLink } from '../components/ui/Button';
import { Container } from '../components/ui/Container';
import { Eyebrow } from '../components/ui/Section';
import { ApiError, releaseReservation, type Booking } from '../lib/api';
import { HOLD_ENDED_CODES, isPaymentsDisabled, payWithRetry } from '../lib/booking/checkout';
import { serverNow } from '../lib/booking/serverClock';
import { isNotFound, useBooking } from '../lib/queries';
import { showToast } from '../lib/toast';

export function BookingNotFound() {
  useEffect(() => {
    document.title = 'Booking not found · FlashSeat';
  }, []);
  return (
    <section className="pt-40 pb-28 md:pt-48">
      <Container className="max-w-[42rem]">
        <Eyebrow>404</Eyebrow>
        <h1 className="mt-4 text-section font-medium text-text">Booking not found.</h1>
        <p className="mt-4 text-text-2">This booking doesn't exist, or it belongs to another account.</p>
        <ButtonLink to="/bookings" variant="secondary" className="mt-8">
          My bookings <Arrow />
        </ButtonLink>
      </Container>
    </section>
  );
}

export function PageSkeleton({ label }: { label: string }) {
  const block = 'bg-text/[0.07] motion-safe:animate-breathe';
  return (
    <section aria-busy="true" className="pt-32 pb-28">
      <p className="sr-only" role="status">
        {label}
      </p>
      <Container aria-hidden="true" className="grid gap-12 md:grid-cols-2">
        <div>
          <div className={`h-4 w-40 ${block}`} />
          <div className={`mt-6 h-10 w-3/4 ${block}`} />
          <div className={`mt-10 h-48 w-full ${block}`} />
        </div>
        <div className={`h-96 w-full ${block}`} />
      </Container>
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
        <ButtonLink to={`/events/${booking.event.id}`}>
          Back to the event <Arrow />
        </ButtonLink>
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

  if (query.isError && isNotFound(query.error)) return <BookingNotFound />;
  if (query.isPending) return <PageSkeleton label="Loading your order" />;
  if (!booking) {
    return (
      <section className="pt-40 pb-28">
        <Container>
          <HoldStatusPanel
            tone="error"
            role="alert"
            title="We couldn't load your order right now."
            action={
              <Button variant="secondary" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
                {query.isFetching ? 'Retrying…' : 'Try again'}
              </Button>
            }
          >
            Check your connection, or try again in a moment.
          </HoldStatusPanel>
        </Container>
      </section>
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

  return (
    <section aria-labelledby="pay-title" className="pt-28 pb-28 md:pt-32">
      <Container>
        <Link to={`/events/${booking.event.id}`} className="label-mono inline-block text-text-2 hover:text-lime">
          ← Back to event
        </Link>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <h1 id="pay-title" className="text-section font-medium text-text">
            Checkout
          </h1>
          <StatusPill status={expiredHere && booking.status === 'PENDING_PAYMENT' ? 'EXPIRED' : booking.status} />
        </div>

        <div className="mt-12 grid gap-12 border-t border-rule pt-10 md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] md:gap-16">
          <OrderSummary booking={booking} />

          <div>
            {payable && payBefore ? (
              <PaymentPanel
                totalPaise={booking.totalPaise}
                payBefore={payBefore}
                paying={paying}
                payingNote={payingNote}
                onPay={() => void onPay()}
                onExpire={() => {
                  setExpiredHere(true);
                  void query.refetch();
                }}
              >
                {problem?.kind === 'ended' && (
                  <HoldStatusPanel
                    className="mt-6"
                    tone="error"
                    role="alert"
                    title="Your hold ended before payment. Your seats may have been taken."
                    action={
                      <ButtonLink to={seatMapUrl} variant="secondary" size="sm">
                        Seat map <Arrow />
                      </ButtonLink>
                    }
                  />
                )}
                {problem?.kind === 'payments-off' && (
                  <HoldStatusPanel className="mt-6" tone="error" role="alert" title="Payments are not available right now.">
                    Your seats stay held until the timer runs out. Please try again later.
                  </HoldStatusPanel>
                )}
                {problem?.kind === 'busy' && (
                  <HoldStatusPanel className="mt-6" tone="error" role="alert" title="We're very busy right now.">
                    Nothing was charged. Please try again in {problem.wait} second{problem.wait === 1 ? '' : 's'}.
                  </HoldStatusPanel>
                )}
                {problem?.kind === 'failed' && (
                  <HoldStatusPanel className="mt-6" tone="error" role="alert" title="The payment didn't go through.">
                    Nothing was charged. Please try again.
                  </HoldStatusPanel>
                )}

                <div className="mt-6 border-t border-rule pt-5">
                  {release === 'idle' ? (
                    <button
                      type="button"
                      onClick={() => setRelease('confirm')}
                      disabled={paying}
                      className="text-[15px] text-text-2 underline decoration-text/25 underline-offset-4 hover:text-text disabled:opacity-50"
                    >
                      Cancel and release seats
                    </button>
                  ) : (
                    <HoldStatusPanel
                      tone="muted"
                      title="Cancel this order?"
                      action={
                        <>
                          <Button size="sm" variant="secondary" onClick={() => void onRelease()} disabled={release === 'releasing'}>
                            {release === 'releasing' ? 'Releasing…' : 'Yes, release seats'}
                          </Button>
                          <Button size="sm" onClick={() => setRelease('idle')} disabled={release === 'releasing'}>
                            Keep my order
                          </Button>
                        </>
                      }
                    >
                      Your seats go back on sale straight away.
                    </HoldStatusPanel>
                  )}
                  {releaseError && (
                    <p role="alert" className="mt-4 text-[15px] text-danger">
                      {releaseError}
                    </p>
                  )}
                </div>
              </PaymentPanel>
            ) : booking.status === 'PENDING_PAYMENT' ? (
              <HoldStatusPanel
                tone="muted"
                title="Your hold expired before payment."
                action={
                  <ButtonLink to={`/events/${booking.event.id}`}>
                    Back to the event <Arrow />
                  </ButtonLink>
                }
              >
                The seats went back on sale. They may still be free.
              </HoldStatusPanel>
            ) : (
              <ClosedBooking booking={booking} />
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
