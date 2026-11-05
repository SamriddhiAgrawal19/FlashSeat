import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import type { EventListItem } from '../../lib/api';
import { categoryLabel } from '../../lib/categories';
import { cn } from '../../lib/cn';
import { bySoonest, groupEventsByDate, splitFirstSentence } from '../../lib/eventGroups';
import { formatPaise, formatShowDate } from '../../lib/format';
import { PHOTOS, photosForEvents, type Photo } from '../../lib/photos';
import { Arrow, DateBlock, Eyebrow, GhostButton, PrimaryButton } from '../site/ui';
import { EventImage } from './EventImage';

/** "SELLING FAST" only from real data: the next show has under half its seats left. */
export function isSellingFast(event: EventListItem): boolean {
  const next = event.next_show;
  return !!next && next.seats_total > 0 && next.seats_available > 0 && next.seats_available / next.seats_total < 0.5;
}

function where(event: EventListItem): string | null {
  const v = event.next_show?.venue;
  return v ? `${v.name}, ${v.city}` : null;
}

function moreDates(event: EventListItem): string {
  const more = event.upcoming_show_count - 1;
  return more > 0 ? `+${more} date${more === 1 ? '' : 's'}` : '';
}

/** One event as a card: photo + date block, category, title, venue, "from ₹X", "+N dates". */
export function EventCard({ event, photo, style, meta }: { event: EventListItem; photo?: Photo; style?: CSSProperties; meta?: string }) {
  return (
    <Link to={`/events/${event.id}`} className="ev-card" style={style}>
      <span className="ev-card-img">
        <EventImage event={event} photo={photo} className="ev-img" />
        {event.next_show && <DateBlock iso={event.next_show.starts_at} variant="overlay" className="ev-card-date" />}
      </span>
      <span className="ev-card-body">
        <span className="ev-card-cat">{meta ?? categoryLabel(event.category).toUpperCase()}</span>
        <span className="ev-card-title">{event.title}</span>
        {event.next_show && <span className="sr-only">{formatShowDate(event.next_show.starts_at)}</span>}
        {where(event) && <span className="ev-card-where">{where(event)}</span>}
        <span className="ev-card-foot">
          <span style={{ color: 'var(--text)' }}>{event.min_price_paise !== null ? `from ${formatPaise(event.min_price_paise)}` : 'Prices soon'}</span>
          <span style={{ color: 'var(--text-3)' }}>{moreDates(event)}</span>
        </span>
      </span>
    </Link>
  );
}

/** The soonest event on page 1, large: photo, kicker, title, first sentence, NEXT / WHERE / FROM. */
function FeaturedCard({ event, photo }: { event: EventListItem; photo?: Photo }) {
  const next = event.next_show;
  const [lede] = event.description ? splitFirstSentence(event.description) : [''];
  const dates = event.upcoming_show_count;
  return (
    <Link to={`/events/${event.id}`} className="ev-card ev-featured site-arr-host">
      <span className="ev-featured-img">
        <EventImage event={event} photo={photo} className="ev-img" />
        {isSellingFast(event) && <span className="ev-badge">SELLING FAST</span>}
      </span>
      <span className="ev-featured-body">
        <span className="ev-kicker">
          {categoryLabel(event.category).toUpperCase()} · {dates} DATE{dates === 1 ? '' : 'S'}
        </span>
        <span className="ev-featured-title">{event.title}</span>
        {lede && <span className="ev-featured-lede">{lede}</span>}
        <span className="ev-facts">
          {next && (
            <span className="ev-fact">
              <span className="ev-fact-label">NEXT</span>
              <span className="ev-fact-value">{formatShowDate(next.starts_at)}</span>
            </span>
          )}
          {where(event) && (
            <span className="ev-fact">
              <span className="ev-fact-label">WHERE</span>
              <span className="ev-fact-value">{where(event)}</span>
            </span>
          )}
          {event.min_price_paise !== null && (
            <span className="ev-fact">
              <span className="ev-fact-label">FROM</span>
              <span className="ev-fact-value">{formatPaise(event.min_price_paise)}</span>
            </span>
          )}
        </span>
        <span className="site-btn site-btn-primary site-btn-md" style={{ alignSelf: 'flex-start', marginTop: 8 }} aria-hidden="true">
          Choose seats <Arrow />
        </span>
      </span>
    </Link>
  );
}

/**
 * The results of one page: on page 1 the soonest event is featured on top, then the rest grouped
 * by next show date (This week / Later this month / per month). Photos never repeat between
 * neighbouring cards.
 */
export function EventResultsView({ events, featureFirst }: { events: EventListItem[]; featureFirst: boolean }) {
  const sorted = [...events].sort(bySoonest);
  const featured = featureFirst ? sorted[0] : undefined;
  const rest = featured ? sorted.slice(1) : sorted;
  const groups = groupEventsByDate(rest);
  // Photos in display order; a 4-wide window covers the cards beside and above (4 columns at most).
  const ordered = [...(featured ? [featured] : []), ...groups.flatMap((g) => g.events)];
  const photoList = photosForEvents(ordered, 4);
  const photoOf = new Map(ordered.map((e, i) => [e.id, photoList[i]]));

  return (
    <>
      {featured && <FeaturedCard event={featured} photo={photoOf.get(featured.id)} />}
      {groups.map((group) => (
        <section key={group.key} className="ev-group" aria-labelledby={`group-${group.key}`}>
          <div className="ev-group-head">
            <h2 id={`group-${group.key}`} className="ev-h2">
              {group.title}
            </h2>
            {group.range && <span className="ev-range">{group.range}</span>}
          </div>
          <ul className="ev-grid">
            {group.events.map((event, i) => (
              <li key={event.id}>
                <EventCard event={event} photo={photoOf.get(event.id)} style={{ animationDelay: `${(0.06 * i).toFixed(2)}s` }} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function SkeletonCard() {
  return (
    <div className="ev-card" aria-hidden="true" style={{ animation: 'none' }}>
      <span className="ev-card-img">
        <span className="site-skel" style={{ position: 'absolute', inset: 0, borderRadius: 0 }} />
      </span>
      <span className="ev-card-body">
        <span className="site-skel" style={{ width: '30%', height: 10 }} />
        <span className="site-skel" style={{ width: '85%', height: 18 }} />
        <span className="site-skel" style={{ width: '60%', height: 12 }} />
        <span className="site-skel" style={{ width: '35%', height: 12, marginTop: 12 }} />
      </span>
    </div>
  );
}

export function EventListSkeleton() {
  return (
    <div aria-busy="true" className="ev-group">
      <p className="sr-only" role="status">
        Loading events
      </p>
      <div className="ev-group-head" aria-hidden="true">
        <span className="site-skel" style={{ width: 160, height: 24 }} />
      </div>
      <ul className="ev-grid" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i}>
            <SkeletonCard />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EventsEmpty({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  const photo = PHOTOS.emptyAuditorium;
  return (
    <div className="ev-panel ev-panel-media">
      <img src={photo.src} width={photo.width} height={photo.height} alt={photo.alt} loading="lazy" decoding="async" />
      <div>
        <Eyebrow>No results</Eyebrow>
        <p className="ev-panel-title">Nothing matches that yet.</p>
        <p className="ev-panel-text">
          {hasFilters ? 'Try another city, category or date, or clear the filters to see everything on sale.' : 'No events are on sale right now. Check back soon.'}
        </p>
        {hasFilters ? (
          <PrimaryButton onClick={onClear}>Clear filters</PrimaryButton>
        ) : (
          <GhostButton to="/organizer">
            Host an event <Arrow />
          </GhostButton>
        )}
      </div>
    </div>
  );
}

/** Asked for a page past the end (e.g. after the list shrank). */
export function PageEmpty({ onFirstPage }: { onFirstPage: () => void }) {
  return (
    <div className="ev-panel">
      <p className="ev-panel-title">There's nothing on this page.</p>
      <GhostButton onClick={onFirstPage}>Go to the first page</GhostButton>
    </div>
  );
}

export function EventsError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div role="alert" className="ev-panel">
      <p className="ev-panel-title">We couldn't load events right now.</p>
      <p className="ev-panel-text">Check your connection, or try again in a moment.</p>
      <GhostButton onClick={onRetry} disabled={retrying}>
        {retrying ? 'Retrying…' : 'Try again'}
      </GhostButton>
    </div>
  );
}

/** "SHOWING 1–20 OF 47" plus Previous / Next. */
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
    <nav aria-label="Pagination" className={cn('ev-pager')}>
      <p className="ev-pager-label" aria-live="polite" style={{ margin: 0 }}>
        {count > 0 ? `SHOWING ${first}–${last} OF ${total}` : `PAGE ${page} OF ${lastPage}`}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <GhostButton size="sm" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
          <span aria-hidden="true">←</span> Previous
        </GhostButton>
        <GhostButton size="sm" disabled={page >= lastPage || busy} onClick={() => onPage(page + 1)}>
          Next <span aria-hidden="true">→</span>
        </GhostButton>
      </div>
    </nav>
  );
}
