import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { HoldStatusPanel } from '../components/booking/HoldStatusPanel';
import { StatusPill } from '../components/booking/StatusPill';
import { Arrow, Button, ButtonLink } from '../components/ui/Button';
import { Container } from '../components/ui/Container';
import { Accent } from '../components/ui/Section';
import type { Booking } from '../lib/api';
import { serverNow } from '../lib/booking/serverClock';
import { cn } from '../lib/cn';
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
  return (
    <li className="relative grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-5 gap-y-4 border-b border-rule py-6 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:gap-x-8">
      <div className="text-center" aria-hidden="true">
        <p className="text-[2.75rem] leading-none font-medium tracking-[-0.05em] text-text">{parts?.day}</p>
        <p className="label-mono mt-1.5 text-text-2">{parts?.month}</p>
      </div>

      <div className="min-w-0">
        <p className="label-mono text-text-2">
          {parts?.weekday} · {parts?.time}
        </p>
        <h2 className="mt-1.5 truncate text-[19px] font-medium tracking-[-0.02em] text-text">
          <Link to={`/bookings/${booking.id}`} className="hover:text-lime">
            {booking.event.title}
          </Link>
        </h2>
        <p className="mt-1 truncate text-[15px] text-text-2">
          {booking.show.venue.name}, {booking.show.venue.city}
        </p>
        <p className="label-mono mt-2 text-text">
          {seats} seat{seats === 1 ? '' : 's'} · {formatPaise(booking.totalPaise)}
        </p>
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-1 sm:flex-col sm:items-end">
        <StatusPill status={booking.status} />
        {payable(booking, now) ? (
          <ButtonLink to={`/pay/${booking.id}`} size="sm">
            Continue to payment <Arrow />
          </ButtonLink>
        ) : (
          <Link to={`/bookings/${booking.id}`} className="label-mono text-text-2 hover:text-lime">
            {booking.status === 'CONFIRMED' ? 'View tickets →' : 'Details →'}
          </Link>
        )}
      </div>
    </li>
  );
}

function ListSkeleton() {
  const block = 'bg-text/[0.07] motion-safe:animate-breathe';
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        Loading your bookings
      </p>
      <ul aria-hidden="true" className="border-t border-rule">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-8 border-b border-rule py-6">
            <div className={`size-16 ${block}`} />
            <div className="flex-1">
              <div className={`h-3 w-32 ${block}`} />
              <div className={`mt-3 h-5 w-2/3 ${block}`} />
              <div className={`mt-3 h-3 w-1/3 ${block}`} />
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
    <section aria-labelledby="bookings-title" className="pt-28 pb-28 md:pt-32">
      <Container>
        <p className="label-mono text-text-2">Your account</p>
        <h1 id="bookings-title" className="mt-4 text-section font-medium text-text">
          My <Accent>bookings.</Accent>
        </h1>

        <div role="tablist" aria-label="Bookings" className="no-scrollbar mt-10 -mx-4 flex overflow-x-auto border-b border-rule px-4 md:mx-0 md:px-0">
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
                className={cn(
                  '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-[15px] transition-colors first:pl-0',
                  active ? 'border-lime text-text' : 'border-transparent text-text-2 hover:text-text',
                )}
              >
                {t.label}
                {count !== null && <span className="label-mono text-text-3">{count}</span>}
              </button>
            );
          })}
        </div>

        <div id="bookings-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-2">
          {query.isPending ? (
            <ListSkeleton />
          ) : query.isError ? (
            <HoldStatusPanel
              className="mt-8"
              tone="error"
              role="alert"
              title="We couldn't load your bookings right now."
              action={
                <Button variant="secondary" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
                  {query.isFetching ? 'Retrying…' : 'Try again'}
                </Button>
              }
            >
              Check your connection, or try again in a moment.
            </HoldStatusPanel>
          ) : list.length === 0 ? (
            <div className="border-b border-rule py-14">
              <p className="text-title font-medium text-text">{emptyText}</p>
              <p className="mt-2 text-text-2">Find something worth going to.</p>
              <ButtonLink to="/events" variant="secondary" className="mt-7">
                Browse events <Arrow />
              </ButtonLink>
            </div>
          ) : (
            <ul>
              {list.map((booking) => (
                <BookingRow key={booking.id} booking={booking} now={now} />
              ))}
            </ul>
          )}
        </div>
      </Container>
    </section>
  );
}
