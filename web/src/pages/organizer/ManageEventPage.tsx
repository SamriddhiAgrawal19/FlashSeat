import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { describeNetworkOrRateLimit } from '../../components/auth/FormParts';
import { EventImage } from '../../components/events/EventImage';
import { ConfirmPanel } from '../../components/organizer/ConfirmPanel';
import { EventForm, toEventInput, type EventFormErrors, type EventFormValues } from '../../components/organizer/EventForm';
import { ShowForm } from '../../components/organizer/ShowForm';
import { ShowStatsBar, type ShowStats } from '../../components/organizer/ShowStatsBar';
import { EventStatusPill, Pill } from '../../components/organizer/StatusPill';
import { Action, ActionLink, Breadcrumbs, InlineAlert, PageHeader, Panel, Skeleton } from '../../components/organizer/ui';
import { ApiError, cancelEvent, getSeatMap, publishEvent, updateEvent, type EventInput, type OrganizerEvent, type OrganizerShow } from '../../lib/api';
import { fieldErrorsFrom } from '../../lib/auth/formErrors';
import { categoryLabel } from '../../lib/categories';
import { formatShowDate, formatShowDay, formatTime, showDateParts } from '../../lib/format';
import { formatCount, seatTotals } from '../../lib/organizer';
import { invalidateEventCaches, useMyEvents, useMyVenues, useShowStats } from '../../lib/organizerQueries';
import { showToast } from '../../lib/toast';

function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  return describeNetworkOrRateLimit(error.code, error.retryAfterSeconds) ?? error.message;
}

/** "2h 30m" */
function duration(startIso: string, endIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

const weekdayLong = new Intl.DateTimeFormat('en-IN', { weekday: 'long' });

/** The show's state pill: ON SALE / SALES OPEN <date> / ENDED / CANCELLED (DRAFT while the event is a draft). */
function ShowState({ show, event, now }: { show: OrganizerShow; event: OrganizerEvent; now: number }) {
  if (show.status === 'CANCELLED') return <Pill tone="coral">CANCELLED</Pill>;
  if (show.status === 'COMPLETED' || Date.parse(show.starts_at) <= now) return <Pill>ENDED</Pill>;
  if (event.status === 'DRAFT') return <Pill>DRAFT</Pill>;
  if (show.sales_open_at && Date.parse(show.sales_open_at) > now) return <Pill tone="white">{`SALES OPEN ${(formatShowDay(show.sales_open_at) ?? '').toUpperCase()}`}</Pill>;
  return <Pill tone="green">ON SALE</Pill>;
}

function ShowRow({ show, event }: { show: OrganizerShow; event: OrganizerEvent }) {
  const isDraft = event.status === 'DRAFT';
  const live = event.status === 'PUBLISHED' && show.status === 'SCHEDULED';
  const stats = useShowStats(show.id, { enabled: !isDraft, live });
  const fallback = { total: show.seats_total, booked: show.seats_booked, held: 0, available: show.seats_total - show.seats_booked };
  const p = showDateParts(show.starts_at);

  return (
    <li className="og-srow">
      <span className="og-date is-lg" aria-hidden="true">
        <span className="og-date-day">{p?.day.padStart(2, '0')}</span>
        <span className="og-date-mon">{p?.month.toUpperCase()}</span>
      </span>
      <span className="og-srow-when">
        <span>
          {weekdayLong.format(new Date(show.starts_at))} · {formatTime(show.starts_at)}
          <span className="sr-only"> · {formatShowDate(show.starts_at)}</span>
        </span>
        <span>
          {show.venue_name}, {show.venue_city} · {duration(show.starts_at, show.ends_at)}
        </span>
      </span>
      <span className="og-sbar-wrap">
        {stats.isPending && !isDraft ? (
          <Skeleton style={{ height: 8, width: '100%' }} />
        ) : (
          <ShowStatsBar stats={stats.data ?? fallback} muted={show.status === 'CANCELLED'} />
        )}
        {stats.isError && <span className="og-nums-note">Live counts unavailable; showing the last known numbers.</span>}
      </span>
      <ShowState show={show} event={event} now={Date.now()} />
    </li>
  );
}

function NotFound() {
  return (
    <div className="og-view">
      <PageHeader crumbs={[{ label: 'Events', to: '/organizer/events' }, { label: 'Not found' }]} title="Event not found" small />
      <p className="og-sub">It may belong to another account, or the link is wrong.</p>
      <div>
        <ActionLink to="/organizer/events">All events</ActionLink>
      </div>
    </div>
  );
}

/**
 * Seats held right now across the event's shows: the same ['seatMap', showId] summaries the show
 * rows refresh every 15 s (this only reads them; the rows drive the refresh).
 */
function useHeldNow(event: OrganizerEvent | undefined): number | null {
  const shows = event?.status === 'PUBLISHED' ? event.shows : [];
  const results = useQueries({
    queries: shows.map((s) => ({
      queryKey: ['seatMap', s.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getSeatMap(s.id, signal),
      select: (map: Awaited<ReturnType<typeof getSeatMap>>): ShowStats => map.summary,
      staleTime: 0,
      retry: 1,
    })),
  });
  if (event?.status !== 'PUBLISHED' || shows.length === 0) return null;
  if (results.some((r) => !r.data)) return null;
  return results.reduce((n, r) => n + (r.data?.held ?? 0), 0);
}

type Confirm = 'publish' | 'cancel' | null;

/** /organizer/events/:eventId */
export function ManageEventPage() {
  const { eventId = '' } = useParams();
  const queryClient = useQueryClient();
  const events = useMyEvents();
  const venues = useMyVenues();
  const event = events.data?.find((e) => e.id === eventId.toLowerCase());
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [addingShow, setAddingShow] = useState(false);
  const [editErrors, setEditErrors] = useState<EventFormErrors>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<ReactNode>(null);

  useEffect(() => {
    document.title = `${event?.title ?? 'Event'} · Organizer · FlashSeat`;
  }, [event?.title]);

  const refresh = () => invalidateEventCaches(queryClient, eventId);

  const update = useMutation({
    mutationFn: (body: Partial<EventInput>) => updateEvent(eventId, body),
    onSuccess: async () => {
      await refresh();
      setEditing(false);
      showToast('Event updated.');
    },
    onError: async (error) => {
      const fields = fieldErrorsFrom(error);
      setEditErrors(fields);
      if (error instanceof ApiError && error.code === 'EVENT_CANCELLED') {
        await refresh();
        setEditing(false);
        showToast('This event was cancelled, so it can no longer be edited.');
        return;
      }
      if (Object.keys(fields).length === 0) setEditError(errorText(error));
      showToast("Couldn't save the changes.");
    },
  });

  const publish = useMutation({
    mutationFn: () => publishEvent(eventId),
    onSuccess: async () => {
      await refresh();
      setConfirm(null);
      showToast('Published. The event is live on FlashSeat.');
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        setConfirmError('Add at least one show before publishing.');
        showToast('Add at least one show before publishing.');
      } else if (error instanceof ApiError && error.code === 'EVENT_NOT_DRAFT') {
        await refresh();
        setConfirm(null);
        showToast('This event is no longer a draft. The page has been refreshed.');
      } else {
        setConfirmError(errorText(error));
        showToast("Couldn't publish the event.");
      }
    },
  });

  const cancel = useMutation({
    mutationFn: () => cancelEvent(eventId),
    onSuccess: async () => {
      await refresh();
      setConfirm(null);
      setAddingShow(false);
      setEditing(false);
      showToast('Event cancelled. Attendees will see it as cancelled.');
    },
    onError: (error) => {
      setConfirmError(errorText(error));
      showToast("Couldn't cancel the event.");
    },
  });

  const heldNow = useHeldNow(event);

  if (events.isPending) {
    return (
      <div aria-busy="true" className="og-view">
        <Skeleton style={{ width: 200, height: 11 }} />
        <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
          <Skeleton style={{ width: 96, height: 96, borderRadius: 16 }} />
          <Skeleton style={{ width: 320, maxWidth: '60%', height: 34 }} />
        </div>
        <Skeleton style={{ height: 240, borderRadius: 18 }} />
      </div>
    );
  }
  if (events.isError) {
    return (
      <div className="og-view">
        <InlineAlert>
          <p style={{ margin: 0 }}>We couldn't load this event.</p>
          <Action className="mt-3" small onClick={() => void events.refetch()} busy={events.isFetching}>
            Try again
          </Action>
        </InlineAlert>
      </div>
    );
  }
  if (!event) return <NotFound />;

  const { booked, total } = seatTotals(event);
  const scheduled = event.shows.filter((s) => s.status === 'SCHEDULED').length;
  const openConfirm = (which: Confirm) => {
    setConfirmError(null);
    setConfirm(which);
  };

  const initialValues: EventFormValues = {
    title: event.title,
    category: event.category,
    description: event.description,
    posterUrl: event.poster_url ?? '',
  };

  const venuesLine = [...new Set(event.shows.map((s) => `${s.venue_name}, ${s.venue_city}`))].join(' · ');

  const actions =
    event.status === 'CANCELLED' ? null : (
      <>
        {event.status === 'PUBLISHED' && <ActionLink to={`/events/${event.id}`}>View public page ↗</ActionLink>}
        {event.status === 'DRAFT' && (
          <Action tone="primary" onClick={() => openConfirm('publish')} disabled={confirm !== null || publish.isPending}>
            Publish
          </Action>
        )}
        <Action onClick={() => setEditing(true)} disabled={editing}>
          Edit
        </Action>
        <Action tone="danger" onClick={() => openConfirm('cancel')} disabled={confirm !== null}>
          Cancel event
        </Action>
      </>
    );

  const stats = [
    {
      label: 'SEATS SOLD',
      value:
        total > 0 ? (
          <>
            {formatCount(booked)} <small>/ {formatCount(total)}</small>
          </>
        ) : (
          '—'
        ),
    },
    { label: 'HELD RIGHT NOW', value: heldNow === null ? '—' : formatCount(heldNow) },
    { label: 'FILL RATE', value: total > 0 ? `${Math.round((booked / total) * 100)}%` : '—' },
  ];

  return (
    <div className="og-view">
      <Breadcrumbs items={[{ label: 'Events', to: '/organizer/events' }, { label: event.title }]} />

      <header className="og-ehead">
        <div className="og-ephoto">
          <EventImage event={event} />
        </div>
        <div className="og-ehead-text">
          <div className="og-ehead-title">
            <h1 className="og-h1 is-sm">{event.title}</h1>
            <EventStatusPill status={event.status} />
          </div>
          <span className="og-sub">
            {categoryLabel(event.category)} · {event.shows.length} show{event.shows.length === 1 ? '' : 's'}
            {venuesLine && ` · ${venuesLine}`}
          </span>
        </div>
        {actions && <div className="og-head-actions">{actions}</div>}
      </header>

      {event.status === 'CANCELLED' && (
        <div role="status" className="og-banner">
          <i aria-hidden="true" className="og-banner-dot" />
          <div>
            <p className="og-banner-title">This event was cancelled{event.cancelled_at ? ` on ${formatShowDate(event.cancelled_at)}` : ''}.</p>
            <p className="og-banner-text">
              All shows are cancelled and it can no longer be edited. Paid bookings are marked for refund; attendees see it under Cancelled.
            </p>
          </div>
        </div>
      )}

      {confirm === 'publish' && (
        <ConfirmPanel
          title="Publish this event?"
          tone="primary"
          confirmLabel="Publish now"
          cancelLabel="Not yet"
          busyLabel="Publishing…"
          busy={publish.isPending}
          error={confirmError}
          onConfirm={() => publish.mutate()}
          onCancel={() => setConfirm(null)}
        >
          <p style={{ margin: 0 }}>Publishing makes this event visible to everyone.</p>
          <p style={{ margin: '4px 0 0' }}>
            {event.shows.length === 0
              ? 'It has no shows yet, so it cannot be published until you add one.'
              : `${scheduled} show${scheduled === 1 ? '' : 's'} go${scheduled === 1 ? 'es' : ''} on sale (or when its sales open time arrives). A published event can't go back to draft.`}
          </p>
        </ConfirmPanel>
      )}

      {confirm === 'cancel' && (
        <ConfirmPanel
          title="Cancel this event?"
          tone="danger"
          confirmLabel="Cancel event"
          busyLabel="Cancelling…"
          busy={cancel.isPending}
          requireText={event.title}
          error={confirmError}
          onConfirm={() => cancel.mutate()}
          onCancel={() => setConfirm(null)}
        >
          <p style={{ margin: 0 }}>This can't be undone. In one step:</p>
          <ul>
            <li>{event.shows.length === 1 ? 'Its show is' : `All ${event.shows.length} shows are`} cancelled and nothing more can be sold.</li>
            <li>Seats people are holding right now are released.</li>
            <li>Bookings waiting for payment are cancelled.</li>
            <li>
              Paid bookings are marked for refund
              {booked > 0 ? ` (${formatCount(booked)} booked seat${booked === 1 ? '' : 's'} right now)` : ''}; their tickets become void.
            </li>
          </ul>
        </ConfirmPanel>
      )}

      {editing && event.status !== 'CANCELLED' && (
        <Panel title="Edit details" className="og-panel-in">
          <EventForm
            idPrefix="edit-event"
            initial={initialValues}
            serverErrors={editErrors}
            hadPoster={event.poster_url !== null}
            disabled={update.isPending}
            alert={editError ? <InlineAlert>{editError}</InlineAlert> : undefined}
            onSubmit={(values) => {
              setEditError(null);
              setEditErrors({});
              const next = toEventInput(values);
              // Send only what changed (PATCH accepts title, description, category, posterUrl).
              const body: Partial<EventInput> = {};
              if (next.title !== event.title) body.title = next.title;
              if (next.category !== event.category) body.category = next.category;
              if ((next.description ?? '') !== event.description) body.description = next.description;
              if (next.posterUrl !== undefined && next.posterUrl !== event.poster_url) body.posterUrl = next.posterUrl;
              if (Object.keys(body).length === 0) {
                setEditing(false);
                return;
              }
              update.mutate(body);
            }}
            footer={
              <>
                <Action type="submit" tone="primary" busy={update.isPending}>
                  {update.isPending ? 'Saving…' : 'Save changes'}
                </Action>
                <Action tone="ghost" onClick={() => setEditing(false)}>
                  Discard
                </Action>
              </>
            }
          />
        </Panel>
      )}

      <dl className="og-stats">
        {stats.map((s) => (
          <div key={s.label} className="og-stat">
            <dt className="og-kpi-label">{s.label}</dt>
            <dd className="og-stat-value" style={{ margin: 0 }}>
              {s.value}
            </dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="shows-title" className="og-card is-clip">
        <div className="og-card-head">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 id="shows-title" className="og-card-title">
              Shows
            </h2>
            <span className="og-card-meta">
              {event.status === 'PUBLISHED' ? 'Live · refreshes every 15 s' : event.status === 'DRAFT' ? 'Draft · not on sale' : 'Cancelled'}
            </span>
          </div>
          <div className="og-legend">
            <span>
              <i aria-hidden="true" className="og-sw" style={{ background: 'var(--accent)' }} />
              Booked
            </span>
            <span>
              <i aria-hidden="true" className="og-sw" style={{ background: 'var(--text)' }} />
              Held
            </span>
            <span>
              <i aria-hidden="true" className="og-sw" style={{ background: '#27272A' }} />
              Available
            </span>
            {event.status !== 'CANCELLED' && (
              <Action tone="primary" small aria-expanded={addingShow} aria-controls="add-show-panel" onClick={() => setAddingShow((v) => !v)}>
                {addingShow ? 'Close' : '+ Add show'}
              </Action>
            )}
          </div>
        </div>

        {addingShow && (
          <div id="add-show-panel" className="og-addpanel og-panel-in">
            {venues.isPending ? (
              <Skeleton style={{ height: 160 }} />
            ) : venues.isError ? (
              <InlineAlert>We couldn't load your venues. Try again in a moment.</InlineAlert>
            ) : (
              <ShowForm
                eventId={event.id}
                venues={venues.data}
                onCancel={() => setAddingShow(false)}
                onCreated={async (show) => {
                  await refresh();
                  setAddingShow(false);
                  showToast(`Show added for ${formatShowDate(show.starts_at)} · ${formatCount(show.seatCount)} seats.`);
                }}
              />
            )}
          </div>
        )}

        {event.shows.length === 0 ? (
          !addingShow && (
            <div className="og-empty-list">
              <p style={{ margin: 0 }}>No shows yet. Add one to schedule the event at a venue.</p>
              {event.status === 'DRAFT' && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-3)' }}>An event needs at least one show before it can be published.</p>}
            </div>
          )
        ) : (
          <ul className="og-list">
            {event.shows.map((show) => (
              <ShowRow key={show.id} show={show} event={event} />
            ))}
          </ul>
        )}
      </section>

      {event.description && !editing && (
        <Panel title="Description">
          <p className="og-desc">{event.description}</p>
        </Panel>
      )}

      {event.status === 'DRAFT' && event.shows.length > 0 && confirm === null && (
        <p className="og-sub" style={{ fontSize: 13 }}>
          Ready?{' '}
          <button type="button" className="og-textbtn" onClick={() => openConfirm('publish')}>
            Publish the event
          </button>{' '}
          to put it on sale.
        </p>
      )}
    </div>
  );
}

