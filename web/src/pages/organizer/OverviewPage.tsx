import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { EventsTable, isStatusFilter, StatusChips, type StatusFilter } from '../../components/organizer/EventsTable';
import { ActionLink, Action, InlineAlert, PageHeader, Skeleton } from '../../components/organizer/ui';
import type { OrganizerEvent } from '../../lib/api';
import { displayName, useAuth } from '../../lib/auth/useAuth';
import { formatCount, greeting, isUpcoming, seatTotals } from '../../lib/organizer';
import { useMyEvents } from '../../lib/organizerQueries';

const STEPS = [
  { title: 'Add a venue', body: 'Name, address and city, then lay out its seats.' },
  { title: 'Create the event', body: 'Title, category and a short description. It starts as a draft.' },
  { title: 'Schedule shows', body: 'Pick a venue and time, and price each seat category.' },
  { title: 'Publish', body: 'The event goes live on FlashSeat and tickets go on sale.' },
];

function FirstEvent() {
  return (
    <div className="border border-rule px-5 py-8 sm:px-8 sm:py-10">
      <h2 className="text-[1.375rem] font-medium tracking-[-0.03em] text-text">Create your first event</h2>
      <p className="mt-2 max-w-[34rem] text-[15px] text-text-2">Four steps from an empty account to tickets on sale.</p>
      <ol className="mt-8 grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <li key={step.title} className="bg-bg p-4">
            <p className="label-mono text-text-3">
              <span className={i === 0 ? 'text-lime' : undefined}>{String(i + 1).padStart(2, '0')}</span> — step
            </p>
            <p className="mt-3 text-[15px] font-medium text-text">{step.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-text-2">{step.body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-wrap gap-2">
        <ActionLink to="/organizer/venues/new" tone="primary">
          <Plus aria-hidden="true" className="size-4" /> Add a venue
        </ActionLink>
        <ActionLink to="/organizer/events/new">New event</ActionLink>
      </div>
    </div>
  );
}

function Stats({ events, now }: { events: OrganizerEvent[]; now: number }) {
  const published = events.filter((e) => e.status === 'PUBLISHED');
  const upcoming = events.reduce((n, e) => n + e.shows.filter((s) => isUpcoming(s, now)).length, 0);
  const sold = published.reduce((n, e) => n + seatTotals(e).booked, 0);
  const items = [
    { label: 'Events', value: events.length },
    { label: 'Published', value: published.length },
    { label: 'Upcoming shows', value: upcoming },
    { label: 'Seats sold', value: sold, key: true },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="bg-bg px-4 py-3.5">
          <dt className="label-mono text-text-3">{item.label}</dt>
          <dd className={`mt-1.5 font-mono text-[1.375rem] leading-none tracking-[-0.02em] ${item.key ? 'text-lime' : 'text-text'}`}>{formatCount(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function TableSkeleton() {
  return (
    <div aria-busy="true" className="border-t border-rule">
      <p className="sr-only" role="status">
        Loading events
      </p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-6 border-b border-rule py-4">
          <div className="flex-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

/** /organizer (overview with greeting and stats) and /organizer/events (the list alone). */
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

  const actions = (
    <>
      <ActionLink to="/organizer/events/new" tone="primary">
        <Plus aria-hidden="true" className="size-4" /> New event
      </ActionLink>
      <ActionLink to="/organizer/venues">Venues</ActionLink>
    </>
  );

  return (
    <div>
      {view === 'overview' ? (
        <PageHeader
          eyebrow={user?.organizationName ?? 'Organizer'}
          title={user ? `${greeting()}, ${displayName(user)}.` : greeting()}
          actions={actions}
        />
      ) : (
        <PageHeader crumbs={[{ label: 'Overview', to: '/organizer' }, { label: 'Events' }]} title="Events" actions={actions} />
      )}

      <div className="mt-8 space-y-8">
        {query.isPending ? (
          <TableSkeleton />
        ) : query.isError ? (
          <InlineAlert>
            <p>We couldn't load your events.</p>
            <Action className="mt-3" onClick={() => void query.refetch()} busy={query.isFetching}>
              Try again
            </Action>
          </InlineAlert>
        ) : events.length === 0 ? (
          <FirstEvent />
        ) : (
          <>
            {view === 'overview' && <Stats events={events} now={now} />}
            <section aria-labelledby="events-heading">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 id="events-heading" className="text-[15px] font-medium text-text">
                  {view === 'overview' ? 'Your events' : 'All events'}
                </h2>
                <StatusChips events={events} value={filter} onChange={(v) => setParams(v === 'ALL' ? {} : { status: v }, { replace: true })} />
              </div>
              {visible.length === 0 ? (
                <p className="border-y border-rule py-10 text-center text-[14px] text-text-2">No {filter.toLowerCase()} events.</p>
              ) : (
                <EventsTable events={visible} now={now} />
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
