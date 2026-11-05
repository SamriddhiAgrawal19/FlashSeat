import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { HoldStatusPanel } from '../components/booking/HoldStatusPanel';
import { StatusPill } from '../components/booking/StatusPill';
import { Ticket } from '../components/booking/Ticket';
import { Arrow, Button, ButtonLink } from '../components/ui/Button';
import { Container } from '../components/ui/Container';
import { Accent } from '../components/ui/Section';
import type { Booking } from '../lib/api';
import { serverNow } from '../lib/booking/serverClock';
import { formatPaise, formatShowDate, formatTime } from '../lib/format';
import { isNotFound, useBooking } from '../lib/queries';
import { BookingNotFound, PageSkeleton } from './PayPage';

/** "You're going." right after payment: a lime rule draws across once (static with reduced motion). */
function SuccessMoment({ title }: { title: string }) {
  return (
    <div role="status" className="mb-14 md:mb-20">
      <p className="label-mono text-text-2">Payment confirmed</p>
      <p className="mt-4 text-hero font-medium text-text">
        You&apos;re <Accent>going.</Accent>
      </p>
      <p className="mt-4 max-w-[40ch] text-title text-text-2">{title}</p>
      <div aria-hidden="true" className="mt-10 h-px w-full bg-rule">
        <div className="h-px w-full origin-left bg-lime motion-safe:animate-[draw-line_1.2s_cubic-bezier(0.2,0.7,0.1,1)_both]" />
      </div>
    </div>
  );
}

function payableNow(booking: Booking): boolean {
  return booking.status === 'PENDING_PAYMENT' && !!booking.payBefore && Date.parse(booking.payBefore) > serverNow();
}

/** What a booking without live tickets means, and what to do next. */
function StatusNotice({ booking }: { booking: Booking }) {
  const eventLink = (
    <ButtonLink to={`/events/${booking.event.id}`} variant="secondary">
      Back to the event <Arrow />
    </ButtonLink>
  );
  switch (booking.status) {
    case 'PENDING_PAYMENT':
      return payableNow(booking) ? (
        <HoldStatusPanel
          title="Payment pending."
          action={
            <ButtonLink to={`/pay/${booking.id}`}>
              Continue to payment <Arrow />
            </ButtonLink>
          }
        >
          Your seats are held until {formatTime(booking.payBefore ?? '')}. Pay before then to get your tickets.
        </HoldStatusPanel>
      ) : (
        <HoldStatusPanel tone="muted" title="Your hold expired before payment." action={eventLink}>
          No tickets were issued and nothing was charged.
        </HoldStatusPanel>
      );
    case 'EXPIRED':
      return (
        <HoldStatusPanel tone="muted" title="This booking expired before payment." action={eventLink}>
          No tickets were issued and nothing was charged.
        </HoldStatusPanel>
      );
    case 'CANCELLED':
      return (
        <HoldStatusPanel tone="muted" title="This booking was cancelled." action={eventLink}>
          The seats were released. No tickets were issued and nothing was charged.
        </HoldStatusPanel>
      );
    case 'PAYMENT_FAILED':
      return (
        <HoldStatusPanel tone="error" title="The payment did not go through." action={eventLink}>
          No tickets were issued and nothing was charged.
        </HoldStatusPanel>
      );
    case 'REFUND_PENDING':
      return (
        <HoldStatusPanel tone="muted" title="This event was cancelled. Your refund is being processed.">
          These tickets are no longer valid.
        </HoldStatusPanel>
      );
    case 'REFUNDED':
      return (
        <HoldStatusPanel tone="muted" title="This event was cancelled. Your payment has been refunded.">
          These tickets are no longer valid.
        </HoldStatusPanel>
      );
    case 'CONFIRMED':
      return null;
  }
}

/** /bookings/:bookingId (?new=1 right after paying): the booking and one ticket per seat. */
export function BookingPage() {
  const { bookingId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const query = useBooking(bookingId);
  const booking = query.data;
  const isNew = searchParams.get('new') === '1';

  useEffect(() => {
    document.title = booking ? `${booking.status === 'CONFIRMED' ? 'Tickets' : 'Booking'} · ${booking.event.title} · FlashSeat` : 'Booking · FlashSeat';
  }, [booking]);

  if (query.isError && isNotFound(query.error)) return <BookingNotFound />;
  if (query.isPending) return <PageSkeleton label="Loading your booking" />;
  if (!booking) {
    return (
      <section className="pt-40 pb-28">
        <Container>
          <HoldStatusPanel
            tone="error"
            role="alert"
            title="We couldn't load this booking right now."
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

  const voided = booking.status === 'REFUND_PENDING' || booking.status === 'REFUNDED';
  const showTickets = booking.status === 'CONFIRMED' || voided;

  return (
    <section aria-labelledby="booking-title" className="pt-28 pb-28 md:pt-32">
      <Container>
        <Link to="/bookings" className="label-mono inline-block text-text-2 hover:text-lime">
          ← My bookings
        </Link>

        <div className="mt-8">
          {isNew && booking.status === 'CONFIRMED' && <SuccessMoment title={booking.event.title} />}

          <div className="flex flex-wrap items-center gap-4">
            <StatusPill status={booking.status} />
            <p className="label-mono text-text-3">
              Booking <span className="font-mono normal-case tracking-normal text-text-2">{booking.id}</span>
            </p>
          </div>
          <h1 id="booking-title" className="mt-5 max-w-[24ch] text-section font-medium text-text">
            {booking.event.title}
          </h1>

          <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-y border-rule py-6 md:grid-cols-4">
            <div>
              <dt className="label-mono text-text-2">Date &amp; time</dt>
              <dd className="mt-1 text-text">{formatShowDate(booking.show.startsAt)}</dd>
            </div>
            <div>
              <dt className="label-mono text-text-2">Venue</dt>
              <dd className="mt-1 text-text">
                {booking.show.venue.name}, {booking.show.venue.city}
              </dd>
            </div>
            <div>
              <dt className="label-mono text-text-2">Seats</dt>
              <dd className="mt-1 text-text">{booking.seats.length}</dd>
            </div>
            <div>
              <dt className="label-mono text-text-2">Total</dt>
              <dd className="mt-1 text-text">{formatPaise(booking.totalPaise)}</dd>
            </div>
          </dl>
        </div>

        {booking.status !== 'CONFIRMED' && (
          <div className="mt-8">
            <StatusNotice booking={booking} />
          </div>
        )}

        {showTickets && (
          <div className="mt-14">
            <p className="label-mono text-text-2">
              {booking.seats.length} ticket{booking.seats.length === 1 ? '' : 's'}
              {booking.status === 'CONFIRMED' ? ' · Show the QR code at the door' : ' · Void'}
            </p>
            <ol className="mt-6 flex flex-col gap-6">
              {booking.seats.map((seat) => (
                <li key={seat.id}>
                  <Ticket booking={booking} seat={seat} void={voided} />
                </li>
              ))}
            </ol>
          </div>
        )}
      </Container>
    </section>
  );
}
