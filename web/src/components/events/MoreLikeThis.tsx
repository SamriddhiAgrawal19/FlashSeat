import { Link } from 'react-router';
import type { EventListItem } from '../../lib/api';
import { categoryLabel } from '../../lib/categories';
import { showDateParts } from '../../lib/format';
import { photosForEvents } from '../../lib/photos';
import { useMoreLikeThis } from '../../lib/queries';
import { EventCard } from './EventResults';

/** "THEATRE · FRI 27 NOV · PUNE" */
function meta(event: EventListItem): string {
  const next = event.next_show;
  const p = next ? showDateParts(next.starts_at) : null;
  return [categoryLabel(event.category), p ? `${p.weekday} ${p.day} ${p.month}` : null, next?.venue.city ?? null]
    .filter(Boolean)
    .join(' · ')
    .toUpperCase();
}

/** Up to 3 other upcoming events in the same category (GET /events?category=&limit=4). Hidden if none. */
export function MoreLikeThis({ eventId, category }: { eventId: string; category: string }) {
  const { data } = useMoreLikeThis(category);
  const events = (data?.events ?? []).filter((e) => e.id !== eventId).slice(0, 3);
  if (events.length === 0) return null;
  const photos = photosForEvents(events, 3);
  const label = categoryLabel(category);

  return (
    <section className="site-wrap ed-more" aria-labelledby="more-title">
      <div className="ed-more-head">
        <h2 id="more-title" className="ev-h2">
          More like this
        </h2>
        <Link to={`/events?category=${encodeURIComponent(category)}`} className="site-navl site-arr-host" style={{ fontSize: 14 }}>
          All {label.toLowerCase()} <span className="site-arr">→</span>
        </Link>
      </div>
      <ul className="ev-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))' }}>
        {events.map((event, i) => (
          <li key={event.id}>
            <EventCard event={event} photo={photos[i]} meta={meta(event)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
