import { Link } from 'react-router';
import type { EventListItem } from '../../lib/api';
import { categoryLabel } from '../../lib/categories';
import { formatPaise, showDateParts } from '../../lib/format';
import { photosForEvents, type Photo } from '../../lib/photos';
import { useUpcomingEvents } from '../../lib/queries';
import { EventImage } from '../events/EventImage';
import { useReveal } from './hooks';

const CARD_COUNT = 3;

/**
 * The soonest upcoming events from the shared landing request. The API lists newest-created
 * first, so they are re-ordered by next show time to make "this week" mean what it says.
 */
function soonest(events: EventListItem[]): EventListItem[] {
  return events
    .filter((e) => e.next_show)
    .sort((a, b) => Date.parse(a.next_show!.starts_at) - Date.parse(b.next_show!.starts_at))
    .slice(0, CARD_COUNT);
}

/** "TUE 10 NOV · 8:00 PM · MUMBAI" */
function metaLine(event: EventListItem): string {
  const next = event.next_show;
  const parts = next ? showDateParts(next.starts_at) : null;
  return [parts ? `${parts.weekday} ${parts.day} ${parts.month}` : null, parts?.time ?? null, next?.venue.city ?? null]
    .filter(Boolean)
    .join(' · ')
    .toUpperCase();
}

function EventCard({ event, photo }: { event: EventListItem; photo?: Photo }) {
  return (
    <Link to={`/events/${event.id}`} className="lp-card">
      <span className="lp-card-img">
        <EventImage event={event} photo={photo} className="lp-img" />
        <span className="lp-card-cat">{categoryLabel(event.category).toUpperCase()}</span>
      </span>
      <span className="lp-card-body">
        <span className="lp-card-meta">{metaLine(event)}</span>
        <span className="lp-card-title">{event.title}</span>
        {/* The list has no seat counts, so the design's "selling" bar is left out rather than invented. */}
        {event.min_price_paise !== null && <span className="lp-card-price">from {formatPaise(event.min_price_paise)}</span>}
      </span>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="lp-card" aria-hidden="true">
      <span className="lp-card-img">
        <span className="lp-skel" style={{ position: 'absolute', inset: 0, borderRadius: 0 }} />
      </span>
      <span className="lp-card-body">
        <span className="lp-skel" style={{ width: '55%', height: 12 }} />
        <span className="lp-skel" style={{ width: '85%', height: 20 }} />
        <span className="lp-skel" style={{ width: '30%', height: 13, marginTop: 'auto' }} />
      </span>
    </div>
  );
}

function Body() {
  const { data, isPending, isError, refetch, isFetching } = useUpcomingEvents();

  if (isPending) {
    return (
      <ul className="lp-cards" aria-busy="true" aria-label="Loading events">
        {Array.from({ length: CARD_COUNT }, (_, i) => (
          <li key={i}>
            <SkeletonCard />
          </li>
        ))}
      </ul>
    );
  }

  if (isError) {
    return (
      <div className="lp-panel" role="alert">
        <span className="lp-panel-title">We couldn’t load events.</span>
        <p className="lp-panel-text">Something went wrong reaching FlashSeat. Check your connection and try again.</p>
        <button type="button" className="lp-panel-btn lp-btn-w" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? 'Trying…' : 'Try again'}
        </button>
      </div>
    );
  }

  const events = soonest(data.events);
  if (events.length === 0) {
    return (
      <div className="lp-panel">
        <span className="lp-panel-title">Nothing on sale right now.</span>
        <p className="lp-panel-text">New shows go on sale all the time. Check back soon, or put your own event on FlashSeat.</p>
        <Link to="/organizer" className="lp-btn lp-btn-g lp-btn-sm">
          Host an event <span className="lp-arr">→</span>
        </Link>
      </div>
    );
  }

  // A row of three: no two cards share a photo.
  const photos = photosForEvents(events, CARD_COUNT);
  return (
    <ul className="lp-cards">
      {events.map((event, i) => (
        <li key={event.id}>
          <EventCard event={event} photo={photos[i]} />
        </li>
      ))}
    </ul>
  );
}

export function ThisWeek() {
  const reveal = useReveal<HTMLElement>();
  return (
    <section ref={reveal.ref} className={`lp-wrap lp-week ${reveal.className}`} aria-labelledby="week-title">
      <div className="lp-head">
        <div className="lp-head-title">
          <span className="lp-eyebrow">ON SALE</span>
          <h2 id="week-title" className="lp-h2">
            Happening this week.
          </h2>
        </div>
        <Link to="/events" className="lp-btn lp-navl" style={{ fontSize: 14 }}>
          View all events <span className="lp-arr">→</span>
        </Link>
      </div>
      <Body />
    </section>
  );
}
