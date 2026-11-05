import { Link } from 'react-router';
import type { EventListItem } from '../../lib/api';
import { categoryLabel } from '../../lib/categories';
import { cn } from '../../lib/cn';
import { formatPaise, formatShowDay } from '../../lib/format';
import { PHOTOS, photosForEvents, type Photo } from '../../lib/photos';
import { Arrow, Button, ButtonLink } from '../ui/Button';
import { EventImage } from './EventImage';

// Desktop is two columns; the right column sits lower and image shapes alternate in a
// checkerboard (wide/tall, tall/wide), so the page reads as a layout, not a grid of clones.
const SHAPES = ['aspect-[4/3]', 'aspect-[4/5]', 'aspect-[4/5]', 'aspect-[4/3]'];
const listClass = 'grid gap-x-14 gap-y-16 pb-4 md:grid-cols-2 md:gap-y-24 md:pb-24 [&>li:nth-child(even)]:md:translate-y-20';

/** "SAT, 14 MAR · PUNE · FROM ₹600" from the list fields (next_show, min_price_paise). */
function metaLine(event: EventListItem): string {
  const next = event.next_show;
  return [
    categoryLabel(event.category),
    next ? formatShowDay(next.starts_at) : null,
    next?.venue.city ?? null,
    event.min_price_paise !== null ? `From ${formatPaise(event.min_price_paise)}` : null,
  ]
    .filter((p): p is string => Boolean(p))
    .join(' · ');
}

function EventTile({ event, index, photo }: { event: EventListItem; index: number; photo?: Photo }) {
  const more = event.upcoming_show_count - 1;
  return (
    <article className="group relative">
      <div className={cn('overflow-hidden rounded-[2px] bg-surface', SHAPES[index % SHAPES.length])}>
        <EventImage event={event} photo={photo} className="size-full object-cover transition-transform duration-[600ms] ease-out motion-safe:group-hover:scale-[1.04]" />
      </div>
      <p className="label-mono mt-5 text-text-2">{metaLine(event)}</p>
      <h2 className="mt-2.5 text-title font-medium text-text transition-colors group-hover:text-lime">
        <Link to={`/events/${event.id}`} className="rounded-[2px] after:absolute after:inset-0 after:content-['']">
          {event.title}
        </Link>
      </h2>
      {event.description && <p className="mt-2 line-clamp-2 max-w-[52ch] text-text-2">{event.description}</p>}
      {more > 0 && (
        <p className="label-mono mt-3 text-text">
          +{more} more date{more === 1 ? '' : 's'}
        </p>
      )}
    </article>
  );
}

export function EventList({ events }: { events: EventListItem[] }) {
  // Two columns: the card beside (i - 1) and the one above (i - 2) never share a photo.
  const photos = photosForEvents(events, 2);
  return (
    <ul className={listClass}>
      {events.map((event, i) => (
        <li key={event.id}>
          <EventTile event={event} index={i} photo={photos[i]} />
        </li>
      ))}
    </ul>
  );
}

const block = 'bg-text/[0.07] motion-safe:animate-breathe';

export function EventListSkeleton() {
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        Loading events
      </p>
      <ul aria-hidden="true" className={listClass}>
        {[0, 1, 2, 3].map((i) => (
          <li key={i}>
            <div className={cn(SHAPES[i], block)} />
            <div className={cn('mt-5 h-3 w-56', block)} />
            <div className={cn('mt-4 h-7 w-3/4', block)} />
            <div className={cn('mt-3 h-4 w-full', block)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EventsEmpty({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  const photo = PHOTOS.emptyAuditorium;
  return (
    <div className="grid items-center gap-8 border-y border-rule py-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12">
      <div className="aspect-[3/2] overflow-hidden rounded-[2px]">
        <img src={photo.src} width={photo.width} height={photo.height} alt={photo.alt} loading="lazy" decoding="async" className="size-full object-cover" />
      </div>
      <div>
        <p className="label-mono text-text-2">No results</p>
        <p className="mt-3 text-section font-medium text-text">Nothing matches that yet.</p>
        <p className="mt-4 max-w-[46ch] text-text-2">
          {hasFilters ? 'Try another city, category or date, or clear the filters to see everything on sale.' : 'No events are on sale right now. Check back soon.'}
        </p>
        {hasFilters ? (
          <Button className="mt-7" onClick={onClear}>
            Clear filters
          </Button>
        ) : (
          <ButtonLink to="/organizer" variant="secondary" className="mt-7">
            Host an event <Arrow />
          </ButtonLink>
        )}
      </div>
    </div>
  );
}

export function EventsError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div role="alert" className="flex flex-col gap-6 border-y border-rule py-8 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-title font-medium text-text">We couldn't load events right now.</p>
        <p className="mt-1.5 text-text-2">Check your connection, or try again in a moment.</p>
      </div>
      <Button variant="secondary" onClick={onRetry} disabled={retrying} className="shrink-0">
        {retrying ? 'Retrying…' : 'Try again'}
      </Button>
    </div>
  );
}

/** "Showing 1–20 of 47" plus Previous / Next. */
export function Pagination({
  page,
  limit,
  total,
  count,
  onPage,
  busy,
}: {
  page: number;
  limit: number;
  total: number;
  count: number;
  onPage: (page: number) => void;
  busy: boolean;
}) {
  const first = (page - 1) * limit + 1;
  const last = (page - 1) * limit + count;
  const lastPage = Math.max(1, Math.ceil(total / limit));
  return (
    <nav aria-label="Pagination" className="mt-16 flex flex-col gap-5 border-t border-rule pt-6 sm:flex-row sm:items-center sm:justify-between">
      <p className="label-mono text-text-2" aria-live="polite">
        {count > 0 ? `Showing ${first}–${last} of ${total}` : `Page ${page} of ${lastPage}`}
      </p>
      <div className="flex gap-3">
        <Button variant="secondary" size="sm" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
          <span aria-hidden="true">←</span> Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= lastPage || busy} onClick={() => onPage(page + 1)}>
          Next <span aria-hidden="true">→</span>
        </Button>
      </div>
    </nav>
  );
}
