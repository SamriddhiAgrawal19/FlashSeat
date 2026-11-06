import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import '../components/booking/booking.css';
import { BookingHeader } from '../components/booking/BookingHeader';
import { CountdownRing } from '../components/booking/Countdown';
import { HoldStatusPanel } from '../components/booking/HoldStatusPanel';
import { SeatLines } from '../components/booking/OrderSummary';
import { AccentButton, Arrow, Eyebrow, GhostButton, PrimaryButton } from '../components/site/ui';
import { ApiError, releaseReservation } from '../lib/api';
import { checkoutWithRetry, HOLD_ENDED_CODES } from '../lib/booking/checkout';
import { isNotFound, useReservation } from '../lib/queries';
import { showToast } from '../lib/toast';

function HoldNotFound() {
  useEffect(() => {
    document.title = 'Hold not found · FlashSeat';
  }, []);
  return (
    <>
      <BookingHeader step="hold" />
      <section className="bk-main bk-narrow bk-step-in">
        <Eyebrow>404</Eyebrow>
        <h1 className="bk-h1-lg">
          Hold not <span className="site-serif">found.</span>
        </h1>
        <p className="bk-lede">This hold doesn't exist, or it belongs to another account.</p>
        <GhostButton to="/events" size="lg">
          Browse events <Arrow />
        </GhostButton>
      </section>
    </>
  );
}

type ReleaseState = 'idle' | 'confirm' | 'releasing';

/** /reservations/:reservationId: the countdown and next steps. (An old ?event= parameter is ignored.) */
export function ReservationPage() {
  const { reservationId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useReservation(reservationId);
  const reservation = query.data;
  const event = reservation?.event;

  const [expiredHere, setExpiredHere] = useState(false);
  const [release, setRelease] = useState<ReleaseState>('idle');
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<'ended' | 'not-found' | 'busy' | 'failed' | null>(null);

  useEffect(() => {
    document.title = event ? `Your hold · ${event.title} · FlashSeat` : 'Your hold · FlashSeat';
  }, [event]);

  if ((query.isError && isNotFound(query.error)) || checkoutError === 'not-found') return <HoldNotFound />;

  if (query.isPending) {
    return (
      <>
        <BookingHeader step="hold" />
        <section aria-busy="true" className="bk-main bk-hold">
          <p className="sr-only" role="status">
            Loading your hold
          </p>
          <div aria-hidden="true" className="bk-hold-left">
            <span className="site-skel" style={{ width: 260, height: 260, borderRadius: '50%' }} />
          </div>
          <div aria-hidden="true" className="bk-hold-right">
            <span className="site-skel" style={{ width: 120, height: 12 }} />
            <span className="site-skel" style={{ width: '80%', height: 90 }} />
            <span className="site-skel" style={{ width: '100%', height: 160, borderRadius: 16 }} />
          </div>
        </section>
      </>
    );
  }

  if (!reservation) {
    return (
      <>
        <BookingHeader step="hold" />
        <section className="bk-main bk-narrow">
          <HoldStatusPanel
            tone="error"
            role="alert"
            title="We couldn't load your hold right now."
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

  const seatMapUrl = `/shows/${reservation.showId}`;
  // The countdown reaching zero on the server clock means EXPIRED, even before a refetch says so.
  const status = reservation.status === 'ACTIVE' && expiredHere ? 'EXPIRED' : reservation.status;

  // Idempotent on the server (one booking per reservation), so retries resend the same request.
  async function onCheckout() {
    if (!reservation || checkingOut) return;
    setCheckingOut(true);
    setCheckoutError(null);
    try {
      const booking = await checkoutWithRetry(reservation.id);
      queryClient.setQueryData(['booking', booking.id], booking);
      navigate(`/pay/${booking.id}`);
    } catch (error) {
      setCheckingOut(false);
      if (error instanceof ApiError && HOLD_ENDED_CODES.has(error.code)) {
        setCheckoutError('ended');
        void query.refetch();
      } else if (error instanceof ApiError && error.status === 404) {
        setCheckoutError('not-found');
      } else if (error instanceof ApiError && (error.status === 503 || error.status === 429)) {
        setCheckoutError('busy');
      } else {
        setCheckoutError('failed');
      }
    }
  }

  async function onRelease() {
    if (!reservation) return;
    setRelease('releasing');
    setReleaseError(null);
    try {
      await releaseReservation(reservation.id);
      queryClient.removeQueries({ queryKey: ['reservation', reservation.id] });
      await queryClient.invalidateQueries({ queryKey: ['seatMap', reservation.showId] });
      showToast('Seats released.');
      navigate(seatMapUrl);
    } catch (error) {
      setRelease('idle');
      if (error instanceof ApiError && error.code === 'CANNOT_RELEASE_CONFIRMED') {
        setReleaseError('These seats are already booked, so they can no longer be released.');
        void query.refetch();
      } else {
        setReleaseError("We couldn't release your seats. Please try again.");
      }
    }
  }

  const active = status === 'ACTIVE';
  const lines = <SeatLines seats={reservation.seats} totalPaise={reservation.totalPricePaise} />;

  const errors = (
    <>
      {checkoutError === 'ended' && (
        <HoldStatusPanel
          tone="error"
          role="alert"
          title="Your hold ended before checkout. Your seats may have been taken."
          action={
            <GhostButton to={seatMapUrl} size="sm">
              Back to the seat map <Arrow />
            </GhostButton>
          }
        />
      )}
      {(checkoutError === 'busy' || checkoutError === 'failed') && (
        <HoldStatusPanel tone="error" role="alert" title={checkoutError === 'busy' ? "We're very busy right now." : "We couldn't start checkout."}>
          Your seats are still held. Please try again in a moment.
        </HoldStatusPanel>
      )}
      {releaseError && (
        <p role="alert" className="bk-error-text">
          {releaseError}
        </p>
      )}
    </>
  );

  return (
    <>
      <BookingHeader step="hold" event={reservation.event} startsAt={reservation.show.startsAt} venue={reservation.show.venue} />
      {active ? (
        <section aria-labelledby="hold-title" className="bk-main bk-hold bk-step-in">
          <div className="bk-hold-left">
            <CountdownRing
              expiresAt={reservation.expiresAt}
              onExpire={() => {
                setExpiredHere(true);
                void query.refetch();
              }}
            />
            <p className="bk-hold-caption">Nobody else can book these seats until the timer runs out.</p>
          </div>

          <div className="bk-hold-right">
            <Eyebrow>STEP 2 OF 4</Eyebrow>
            <h1 id="hold-title" className="bk-h1-hold">
              They're <span className="site-serif">yours</span>
              <br />
              <span className="bk-dim">for now.</span>
            </h1>
            {lines}
            <div className="bk-actions">
              <PrimaryButton size="lg" className="bk-btn-cta" onClick={() => void onCheckout()} disabled={checkingOut || release !== 'idle'} aria-busy={checkingOut}>
                {checkingOut ? (
                  <>
                    <span aria-hidden="true" className="bk-spin is-dark" /> Starting checkout…
                  </>
                ) : (
                  <>
                    Continue to payment <Arrow />
                  </>
                )}
              </PrimaryButton>
              {release === 'idle' && !checkingOut && (
                <button type="button" className="bk-textbtn" onClick={() => setRelease('confirm')}>
                  Release seats
                </button>
              )}
            </div>
            {release !== 'idle' && (
              <HoldStatusPanel
                tone="muted"
                title="Release these seats?"
                action={
                  <>
                    <GhostButton size="sm" onClick={() => void onRelease()} disabled={release === 'releasing'}>
                      {release === 'releasing' ? 'Releasing…' : 'Yes, release them'}
                    </GhostButton>
                    <PrimaryButton size="sm" onClick={() => setRelease('idle')} disabled={release === 'releasing'}>
                      Keep my seats
                    </PrimaryButton>
                  </>
                }
              >
                Anyone will be able to take them straight away.
              </HoldStatusPanel>
            )}
            {errors}
          </div>
        </section>
      ) : (
        <section aria-labelledby="hold-title" className="bk-main bk-narrow bk-step-in">
          <Eyebrow>STEP 2 OF 4 · HOLD</Eyebrow>
          {status === 'EXPIRED' && (
            <>
              <h1 id="hold-title" className="bk-h1-hold">
                Time's <span className="site-serif">up.</span>
              </h1>
              <HoldStatusPanel
                tone="muted"
                title="Your hold has expired."
                action={
                  <AccentButton to={seatMapUrl} size="sm">
                    Back to the seat map <Arrow />
                  </AccentButton>
                }
              >
                The seats went back on sale. They may still be free.
              </HoldStatusPanel>
            </>
          )}
          {status === 'RELEASED' && (
            <>
              <h1 id="hold-title" className="bk-h1-hold">
                Seats <span className="site-serif">released.</span>
              </h1>
              <HoldStatusPanel
                tone="muted"
                title="You released these seats."
                action={
                  <AccentButton to={seatMapUrl} size="sm">
                    Back to the seat map <Arrow />
                  </AccentButton>
                }
              >
                They are back on sale for everyone.
              </HoldStatusPanel>
            </>
          )}
          {status === 'CONFIRMED' && (
            <>
              <h1 id="hold-title" className="bk-h1-hold">
                Already <span className="site-serif">booked.</span>
              </h1>
              <HoldStatusPanel
                title="Already booked."
                action={
                  <PrimaryButton to="/bookings" size="sm">
                    Your bookings <Arrow />
                  </PrimaryButton>
                }
              >
                These seats are yours. Your tickets are in your bookings.
              </HoldStatusPanel>
            </>
          )}
          {errors}
          <div className="bk-dimmed">{lines}</div>
        </section>
      )}
    </>
  );
}
