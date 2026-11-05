import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { describeNetworkOrRateLimit } from '../../components/auth/FormParts';
import { ConfirmPanel } from '../../components/organizer/ConfirmPanel';
import { EventForm, toEventInput, type EventFormErrors, type EventFormValues } from '../../components/organizer/EventForm';
import { ShowForm } from '../../components/organizer/ShowForm';
import { ShowStatsBar } from '../../components/organizer/ShowStatsBar';
import { EventStatusPill } from '../../components/organizer/StatusPill';
import { Action, ActionLink, InlineAlert, PageHeader, Panel, Skeleton } from '../../components/organizer/ui';
import { ApiError, cancelEvent, publishEvent, updateEvent, type EventInput, type OrganizerEvent, type OrganizerShow } from '../../lib/api';
import { fieldErrorsFrom } from '../../lib/auth/formErrors';
import { categoryLabel } from '../../lib/categories';
import { formatShowDate, formatTime } from '../../lib/format';
import { formatCount, seatTotals } from '../../lib/organizer';
import { invalidateEventCaches, useMyEvents, useMyVenues, useShowStats } from '../../lib/organizerQueries';
import { showToast } from '../../lib/toast';

function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  return describeNetworkOrRateLimit(error.code, error.retryAfterSeconds) ?? error.message;
}

function ShowRow({ show, event }: { show: OrganizerShow; event: OrganizerEvent }) {
  const isDraft = event.status === 'DRAFT';
  const live = event.status === 'PUBLISHED' && show.status === 'SCHEDULED';
  const stats = useShowStats(show.id, { enabled: !isDraft, live });
  const fallback = { total: show.seats_total, booked: show.seats_booked, held: 0, available: show.seats_total - show.seats_booked };
  const salesOpen = show.sales_open_at && Date.parse(show.sales_open_at) > Date.now() ? show.sales_open_at : null;

  return (
    <li className="grid gap-x-6 gap-y-3 border-b border-rule py-4 last:border-b-0 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[13px] text-text">{formatShowDate(show.starts_at)}</p>
          {show.status !== 'SCHEDULED' && <EventStatusPill status={show.status} compact />}
        </div>
        <p className="mt-1 truncate text-[13px] text-text-2">
          {show.venue_name} · <span className="label-mono text-text-3">{show.venue_city}</span>
        </p>
        <p className="label-mono mt-1 text-text-3">
          Ends {formatTime(show.ends_at)}
          {salesOpen && <> · Sales open {formatShowDate(salesOpen)}</>}
        </p>
      </div>
      <div className="min-w-0 self-center">
        {stats.isPending && !isDraft ? (
          <Skeleton className="h-6 w-full" />
        ) : (
          <ShowStatsBar stats={stats.data ?? fallback} muted={show.status === 'CANCELLED'} />
        )}
        {stats.isError && <p className="mt-1 text-[12px] text-text-3">Live counts unavailable; showing the last known numbers.</p>}
      </div>
    </li>
  );
}

function NotFound() {
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Overview', to: '/organizer' }, { label: 'Events', to: '/organizer/events' }, { label: 'Not found' }]} title="Event not found" />
      <p className="mt-6 text-[15px] text-text-2">It may belong to another account, or the link is wrong.</p>
      <ActionLink to="/organizer/events" className="mt-6">
        All events
      </ActionLink>
    </div>
  );
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

  if (events.isPending) {
    return (
      <div aria-busy="true" className="space-y-4">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-9 w-80" />
        <Skeleton className="mt-8 h-48" />
      </div>
    );
  }
  if (events.isError) {
    return (
      <InlineAlert>
        <p>We couldn't load this event.</p>
        <Action className="mt-3" onClick={() => void events.refetch()} busy={events.isFetching}>
          Try again
        </Action>
      </InlineAlert>
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

  const actions =
    event.status === 'DRAFT' ? (
      <>
        <Action tone="primary" onClick={() => openConfirm('publish')} disabled={confirm !== null || publish.isPending}>
          Publish
        </Action>
        <Action onClick={() => setEditing(true)} disabled={editing}>
          Edit
        </Action>
        <Action tone="ghost" onClick={() => openConfirm('cancel')} disabled={confirm !== null}>
          Cancel event
        </Action>
      </>
    ) : event.status === 'PUBLISHED' ? (
      <>
        <ActionLink to={`/events/${event.id}`}>View public page ↗</ActionLink>
        <Action onClick={() => setEditing(true)} disabled={editing}>
          Edit
        </Action>
        <Action tone="danger" onClick={() => openConfirm('cancel')} disabled={confirm !== null}>
          Cancel event
        </Action>
      </>
    ) : (
      <ActionLink to={`/events/${event.id}`}>View public page ↗</ActionLink>
    );

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Overview', to: '/organizer' }, { label: 'Events', to: '/organizer/events' }, { label: event.title }]}
        title={event.title}
        actions={actions}
      >
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <EventStatusPill status={event.status} />
          <span className="label-mono text-text-3">{categoryLabel(event.category)}</span>
          <span className="label-mono text-text-3">
            {event.shows.length} show{event.shows.length === 1 ? '' : 's'}
          </span>
          {event.status === 'PUBLISHED' && (
            <span className="label-mono text-text-3">
              <span className="text-lime">{formatCount(booked)}</span> / {formatCount(total)} sold
            </span>
          )}
        </div>
      </PageHeader>

      <div className="mt-6 space-y-6">
        {event.status === 'CANCELLED' && (
          <div role="status" className="border-l-2 border-text/40 bg-surface px-4 py-3 text-[14px] text-text-2">
            <p className="font-medium text-text">This event was cancelled{event.cancelled_at ? ` on ${formatShowDate(event.cancelled_at)}` : ''}.</p>
            <p className="mt-1">
              All shows are cancelled and it can no longer be edited. Paid bookings are marked for refund; attendees see it under Cancelled.
            </p>
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
            <p>Publishing makes this event visible to everyone.</p>
            <p className="mt-1">
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
            <p>This can't be undone. In one step:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 marker:text-text-3">
              <li>
                {event.shows.length === 1 ? 'Its show is' : `All ${event.shows.length} shows are`} cancelled and nothing more can be sold.
              </li>
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
          <Panel title="Edit details">
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

        <Panel
          title="Shows"
          meta={event.status === 'PUBLISHED' ? 'Live · refreshes every 15 s' : event.status === 'DRAFT' ? 'Draft · not on sale' : undefined}
          actions={
            event.status !== 'CANCELLED' && !addingShow ? (
              <Action tone={event.shows.length === 0 ? 'primary' : 'secondary'} onClick={() => setAddingShow(true)}>
                <Plus aria-hidden="true" className="size-4" /> Add show
              </Action>
            ) : undefined
          }
        >
          {addingShow && (
            <div className="mb-5">
              {venues.isPending ? (
                <Skeleton className="h-40" />
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
              <div className="py-6 text-center">
                <p className="text-[14px] text-text-2">No shows yet. Add one to schedule the event at a venue.</p>
                {event.status === 'DRAFT' && <p className="mt-1 text-[13px] text-text-3">An event needs at least one show before it can be published.</p>}
              </div>
            )
          ) : (
            <ul className="-my-4">
              {event.shows.map((show) => (
                <ShowRow key={show.id} show={show} event={event} />
              ))}
            </ul>
          )}
        </Panel>

        {event.description && !editing && (
          <Panel title="Description">
            <p className="text-[14px] leading-relaxed whitespace-pre-line text-text-2">{event.description}</p>
          </Panel>
        )}

        {event.status === 'DRAFT' && event.shows.length > 0 && confirm === null && (
          <p className="text-[13px] text-text-3">
            Ready? <button type="button" className="text-text underline decoration-text/30 underline-offset-4 hover:decoration-lime" onClick={() => openConfirm('publish')}>Publish the event</button> to put it on sale.
          </p>
        )}
      </div>
    </div>
  );
}
