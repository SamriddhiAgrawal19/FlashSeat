import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router';
import '../components/booking/booking.css';
import { HoldStatusPanel } from '../components/booking/HoldStatusPanel';
import { BookingStatusPill } from '../components/booking/StatusPill';
import { Ticket } from '../components/booking/Ticket';
import { useEventPhoto, type EventPhoto } from '../components/booking/useEventPhoto';
import { AccentButton, Arrow, GhostButton, PrimaryButton } from '../components/site/ui';
import type { Booking } from '../lib/api';
import { paidWithRazorpay, refundCopy } from '../lib/booking/refundCopy';
import { serverNow } from '../lib/booking/serverClock';
import { cn } from '../lib/cn';
import { formatPaise, formatShowDate, formatShowDay, formatTime } from '../lib/format';
import { downloadIcs } from '../lib/ics';
import { isNotFound, useBooking, useShowDetail } from '../lib/queries';
import { BookingNotFound, PageSkeleton } from './PayPage';

function payableNow(booking: Booking): boolean {
  return booking.status === 'PENDING_PAYMENT' && !!booking.payBefore && Date.parse(booking.payBefore) > serverNow();
}

/** What a booking without live tickets means, and what to do next. */
function StatusNotice({ booking }: { booking: Booking }) {
  const eventLink = (
    <GhostButton to={`/events/${booking.event.id}`} size="sm">
      Back to the event <Arrow />
    </GhostButton>
  );
  switch (booking.status) {
    case 'PENDING_PAYMENT':
      return payableNow(booking) ? (
        <HoldStatusPanel
          title="Payment pending."
          action={
            <AccentButton to={`/pay/${booking.id}`} size="sm">
              Continue to payment <Arrow />
            </AccentButton>
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
    case 'REFUNDED': {
      const copy = refundCopy(booking)!;
      return (
        <HoldStatusPanel tone="muted" title={copy.title} action={booking.refund?.reason === 'HOLD_EXPIRED' ? eventLink : undefined}>
          {copy.body}
        </HoldStatusPanel>
      );
    }
    case 'CONFIRMED':
      return null;
  }
}

/** "Add to calendar": an .ics built in the browser from the show's start/end and the venue. */
function AddToCalendar({ booking }: { booking: Booking }) {
  const show = useShowDetail(booking.event.id, booking.show.id);
  const detail = show.data;
  const onClick = () => {
    if (!detail) return;
    const seats = booking.seats.map((s) => `${s.row}${s.number}`).join(', ');
    downloadIcs({
      uid: `${booking.id}@flashseat`,
      title: booking.event.title,
      startIso: detail.starts_at,
      endIso: detail.ends_at,
      location: [detail.venue_name, detail.venue_address].filter(Boolean).join(', '),
      description: `FlashSeat booking ${booking.id}. Seats: ${seats}.`,
    });
  };
  return (
    <PrimaryButton size="lg" className="bk-btn-cta" onClick={onClick} disabled={!detail} title={show.isError ? "The show's details couldn't be loaded." : undefined}>
      Add to calendar
    </PrimaryButton>
  );
}

const FAN = ['bk-fan-1', 'bk-fan-2', 'bk-fan-3'];

/** Right after paying: the first tickets fan in (the first one on top). */
function TicketFan({ booking, photo }: { booking: Booking; photo: EventPhoto | null }) {
  const fan = booking.seats.slice(0, 3);
  return (
    <div className={cn('bk-fan', `has-${fan.length}`)} aria-hidden="true">
      {[...fan].reverse().map((seat) => {
        const i = fan.indexOf(seat);
        return <Ticket key={seat.id} booking={booking} seat={seat} photo={photo} className={cn('bk-fan-card', FAN[i])} />;
      })}
    </div>
  );
}

function TicketList({ booking, photo, voided }: { booking: Booking; photo: EventPhoto | null; voided: boolean }) {
  return (
    <section aria-labelledby="tickets-title" className="bk-tickets">
      <h2 id="tickets-title" className="site-eyebrow">
        YOUR TICKETS · {booking.seats.length}
        {booking.status === 'CONFIRMED' ? ' · SHOW THE QR CODE AT THE DOOR' : ' · VOID'}
      </h2>
      <ol className="bk-ticket-grid">
        {booking.seats.map((seat) => (
          <li key={seat.id}>
            <Ticket booking={booking} seat={seat} photo={photo} void={voided} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** /bookings/:bookingId (?new=1 right after paying): the booking and one ticket per seat. */
export function BookingPage() {
  const { bookingId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const query = useBooking(bookingId);
  const booking = query.data;
  const isNew = searchParams.get('new') === '1';
  const { photo } = useEventPhoto(booking?.event);

  useEffect(() => {
    document.title = booking ? `${booking.status === 'CONFIRMED' ? 'Tickets' : 'Booking'} · ${booking.event.title} · FlashSeat` : 'Booking · FlashSeat';
  }, [booking]);

  if (query.isError && isNotFound(query.error)) return <BookingNotFound />;
  if (query.isPending) return <PageSkeleton label="Loading your booking" />;
  if (!booking) {
    return (
      <section className="bk-main bk-narrow">
        <HoldStatusPanel
          tone="error"
          role="alert"
          title="We couldn't load this booking right now."
          action={
            <GhostButton size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
              {query.isFetching ? 'Retrying…' : 'Try again'}
            </GhostButton>
          }
        >
          Check your connection, or try again in a moment.
        </HoldStatusPanel>
      </section>
    );
  }

  const voided = booking.status === 'REFUND_PENDING' || booking.status === 'REFUNDED';
  // A payment that arrived after the hold ended never became tickets: nothing to void.
  const showTickets = booking.status === 'CONFIRMED' || (voided && booking.refund?.reason !== 'HOLD_EXPIRED');
  const confirmed = booking.status === 'CONFIRMED';
  const count = booking.seats.length;

  if (isNew && confirmed) {
    return (
      <div className="bk-wrap">
        <section aria-labelledby="booking-title" className="bk-confirm bk-step-in">
          <div role="status" className="bk-confirm-text">
            <span className="bk-confirmed-label">BOOKING CONFIRMED</span>
            <h1 id="booking-title" className="bk-h1-going">
              You're <span className="site-serif">going.</span>
            </h1>
            <span aria-hidden="true" className="bk-drawline" />
            <p className="bk-lede">
              {count} {count === 1 ? 'ticket' : 'tickets'} for {booking.event.title}, {formatShowDay(booking.show.startsAt)} at {formatTime(booking.show.startsAt)}. Show
              the code at the door.
            </p>
            <div className="bk-actions">
              <AddToCalendar booking={booking} />
              <GhostButton to="/bookings" size="lg" className="bk-btn-cta">
                My bookings
              </GhostButton>
            </div>
          </div>
          <TicketFan booking={booking} photo={photo} />
        </section>
        <TicketList booking={booking} photo={photo} voided={false} />
      </div>
    );
  }

  return (
    <div className="bk-wrap bk-step-in">
      <section aria-labelledby="booking-title" className="bk-booking-head">
        <GhostButton to="/bookings" size="sm" className="bk-back">
          ← My bookings
        </GhostButton>
        <div className="bk-booking-status">
          <BookingStatusPill status={booking.status} />
          <span className="site-eyebrow">
            BOOKING <span className="bk-id">{booking.id}</span>
          </span>
          {paidWithRazorpay(booking) && <span className="bk-paidwith">Paid with Razorpay</span>}
        </div>
        <h1 id="booking-title" className="bk-h1-lg">
          {booking.event.title}
        </h1>
        <dl className="bk-facts">
          <div>
            <dt>DATE &amp; TIME</dt>
            <dd>{formatShowDate(booking.show.startsAt)}</dd>
          </div>
          <div>
            <dt>VENUE</dt>
            <dd>
              {booking.show.venue.name}, {booking.show.venue.city}
            </dd>
          </div>
          <div>
            <dt>SEATS</dt>
            <dd>{count}</dd>
          </div>
          <div>
            <dt>TOTAL</dt>
            <dd>{formatPaise(booking.totalPaise)}</dd>
          </div>
        </dl>
        {confirmed && (
          <div className="bk-actions">
            <AddToCalendar booking={booking} />
          </div>
        )}
        {!confirmed && <StatusNotice booking={booking} />}
      </section>

      {showTickets && <TicketList booking={booking} photo={photo} voided={voided} />}
    </div>
  );
}
