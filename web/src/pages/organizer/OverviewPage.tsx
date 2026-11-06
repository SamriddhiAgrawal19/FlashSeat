import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EventsTable, isStatusFilter, StatusChips, type StatusFilter } from '../../components/organizer/EventsTable';
import { Action, ActionLink, Arr, InlineAlert, PageHeader, Skeleton } from '../../components/organizer/ui';
import type { OrganizerEvent, OrganizerShow } from '../../lib/api';
import { displayName, useAuth } from '../../lib/auth/useAuth';
import { formatShowDay, formatTime, showDateParts } from '../../lib/format';
import { formatCount, greeting, isUpcoming } from '../../lib/organizer';
import { useMyEvents } from '../../lib/organizerQueries';

const STEPS = [
  { title: 'Add a venue', body: 'Name, address and city, then lay out its seats.' },
  { title: 'Create the event', body: 'Title, category and a short description. It starts as a draft.' },
  { title: 'Schedule shows', body: 'Pick a venue and time, and price each seat category.' },
  { title: 'Publish', body: 'The event goes live on FlashSeat and tickets go on sale.' },
];

function FirstEvent() {
  return (
    <section aria-labelledby="first-title" className="og-card og-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="og-eyebrow">GET STARTED</span>
        <h2 id="first-title" className="og-card-title" style={{ fontSize: 22, letterSpacing: '-0.03em' }}>
          Create your first event
        </h2>
        <p className="og-sub">Venue → event → shows → publish. Four steps from an empty account to tickets on sale.</p>
      </div>
      <ol className="og-steps">
        {STEPS.map((step, i) => (
          <li key={step.title} className="og-step" style={{ animationDelay: `${(0.07 * i).toFixed(2)}s` }}>
            <span className="og-step-n">{String(i + 1).padStart(2, '0')} — STEP</span>
            <p className="og-step-title">{step.title}</p>
            <p className="og-step-body">{step.body}</p>
          </li>
        ))}
      </ol>
      <div className="og-head-actions">
        <ActionLink to="/organizer/venues/new" tone="primary">
          Add a venue <Arr />
        </ActionLink>
        <ActionLink to="/organizer/events/new">New event</ActionLink>
      </div>
    </section>
  );
}

interface UpcomingShow {
  show: OrganizerShow;
  event: OrganizerEvent;
}

/** KPI cards from GET /events/mine only. "—" when there is nothing to compute. */
function Kpis({ events, upcoming }: { events: OrganizerEvent[]; upcoming: UpcomingShow[] }) {
  const count = (s: OrganizerEvent['status']) => events.filter((e) => e.status === s).length;
  const booked = upcoming.reduce((n, u) => n + u.show.seats_booked, 0);
  const total = upcoming.reduce((n, u) => n + u.show.seats_total, 0);
  const next = upcoming[0];
  const items = [
    { label: 'LIVE EVENTS', value: formatCount(count('PUBLISHED')), sub: `${count('DRAFT')} draft · ${count('CANCELLED')} cancelled` },
    { label: 'UPCOMING SHOWS', value: formatCount(upcoming.length), sub: next ? `next: ${formatShowDay(next.show.starts_at)}` : 'nothing scheduled' },
    { label: 'SEATS SOLD', value: upcoming.length > 0 ? formatCount(booked) : '—', sub: 'across all upcoming shows' },
    { label: 'AVERAGE FILL', value: total > 0 ? `${Math.round((booked / total) * 100)}%` : '—', sub: 'booked ÷ total seats' },
  ];
  return (
    <dl className="og-kpis">
      {items.map((k, i) => (
        <div key={k.label} className="og-kpi" style={{ animationDelay: `${(0.07 * i).toFixed(2)}s` }}>
          <dt className="og-kpi-label">{k.label}</dt>
          <dd className="og-kpi-value" style={{ margin: 0 }}>
            {k.value}
          </dd>
          <dd className="og-kpi-sub" style={{ margin: 0 }}>
            {k.sub}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ComingUp({ upcoming }: { upcoming: UpcomingShow[] }) {
  return (
    <section aria-labelledby="coming-title" className="og-card og-up-card">
      <div className="og-up-head">
        <h2 id="coming-title" className="og-card-title">
          Coming up
        </h2>
        <span className="og-live">
          <i aria-hidden="true" />
          LIVE
        </span>
      </div>
      {upcoming.length === 0 ? (
        <p className="og-sub" style={{ padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          No upcoming shows.
        </p>
      ) : (
        <ul className="og-list">
          {upcoming.slice(0, 5).map(({ show, event }) => {
            const p = showDateParts(show.starts_at);
            return (
              <li key={show.id} className="og-up">
                <span className="og-date" aria-hidden="true">
                  <span className="og-date-day">{p?.day.padStart(2, '0')}</span>
                  <span className="og-date-mon">{p?.month.toUpperCase()}</span>
                </span>
                <span className="og-up-text">
                  <Link to={`/organizer/events/${event.id}`} className="og-up-title">
                    {event.title}
                  </Link>
                  <span className="og-up-when">
                    {p?.weekday} · {formatTime(show.starts_at)} · {show.venue_city}
                    <span className="sr-only"> · {formatShowDay(show.starts_at)}</span>
                  </span>
                </span>
                <span className="og-up-sold" aria-label={`${show.seats_booked} of ${show.seats_total} seats booked`}>
                  {formatCount(show.seats_booked)}/{formatCount(show.seats_total)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" className="og-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <p className="sr-only" role="status">
        Loading events
      </p>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Skeleton style={{ width: 44, height: 44, borderRadius: 10 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton style={{ width: '50%', height: 14 }} />
            <Skeleton style={{ width: '30%', height: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** "Good evening, Kabir." with the last word in Instrument Serif italic coral. */
function Greeting({ name }: { name: string | null }) {
  const words = `${greeting()}${name ? `, ${name}.` : '.'}`.split(' ');
  const last = words.pop();
  return (
    <>
      {words.join(' ')} <span className="site-serif">{last}</span>
    </>
  );
}

/** /organizer (overview with greeting, KPIs and "Coming up") and /organizer/events (the list alone). */
export function OverviewPage({ view = 'overview' }: { view?: 'overview' | 'events' }) {
  const { user } = useAuth();
  const query = useMyEvents();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status');
  const filter: StatusFilter = isStatusFilter(statusParam) ? statusParam : 'ALL';
  const now = Date.now();

  useEffect(() => {
    document.title = view === 'events' ? 'Events · Organizer · FlashSeat' : 'Organizer · FlashSeat';
  }, [view]);

  const events = query.data ?? [];
  const visible = useMemo(() => (filter === 'ALL' ? events : events.filter((e) => e.status === filter)), [events, filter]);
  const upcoming = useMemo(
    () =>
      events
        .flatMap((event) => event.shows.filter((s) => isUpcoming(s, now)).map((show) => ({ show, event })))
        .sort((a, b) => Date.parse(a.show.starts_at) - Date.parse(b.show.starts_at)),
    // `now` changes every render; the list only needs to follow the data.
    [events],
  );

  const actions = (
    <>
      {view === 'overview' && <ActionLink to="/organizer/venues">Venues</ActionLink>}
      <ActionLink to="/organizer/events/new" tone="primary">
        New event <Arr />
      </ActionLink>
    </>
  );

  const list =
    events.length > 0 ? (
      <section aria-labelledby="events-heading" className="og-card is-clip">
        <div className="og-card-head">
          <h2 id="events-heading" className="og-card-title">
            {view === 'overview' ? 'Your events' : 'All events'}
          </h2>
          <span className="og-card-meta">
            {visible.length} {visible.length === 1 ? 'EVENT' : 'EVENTS'}
          </span>
        </div>
        {visible.length === 0 ? <p className="og-empty-list">No {filter.toLowerCase()} events.</p> : <EventsTable events={visible} now={now} />}
      </section>
    ) : null;

  const chips = <StatusChips events={events} value={filter} onChange={(v) => setParams(v === 'ALL' ? {} : { status: v }, { replace: true })} />;

  return (
    <div className="og-view">
      {view === 'overview' ? (
        <PageHeader eyebrow="OVERVIEW" title={<Greeting name={user ? displayName(user) : null} />} actions={actions} />
      ) : (
        <PageHeader crumbs={[{ label: 'Overview', to: '/organizer' }, { label: 'Events' }]} title="Events" small actions={actions} />
      )}

      {query.isPending ? (
        <ListSkeleton />
      ) : query.isError ? (
        <InlineAlert>
          <p style={{ margin: 0 }}>We couldn't load your events.</p>
          <Action className="mt-3" small onClick={() => void query.refetch()} busy={query.isFetching}>
            Try again
          </Action>
        </InlineAlert>
      ) : events.length === 0 ? (
        <FirstEvent />
      ) : view === 'overview' ? (
        <>
          <Kpis events={events} upcoming={upcoming} />
          {chips}
          <div className="og-two">
            {list}
            <ComingUp upcoming={upcoming} />
          </div>
        </>
      ) : (
        <>
          {chips}
          {list}
        </>
      )}
    </div>
  );
}
