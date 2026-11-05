import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import '../components/events/events.css';
import { DatesPanel, duration, type ShowDetailState } from '../components/events/DatesPanel';
import { MoreLikeThis } from '../components/events/MoreLikeThis';
import { SeatsPrices } from '../components/events/SeatsPrices';
import { isUpcoming } from '../components/events/showState';
import { usePlayWhenVisible, useReducedMotion } from '../components/site/hooks';
import { AccentButton, Arrow, Eyebrow, GhostButton } from '../components/site/ui';
import type { EventDetail, EventShowSummary } from '../lib/api';
import { categoryLabel } from '../lib/categories';
import { cn } from '../lib/cn';
import { splitFirstSentence } from '../lib/eventGroups';
import { formatDateRange, formatPaise } from '../lib/format';
import { photoForEvent } from '../lib/photos';
import { isNotFound, useEventDetail, useShowDetails } from '../lib/queries';

function EventNotFound() {
  useEffect(() => {
    document.title = 'Event not found · FlashSeat';
  }, []);
  return (
    <section aria-labelledby="nf-title" className="site-wrap ed-nf">
      <Eyebrow>404</Eyebrow>
      <h1 id="nf-title" className="ev-h1">
        Event not <span className="site-serif">found.</span>
      </h1>
      <p className="ev-sub">This event doesn't exist or isn't on sale. It may have been removed, or the link may be wrong.</p>
      <GhostButton to="/events" size="lg">
        Browse events <Arrow />
      </GhostButton>
    </section>
  );
}

function DetailError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <section className="site-wrap ed-nf">
      <div role="alert" className="ev-panel" style={{ width: '100%' }}>
        <p className="ev-panel-title">We couldn't load this event right now.</p>
        <p className="ev-panel-text">Check your connection, or try again in a moment.</p>
        <GhostButton onClick={onRetry} disabled={retrying}>
          {retrying ? 'Retrying…' : 'Try again'}
        </GhostButton>
      </div>
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        Loading event
      </p>
      <div aria-hidden="true" className="ed-hero" style={{ background: 'var(--surface)' }}>
        <div className="site-wrap ed-hero-in">
          <span className="site-skel" style={{ width: 160, height: 12 }} />
          <span className="site-skel" style={{ width: '60%', height: 64 }} />
          <span className="site-skel" style={{ width: 360, maxWidth: '100%', height: 34 }} />
        </div>
      </div>
    </div>
  );
}

/** poster_url (if it loads) or the event's photo; Ken Burns pauses while the hero is off-screen. */
function HeroImage({ event }: { event: EventDetail }) {
  const [failed, setFailed] = useState(false);
  const { ref, playing } = usePlayWhenVisible<HTMLImageElement>();
  const usePoster = !!event.poster_url && !failed;
  const photo = photoForEvent(event);
  return (
    <img
      ref={ref}
      src={usePoster ? event.poster_url! : photo.src}
      width={usePoster ? undefined : photo.width}
      height={usePoster ? undefined : photo.height}
      alt={usePoster ? `Poster for ${event.title}` : photo.alt}
      onError={() => setFailed(true)}
      decoding="async"
      className={cn('ed-hero-img', !playing && 'site-paused')}
    />
  );
}

/** The title with each word revealed in turn; the last word in Instrument Serif italic coral. */
function Title({ title }: { title: string }) {
  const words = title.trim().split(/\s+/);
  return (
    <h1 id="event-title" className="ed-h1">
      {words.map((word, i) => (
        <span key={i}>
          <span className={cn('site-w', i === words.length - 1 && words.length > 1 && 'site-serif')} style={{ animationDelay: `${(0.05 + i * 0.06).toFixed(2)}s` }}>
            {word}
          </span>
          {i < words.length - 1 && ' '}
        </span>
      ))}
    </h1>
  );
}

function uniqueVenues(shows: EventShowSummary[]) {
  const seen = new Map<string, EventShowSummary>();
  for (const s of shows) {
    const key = `${s.venue.name}|${s.venue.city}`;
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

function Detail({ event }: { event: EventDetail }) {
  const reduced = useReducedMotion();
  const cancelled = event.status === 'CANCELLED';
  const shows = [...event.shows].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const upcoming = shows.filter((s) => isUpcoming(s));
  const next = upcoming[0] ?? shows[0];
  const detailQueries = useShowDetails(event.id, shows.map((s) => s.id));
  const details = new Map<string, ShowDetailState>(shows.map((s, i) => [s.id, { data: detailQueries[i]?.data, isError: detailQueries[i]?.isError ?? false }]));

  // Hero facts, all from real data.
  const venueShows = uniqueVenues(upcoming.length ? upcoming : shows);
  const first = upcoming[0];
  const last = upcoming[upcoming.length - 1];
  const datesFact = first && last ? `${upcoming.length} date${upcoming.length === 1 ? '' : 's'} · ${formatDateRange(first.starts_at, last.starts_at)}` : null;
  const venueFact = venueShows.length === 1 ? `${venueShows[0]!.venue.name}, ${venueShows[0]!.venue.city}` : venueShows.length > 1 ? 'Multiple venues' : null;
  const lengthFact = next ? duration(next.starts_at, next.ends_at) : null;
  const upcomingPrices = upcoming.flatMap((s) => details.get(s.id)?.data?.category_prices.map((p) => p.price_paise) ?? []);
  const fromFact = upcomingPrices.length ? `From ${formatPaise(Math.min(...upcomingPrices))}` : null;
  const [lead, rest] = event.description ? splitFirstSentence(event.description) : ['', ''];

  useEffect(() => {
    document.title = `${event.title} · FlashSeat`;
  }, [event.title]);

  const toDates = () => document.getElementById('dates')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });

  return (
    <>
      <section aria-labelledby="event-title" className="ed-hero">
        <HeroImage event={event} />
        <div className="ed-scrim" aria-hidden="true" />
        <div className="site-wrap ed-hero-in">
          <nav aria-label="Breadcrumb" className="site-fade">
            <ol className="ed-crumbs">
              <li>
                <Link to="/events">EXPLORE</Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link to={`/events?category=${encodeURIComponent(event.category)}`}>{categoryLabel(event.category).toUpperCase()}</Link>
              </li>
            </ol>
          </nav>
          <Title title={event.title} />
          {event.organization_name && (
            <p className="ed-by site-fade" style={{ animationDelay: '.3s' }}>
              by {event.organization_name}
            </p>
          )}
          <div className="ed-pills site-fade" style={{ animationDelay: '.4s' }}>
            {!cancelled && <span className="site-pill">{datesFact ?? 'No upcoming dates'}</span>}
            {venueFact && <span className="site-pill">{venueFact}</span>}
            {!cancelled && lengthFact && <span className="site-pill">{lengthFact}</span>}
            {!cancelled && fromFact && <span className="site-pill">{fromFact}</span>}
            {!cancelled && upcoming.length > 0 && (
              <AccentButton size="md" onClick={toDates} style={{ marginLeft: 6 }}>
                Choose seats <Arrow down />
              </AccentButton>
            )}
          </div>
        </div>
      </section>

      {cancelled && (
        <div className="site-wrap">
          <div role="status" className="ed-cancelled">
            <i className="site-pulse" aria-hidden="true" style={{ marginTop: 7, animation: 'none' }} />
            <div>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>This event has been cancelled.</p>
              <p style={{ margin: '4px 0 0', fontSize: 15, color: 'var(--text-2)' }}>Tickets for it are no longer on sale.</p>
            </div>
          </div>
        </div>
      )}

      <div className="site-wrap ed-main">
        <div className="ed-left">
          {lead && (
            <section className="ed-section" aria-labelledby="about-title">
              <h2 id="about-title" className="site-eyebrow" style={{ margin: 0 }}>
                About
              </h2>
              <p className="ed-lead">{lead}</p>
              {rest && <p className="ed-body">{rest}</p>}
            </section>
          )}

          {next && <SeatsPrices showId={next.id} detail={details.get(next.id)?.data} />}

          {venueShows.length > 0 && (
            <section className="ed-section" aria-labelledby="venue-title" style={{ gap: 14 }}>
              <h2 id="venue-title" className="site-eyebrow" style={{ margin: 0 }}>
                {venueShows.length > 1 ? 'Venues' : 'Venue'}
              </h2>
              {venueShows.map((s) => (
                <div key={s.id} className="ed-venue">
                  <span className="ed-venue-icon" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FAFAFA" strokeWidth="1.6">
                      <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
                      <circle cx="12" cy="10" r="2.5" />
                    </svg>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <span style={{ fontSize: 17, fontWeight: 500 }}>{s.venue.name}</span>
                    <span style={{ fontSize: 14, color: 'var(--text-2)' }}>
                      {s.venue.address ? (s.venue.address.toLowerCase().includes(s.venue.city.toLowerCase()) ? s.venue.address : `${s.venue.address}, ${s.venue.city}`) : s.venue.city}
                      {s.seats_total > 0 && ` · ${s.seats_total} seats`}
                    </span>
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>

        <DatesPanel event={event} details={details} />
      </div>

      <MoreLikeThis eventId={event.id} category={event.category} />
    </>
  );
}

/** /events/:eventId: GET /events/:eventId, then GET /events/:eventId/shows/:showId per show (prices, sales_open_at). */
export function EventDetailPage() {
  const { eventId = '' } = useParams();
  const query = useEventDetail(eventId);

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    if (isNotFound(query.error)) return <EventNotFound />;
    return <DetailError onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  return <Detail event={query.data} />;
}
