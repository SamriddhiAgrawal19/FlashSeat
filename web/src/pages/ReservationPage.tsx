import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Countdown } from '../components/booking/Countdown';
import { HoldStatusPanel } from '../components/booking/HoldStatusPanel';
import { Arrow, Button, ButtonLink } from '../components/ui/Button';
import { Container } from '../components/ui/Container';
import { Eyebrow } from '../components/ui/Section';
import { ApiError, releaseReservation, type Reservation } from '../lib/api';
import { seatCode } from '../lib/booking/seats';
import { formatCategory, formatPaise, formatShowDate } from '../lib/format';
import { isNotFound, useEventDetail, useReservation, useSeatMap } from '../lib/queries';
import { showToast } from '../lib/toast';

function HoldNotFound() {
  useEffect(() => {
    document.title = 'Hold not found · FlashSeat';
  }, []);
  return (
    <section className="pt-40 pb-28 md:pt-48">
      <Container className="max-w-[42rem]">
        <Eyebrow>404</Eyebrow>
        <h1 className="mt-4 text-section font-medium text-text">Hold not found.</h1>
        <p className="mt-4 text-text-2">This hold doesn't exist, or it belongs to another account.</p>
        <ButtonLink to="/events" variant="secondary" className="mt-8">
          Browse events <Arrow />
        </ButtonLink>
      </Container>
    </section>
  );
}

function SeatList({ reservation }: { reservation: Reservation }) {
  const sections = new Set(reservation.seats.map((s) => s.section));
  return (
    <div>
      <p className="label-mono text-text-2">
        Your seats · {reservation.seats.length}
      </p>
      <ul className="mt-4 border-t border-rule">
        {reservation.seats.map((seat) => (
          <li key={seat.id} className="flex items-baseline justify-between gap-6 border-b border-rule py-4">
            <div className="min-w-0">
              <p className="text-[17px] font-medium tracking-[-0.02em] text-text">
                Row {seat.row}, seat {seat.number}
                <span className="label-mono ml-3 text-text-2">{seatCode(seat)}</span>
              </p>
              <p className="label-mono mt-1 text-text-2">
                {sections.size > 1 ? `${formatCategory(seat.section)} · ` : ''}
                {formatCategory(seat.category)}
              </p>
            </div>
            <p className="font-mono text-[15px] text-text">{formatPaise(seat.pricePaise)}</p>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-6 pt-5">
        <p className="label-mono text-text-2">Total</p>
        <p className="text-title font-medium text-text">{formatPaise(reservation.totalPricePaise)}</p>
      </div>
    </div>
  );
}

type ReleaseState = 'idle' | 'confirm' | 'releasing';

/** /reservations/:reservationId (?event=<eventId> for the header): the countdown and next steps. */
export function ReservationPage() {
  const { reservationId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useReservation(reservationId);
  const reservation = query.data;

  const eventParam = searchParams.get('event') ?? '';
  const eventQuery = useEventDetail(eventParam);
  const eventShow = reservation ? eventQuery.data?.shows.find((s) => s.id === reservation.showId) : undefined;
  const event = eventShow ? eventQuery.data : undefined;
  // Without the event, the seat map still gives the show's start time (one request, no polling).
  const fallbackMap = useSeatMap(reservation?.showId ?? '', { paused: true, enabled: !!reservation && !eventParam });
  const startsAt = eventShow?.starts_at ?? fallbackMap.data?.show.startsAt;

  const [expiredHere, setExpiredHere] = useState(false);
  const [release, setRelease] = useState<ReleaseState>('idle');
  const [releaseError, setReleaseError] = useState<string | null>(null);

  useEffect(() => {
    document.title = event ? `Your hold · ${event.title} · FlashSeat` : 'Your hold · FlashSeat';
  }, [event]);

  if (query.isError && isNotFound(query.error)) return <HoldNotFound />;

  if (query.isPending) {
    return (
      <section aria-busy="true" className="pt-32 pb-28">
        <p className="sr-only" role="status">
          Loading your hold
        </p>
        <Container aria-hidden="true">
          <div className="h-4 w-40 bg-text/[0.07] motion-safe:animate-breathe" />
          <div className="mt-6 h-12 w-2/3 max-w-xl bg-text/[0.07] motion-safe:animate-breathe" />
          <div className="mt-10 h-28 w-80 bg-text/[0.07] motion-safe:animate-breathe" />
        </Container>
      </section>
    );
  }

  if (!reservation) {
    return (
      <section className="pt-40 pb-28">
        <Container>
          <HoldStatusPanel
            tone="error"
            role="alert"
            title="We couldn't load your hold right now."
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

  const eventSuffix = event ? `?event=${encodeURIComponent(event.id)}` : '';
  const seatMapUrl = `/shows/${reservation.showId}${eventSuffix}`;
  // The countdown reaching zero on the server clock means EXPIRED, even before a refetch says so.
  const status = reservation.status === 'ACTIVE' && expiredHere ? 'EXPIRED' : reservation.status;
  const metaLine = [startsAt ? formatShowDate(startsAt) : null, eventShow ? `${eventShow.venue_name} · ${eventShow.venue_city}` : null]
    .filter(Boolean)
    .join(' · ');

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

  return (
    <section aria-labelledby="hold-title" className="pt-28 pb-28 md:pt-32">
      <Container>
        <Link to={seatMapUrl} className="label-mono inline-block text-text-2 hover:text-lime">
          ← Seat map
        </Link>
        <p className="label-mono mt-6 text-text-2">Your hold</p>
        <h1 id="hold-title" className="mt-3 max-w-[24ch] text-section font-medium text-text">
          {event?.title ?? 'Your seats'}
        </h1>
        <p className="label-mono mt-4 min-h-4 text-text-2">{metaLine}</p>

        <div className="mt-12 grid gap-14 border-t border-rule pt-10 md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] md:gap-20">
          <div>
            {status === 'ACTIVE' && (
              <>
                <Countdown
                  expiresAt={reservation.expiresAt}
                  onExpire={() => {
                    setExpiredHere(true);
                    void query.refetch();
                  }}
                />
                <p className="mt-6 max-w-[44ch] text-text-2">
                  These seats are yours until the timer runs out. Check out before then to book them.
                </p>
                <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
                  <ButtonLink to={`/checkout/${reservation.id}${eventSuffix}`} size="lg">
                    Continue to checkout <Arrow />
                  </ButtonLink>
                  {release === 'idle' && (
                    <button
                      type="button"
                      onClick={() => setRelease('confirm')}
                      className="self-start px-1 py-2 text-[15px] text-text-2 underline decoration-text/25 underline-offset-4 hover:text-text sm:self-auto"
                    >
                      Release seats
                    </button>
                  )}
                </div>
                {release !== 'idle' && (
                  <HoldStatusPanel
                    className="mt-8"
                    tone="muted"
                    title="Release these seats?"
                    action={
                      <>
                        <Button size="sm" variant="secondary" onClick={() => void onRelease()} disabled={release === 'releasing'}>
                          {release === 'releasing' ? 'Releasing…' : 'Yes, release them'}
                        </Button>
                        <Button size="sm" onClick={() => setRelease('idle')} disabled={release === 'releasing'}>
                          Keep my seats
                        </Button>
                      </>
                    }
                  >
                    Anyone will be able to take them straight away.
                  </HoldStatusPanel>
                )}
              </>
            )}

            {status === 'EXPIRED' && (
              <HoldStatusPanel
                tone="muted"
                title="Your hold has expired."
                action={
                  <ButtonLink to={seatMapUrl}>
                    Back to the seat map <Arrow />
                  </ButtonLink>
                }
              >
                The seats went back on sale. They may still be free.
              </HoldStatusPanel>
            )}
            {status === 'RELEASED' && (
              <HoldStatusPanel
                tone="muted"
                title="You released these seats."
                action={
                  <ButtonLink to={seatMapUrl}>
                    Back to the seat map <Arrow />
                  </ButtonLink>
                }
              >
                They are back on sale for everyone.
              </HoldStatusPanel>
            )}
            {status === 'CONFIRMED' && (
              <HoldStatusPanel
                title="Already booked."
                action={
                  <ButtonLink to="/bookings">
                    Your bookings <Arrow />
                  </ButtonLink>
                }
              >
                These seats are yours. Your tickets are in your bookings.
              </HoldStatusPanel>
            )}

            {releaseError && (
              <p role="alert" className="mt-6 text-[15px] text-danger">
                {releaseError}
              </p>
            )}
          </div>

          <SeatList reservation={reservation} />
        </div>
      </Container>
    </section>
  );
}
