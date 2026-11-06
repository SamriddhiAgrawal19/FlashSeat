import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import '../components/booking/booking.css';
import { HoldStatusPanel } from '../components/booking/HoldStatusPanel';
import { BookingStatusPill } from '../components/booking/StatusPill';
import { useEventPhoto } from '../components/booking/useEventPhoto';
import { AccentButton, Arrow, DateBlock, Eyebrow, GhostButton, PrimaryButton } from '../components/site/ui';
import type { Booking } from '../lib/api';
import { serverNow } from '../lib/booking/serverClock';
import { formatPaise, showDateParts } from '../lib/format';
import { useMyBookings } from '../lib/queries';

type Tab = 'upcoming' | 'pending' | 'past' | 'cancelled';

const TABS: Array<{ id: Tab; label: string; empty: string }> = [
  { id: 'upcoming', label: 'Upcoming', empty: 'No upcoming events yet.' },
  { id: 'pending', label: 'Pending', empty: 'Nothing waiting for payment.' },
  { id: 'past', label: 'Past', empty: 'No past events yet.' },
  { id: 'cancelled', label: 'Cancelled', empty: 'Nothing cancelled.' },
];

const CLOSED = new Set<Booking['status']>(['EXPIRED', 'CANCELLED', 'PAYMENT_FAILED', 'REFUND_PENDING', 'REFUNDED']);

function tabOf(booking: Booking, now: number): Tab {
  if (booking.status === 'PENDING_PAYMENT') return 'pending';
  if (CLOSED.has(booking.status)) return 'cancelled';
  return Date.parse(booking.show.startsAt) > now ? 'upcoming' : 'past';
}

function isTab(value: string | null): value is Tab {
  return TABS.some((t) => t.id === value);
}

function payable(booking: Booking, now: number): boolean {
  return booking.status === 'PENDING_PAYMENT' && !!booking.payBefore && Date.parse(booking.payBefore) > now;
}

function BookingRow({ booking, now }: { booking: Booking; now: number }) {
  const parts = showDateParts(booking.show.startsAt);
  const seats = booking.seats.length;
  const { photo, onError } = useEventPhoto(booking.event);
  return (
    <li className="mb-row">
      <DateBlock iso={booking.show.startsAt} className="mb-date" />
      <div className="mb-thumb">{photo && <img src={photo.src} alt="" loading="lazy" decoding="async" onError={onError} />}</div>

      <div className="mb-main">
        <span className="mb-when">
          {parts?.weekday} {parts?.day} {parts?.month} · {parts?.time}
        </span>
        <h2 className="mb-title">
          <Link to={`/bookings/${booking.id}`}>{booking.event.title}</Link>
        </h2>
        <span className="mb-venue">
          {booking.show.venue.name}, {booking.show.venue.city}
        </span>
        <span className="mb-meta">
          {seats} {seats === 1 ? 'SEAT' : 'SEATS'} · {formatPaise(booking.totalPaise)}
        </span>
      </div>

      <div className="mb-side">
        <BookingStatusPill status={booking.status} />
        {payable(booking, now) ? (
          <AccentButton to={`/pay/${booking.id}`} size="sm">
            Continue to payment <Arrow />
          </AccentButton>
        ) : (
          <Link to={`/bookings/${booking.id}`} className="mb-link site-arr-host">
            {booking.status === 'CONFIRMED' ? 'View tickets' : 'Details'} <Arrow />
          </Link>
        )}
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        Loading your bookings
      </p>
      <ul aria-hidden="true" className="mb-list">
        {[0, 1, 2].map((i) => (
          <li key={i} className="mb-row">
            <span className="site-skel" style={{ width: 48, height: 40 }} />
            <span className="site-skel mb-thumb" />
            <div className="mb-main">
              <span className="site-skel" style={{ width: 120, height: 10 }} />
              <span className="site-skel" style={{ width: '70%', height: 18 }} />
              <span className="site-skel" style={{ width: '40%', height: 12 }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** /bookings?tab=upcoming|pending|past|cancelled */
export function MyBookingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : 'upcoming';
  const query = useMyBookings();
  const now = serverNow();

  useEffect(() => {
    document.title = 'My bookings · FlashSeat';
  }, []);

  const groups: Record<Tab, Booking[]> = { upcoming: [], pending: [], past: [], cancelled: [] };
  for (const booking of query.data?.bookings ?? []) groups[tabOf(booking, now)].push(booking);
  // Soonest first for what's coming; everything else stays newest first (API order).
  groups.upcoming.sort((a, b) => Date.parse(a.show.startsAt) - Date.parse(b.show.startsAt));
  groups.past.sort((a, b) => Date.parse(b.show.startsAt) - Date.parse(a.show.startsAt));
  const list = groups[tab];
  const emptyText = TABS.find((t) => t.id === tab)?.empty ?? 'Nothing here yet.';

  return (
    <section aria-labelledby="bookings-title" className="bk-wrap mb-page bk-step-in">
      <Eyebrow>MY BOOKINGS</Eyebrow>
      <h1 id="bookings-title" className="bk-h1-lg">
        Your <span className="site-serif">nights out.</span>
      </h1>

      <div role="tablist" aria-label="Bookings" className="mb-tabs">
        {TABS.map((t) => {
          const active = t.id === tab;
          const count = query.data ? groups[t.id].length : null;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls="bookings-panel"
              onClick={() => setSearchParams(t.id === 'upcoming' ? {} : { tab: t.id })}
              className="site-chip mb-tab"
            >
              {t.label}
              {count !== null && <span className="mb-tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      <div id="bookings-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="mb-panel">
        {query.isPending ? (
          <ListSkeleton />
        ) : query.isError ? (
          <HoldStatusPanel
            tone="error"
            role="alert"
            title="We couldn't load your bookings right now."
            action={
              <GhostButton size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
                {query.isFetching ? 'Retrying…' : 'Try again'}
              </GhostButton>
            }
          >
            Check your connection, or try again in a moment.
          </HoldStatusPanel>
        ) : list.length === 0 ? (
          <div className="bk-card mb-empty">
            <p className="bk-h2">{emptyText}</p>
            <p className="bk-lede">Find something worth going to.</p>
            <PrimaryButton to="/events" size="lg">
              Browse events <Arrow />
            </PrimaryButton>
          </div>
        ) : (
          <ul className="mb-list">
            {list.map((booking) => (
              <BookingRow key={booking.id} booking={booking} now={now} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
