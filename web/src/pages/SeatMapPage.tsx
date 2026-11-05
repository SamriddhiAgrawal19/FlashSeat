import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { HoldStatusPanel } from '../components/booking/HoldStatusPanel';
import { SeatLegend } from '../components/booking/SeatLegend';
import { SeatMap } from '../components/booking/SeatMap';
import { SelectionBar } from '../components/booking/SelectionBar';
import { Arrow, Button, ButtonLink } from '../components/ui/Button';
import { Container } from '../components/ui/Container';
import { Eyebrow } from '../components/ui/Section';
import { ApiError, activeReservationId, seatsUnavailableIds, type EventDetail, type SeatMap as SeatMapData, type ShowDetail } from '../lib/api';
import { holdSeatsWithRetry, HOLD_RETRY_DELAYS_MS } from '../lib/booking/holdRequest';
import { clearPendingHold, newIdempotencyKey, readPendingHold, savePendingHold } from '../lib/booking/idempotency';
import { serverNow } from '../lib/booking/serverClock';
import { categoriesOf, indexSeats, joinCodes, MAX_SEATS_PER_HOLD, seatCode, type SeatInfo } from '../lib/booking/seats';
import { formatShowDate } from '../lib/format';
import { isNotFound, useEventDetail, useSeatMap, useShowDetail } from '../lib/queries';
import { showToast } from '../lib/toast';

/** The seat map's cache (Redis, 2 s TTL) can briefly show a seat we were just told is taken. */
const LOCAL_TAKEN_GRACE_MS = 2500;

type ReadOnlyReason = 'cancelled' | 'started' | 'sales-not-open' | 'closed';

type Panel =
  | { kind: 'active-hold'; reservationId: string | null }
  | { kind: 'error'; title: string; body: string };

/**
 * Why the map is read-only, or null when seats can be held. The seat map's `bookable` covers
 * show/event status and start time; sales_open_at only comes from the show detail.
 */
function readOnlyReason(map: SeatMapData, event: EventDetail | undefined, show: ShowDetail | undefined, refused: boolean): ReadOnlyReason | null {
  if (map.show.status === 'CANCELLED' || event?.status === 'CANCELLED' || show?.event_status === 'CANCELLED') return 'cancelled';
  if (!map.show.bookable) return map.show.status === 'COMPLETED' || Date.parse(map.show.startsAt) <= serverNow() ? 'started' : 'closed';
  if (show?.sales_open_at && Date.parse(show.sales_open_at) > serverNow()) return 'sales-not-open';
  return refused ? 'closed' : null;
}

function ReadOnlyBanner({ reason, salesOpenAt }: { reason: ReadOnlyReason; salesOpenAt: string | null }) {
  const copy: Record<ReadOnlyReason, { title: string; body: string }> = {
    cancelled: { title: 'This show has been cancelled.', body: 'Tickets for it are no longer on sale.' },
    started: { title: 'This show has already started.', body: "Seats can't be held once a show begins." },
    'sales-not-open': {
      title: salesOpenAt ? `Sales open ${formatShowDate(salesOpenAt) ?? 'soon'}.` : 'Sales are not open yet.',
      body: 'Have a look around now. You can hold seats once sales open.',
    },
    closed: { title: "Tickets for this show aren't on sale right now.", body: 'You can still look at the seat map.' },
  };
  return (
    <HoldStatusPanel tone="muted" title={copy[reason].title}>
      {copy[reason].body}
    </HoldStatusPanel>
  );
}

/** What the user sees after a hold attempt fails, by the API's error code (docs/api.md). */
function errorPanel(error: unknown): Panel {
  if (!(error instanceof ApiError)) return { kind: 'error', title: "We couldn't hold those seats.", body: 'Something went wrong. Please try again.' };
  const wait = error.retryAfterSeconds ?? 1;
  const inSeconds = `in ${wait} second${wait === 1 ? '' : 's'}`;
  switch (error.code) {
    case 'RATE_LIMITED':
      return { kind: 'error', title: 'Too many attempts in a short time.', body: `Please wait and try again ${inSeconds}.` };
    case 'SERVICE_BUSY':
    case 'DB_UNAVAILABLE':
    case 'DB_TIMEOUT':
    case 'LOCK_TIMEOUT':
    case 'RETRYABLE_CONFLICT':
      return { kind: 'error', title: "We're very busy right now.", body: `Your seats weren't held. Please try again ${inSeconds}.` };
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return {
        kind: 'error',
        title: "We couldn't reach FlashSeat.",
        body: 'Check your connection and try again. If your seats were held after all, we will take you to them.',
      };
    case 'IDEMPOTENCY_KEY_REUSED':
      return { kind: 'error', title: "That request didn't go through.", body: 'Please press Hold seats again.' };
    case 'RESERVATION_NOT_ACTIVE':
      return { kind: 'error', title: 'That hold has ended.', body: 'Pick your seats again to hold them.' };
    case 'VALIDATION_ERROR':
      return { kind: 'error', title: "Some of those seats can't be held.", body: 'The seat map has been refreshed. Please pick again.' };
    default:
      return { kind: 'error', title: "We couldn't hold those seats.", body: error.message || 'Please try again.' };
  }
}

function ShowNotFound() {
  useEffect(() => {
    document.title = 'Show not found · FlashSeat';
  }, []);
  return (
    <section className="pt-40 pb-28 md:pt-48">
      <Container className="max-w-[42rem]">
        <Eyebrow>404</Eyebrow>
        <h1 className="mt-4 text-section font-medium text-text">Show not found.</h1>
        <p className="mt-4 text-text-2">This show doesn't exist or isn't on sale.</p>
        <ButtonLink to="/events" variant="secondary" className="mt-8">
          Browse events <Arrow />
        </ButtonLink>
      </Container>
    </section>
  );
}

function MapSkeleton() {
  const block = 'bg-text/[0.07] motion-safe:animate-breathe';
  return (
    <div aria-busy="true" className="border-y border-rule py-10">
      <p className="sr-only" role="status">
        Loading seats
      </p>
      <div aria-hidden="true" className="mx-auto flex max-w-[42rem] flex-col items-center gap-2">
        <div className={`mb-8 h-1.5 w-full ${block}`} />
        {[10, 12, 12, 14, 14, 12].map((n, i) => (
          <div key={i} className="flex gap-1.5">
            {Array.from({ length: n }, (_, j) => (
              <span key={j} className={`size-7 ${block}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** /shows/:showId (?event=<eventId> for the header): pick seats and hold them. */
export function SeatMapPage() {
  const { showId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<string[]>([]);
  const [takenLocally, setTakenLocally] = useState<{ ids: ReadonlySet<string>; at: number }>({ ids: new Set(), at: 0 });
  const [holding, setHolding] = useState(false);
  const [holdingNote, setHoldingNote] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [refused, setRefused] = useState(false);

  const seatMap = useSeatMap(showId, { paused: holding });
  // The event id only travels in the URL (the seat map response has no event fields).
  const eventParam = searchParams.get('event') ?? '';
  const eventQuery = useEventDetail(eventParam);
  const showQuery = useShowDetail(eventParam, showId);
  const eventShow = eventQuery.data?.shows.find((s) => s.id === showId);
  const event = eventShow ? eventQuery.data : undefined;
  const showDetail = eventShow ? showQuery.data : undefined;
  const eventSuffix = event ? `?event=${encodeURIComponent(event.id)}` : '';

  const map = seatMap.data;
  const seats = useMemo(() => (map ? indexSeats(map) : new Map<string, SeatInfo>()), [map]);
  const categories = useMemo(() => (map ? categoriesOf(map) : []), [map]);
  const tiers = useMemo(() => new Map(categories.map((c) => [c.category, c.tier])), [categories]);
  const reason = map ? readOnlyReason(map, event, showDetail, refused) : null;
  const readOnly = reason !== null;

  useEffect(() => {
    document.title = event ? `Seats · ${event.title} · FlashSeat` : 'Pick seats · FlashSeat';
  }, [event]);

  // --- keep the selection honest when the map refreshes ---------------------------------------
  const holdingRef = useRef(holding);
  holdingRef.current = holding;
  useEffect(() => {
    if (!map || holdingRef.current) return;
    const gone = selected.filter((id) => seats.get(id)?.status !== 'AVAILABLE');
    if (gone.length > 0) {
      setSelected((prev) => prev.filter((id) => !gone.includes(id)));
      const codes = gone.map((id) => seats.get(id)).filter((s): s is SeatInfo => !!s).map(seatCode);
      if (codes.length > 0) showToast(`${joinCodes(codes)} ${codes.length === 1 ? 'was' : 'were'} just taken.`);
    }
    if (takenLocally.ids.size > 0 && seatMap.dataUpdatedAt > takenLocally.at + LOCAL_TAKEN_GRACE_MS) {
      setTakenLocally({ ids: new Set(), at: 0 });
    }
    // Only a new map should trigger this, not a selection change.
  }, [map]);

  useEffect(() => {
    if (readOnly) setSelected([]);
  }, [readOnly]);

  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 4000);
    return () => window.clearTimeout(id);
  }, [note]);

  // --- selection ------------------------------------------------------------------------------
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onToggle = useCallback((seatId: string) => {
    const current = selectedRef.current;
    if (current.includes(seatId)) {
      setSelected(current.filter((id) => id !== seatId));
      return;
    }
    if (current.length >= MAX_SEATS_PER_HOLD) {
      setNote(`You can hold up to ${MAX_SEATS_PER_HOLD} seats at a time.`);
      return;
    }
    setSelected([...current, seatId]);
    setPanel(null);
  }, []);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedSeats = selected.map((id) => seats.get(id)).filter((s): s is SeatInfo => !!s);

  // --- holding --------------------------------------------------------------------------------
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runHold = useCallback(
    async (seatIds: string[], key: string, resumed: boolean) => {
      setHolding(true);
      setPanel(null);
      setNote(null);
      try {
        const reservation = await holdSeatsWithRetry({
          showId,
          seatIds,
          key,
          retries: resumed ? 0 : HOLD_RETRY_DELAYS_MS.length,
          onRetry: (n) => mounted.current && setHoldingNote(`Connection hiccup. Retrying (${n} of ${HOLD_RETRY_DELAYS_MS.length})…`),
        });
        clearPendingHold();
        queryClient.setQueryData(['reservation', reservation.id], reservation);
        void queryClient.invalidateQueries({ queryKey: ['seatMap', showId] });
        if (mounted.current) navigate(`/reservations/${reservation.id}${eventSuffix}`);
        return;
      } catch (error) {
        // Keep the request only when its outcome is unknown (no response at all), so a reload can
        // replay it with the same key. Every answer from the server is final for that key.
        const unknownOutcome = error instanceof ApiError && error.status === 0;
        if (resumed || !unknownOutcome) clearPendingHold();
        if (!mounted.current) return;
        if (!(error instanceof ApiError)) {
          setPanel(errorPanel(error));
          return;
        }
        switch (error.code) {
          case 'SEATS_UNAVAILABLE': {
            const ids = seatsUnavailableIds(error);
            setTakenLocally((prev) => ({ ids: new Set([...prev.ids, ...ids]), at: Date.now() }));
            setSelected((prev) => prev.filter((id) => !ids.includes(id)));
            const codes = ids.map((id) => seats.get(id)).filter((s): s is SeatInfo => !!s).map(seatCode);
            showToast(
              codes.length > 1
                ? `Someone just grabbed ${joinCodes(codes)}. Pick other seats.`
                : `Someone just grabbed ${codes[0] ?? 'a seat you picked'}. Pick another seat.`,
            );
            void seatMap.refetch();
            break;
          }
          case 'ACTIVE_RESERVATION_EXISTS':
            setPanel({ kind: 'active-hold', reservationId: activeReservationId(error) });
            break;
          case 'SHOW_NOT_BOOKABLE':
            setRefused(true);
            void seatMap.refetch();
            void showQuery.refetch();
            break;
          case 'NOT_FOUND':
            void seatMap.refetch();
            break;
          case 'UNAUTHORIZED':
          case 'INVALID_TOKEN':
          case 'TOKEN_EXPIRED':
          case 'INVALID_REFRESH_TOKEN':
            // The session layer has already sent the user to log in.
            break;
          case 'RESERVATION_NOT_ACTIVE':
            // A resumed request whose hold has since ended: nothing to tell.
            if (!resumed) setPanel(errorPanel(error));
            break;
          case 'VALIDATION_ERROR':
            setSelected([]);
            setPanel(errorPanel(error));
            void seatMap.refetch();
            break;
          default:
            setPanel(errorPanel(error));
        }
      } finally {
        if (mounted.current) {
          setHolding(false);
          setHoldingNote(null);
        }
      }
    },
    [showId, eventSuffix, seats],
  );

  const onHold = () => {
    if (selected.length === 0 || holding) return;
    // One key per click; every retry of this click reuses it with the same seats.
    const key = newIdempotencyKey();
    const seatIds = [...selected];
    savePendingHold({ key, showId, seatIds, createdAt: Date.now() });
    void runHold(seatIds, key, false);
  };

  // A reload during a hold request: send the same request (same key, same seats) once more.
  const resumeChecked = useRef(false);
  useEffect(() => {
    if (resumeChecked.current || !map) return;
    resumeChecked.current = true;
    const pending = readPendingHold(showId);
    if (!pending) return;
    setSelected(pending.seatIds.filter((id) => seats.has(id)).slice(0, MAX_SEATS_PER_HOLD));
    void runHold(pending.seatIds, pending.key, true);
  }, [map, seats, showId, runHold]);

  // --- render ---------------------------------------------------------------------------------
  if (seatMap.isError && isNotFound(seatMap.error)) return <ShowNotFound />;

  const startsAt = map?.show.startsAt ?? eventShow?.starts_at;
  const venue = eventShow ? `${eventShow.venue_name} · ${eventShow.venue_city}` : null;
  const metaLine = [startsAt ? formatShowDate(startsAt) : null, venue].filter(Boolean).join(' · ');

  return (
    <>
      <section aria-labelledby="seatmap-title" className="pt-28 pb-8 md:pt-32">
        <Container>
          <Link to={event ? `/events/${event.id}` : '/events'} className="label-mono inline-block text-text-2 hover:text-lime">
            ← {event ? 'Back to event' : 'All events'}
          </Link>
          <h1 id="seatmap-title" className="mt-6 max-w-[24ch] text-section font-medium text-text">
            {event?.title ?? 'Pick your seats'}
          </h1>
          <p className="label-mono mt-4 min-h-4 text-text-2">{metaLine}</p>

          {categories.length > 0 && (
            <div className="mt-10">
              <SeatLegend categories={categories} />
            </div>
          )}

          <div className="mt-8 flex flex-col gap-3 empty:hidden">
            {reason && <ReadOnlyBanner reason={reason} salesOpenAt={showDetail?.sales_open_at ?? null} />}
            {panel?.kind === 'active-hold' && (
              <HoldStatusPanel
                title="You already have seats held for this show."
                action={
                  panel.reservationId ? (
                    <ButtonLink to={`/reservations/${panel.reservationId}${eventSuffix}`}>
                      Go to your hold <Arrow />
                    </ButtonLink>
                  ) : undefined
                }
              >
                Finish checking out or release them before holding different seats.
              </HoldStatusPanel>
            )}
            {panel?.kind === 'error' && (
              <HoldStatusPanel
                tone="error"
                role="alert"
                title={panel.title}
                action={
                  <Button variant="secondary" size="sm" onClick={() => setPanel(null)}>
                    Dismiss
                  </Button>
                }
              >
                {panel.body}
              </HoldStatusPanel>
            )}
          </div>
        </Container>
      </section>

      <Container className="pb-16">
        {map ? (
          // Read-only maps stay legible but clearly inert.
          <div className={readOnly ? 'opacity-50' : undefined}>
            <SeatMap map={map} selected={selectedSet} takenLocally={takenLocally.ids} tiers={tiers} locked={holding || readOnly} onToggle={onToggle} />
          </div>
        ) : seatMap.isError ? (
          <HoldStatusPanel
            tone="error"
            role="alert"
            title="We couldn't load the seats right now."
            action={
              <Button variant="secondary" size="sm" onClick={() => void seatMap.refetch()} disabled={seatMap.isFetching}>
                {seatMap.isFetching ? 'Retrying…' : 'Try again'}
              </Button>
            }
          >
            Check your connection, or try again in a moment.
          </HoldStatusPanel>
        ) : (
          <MapSkeleton />
        )}
        {map && (
          <p className="label-mono mt-4 text-text-3">
            {map.summary.available} of {map.summary.total} seats available · Updates every few seconds
          </p>
        )}
      </Container>

      {map && !readOnly && (
        <SelectionBar
          seats={selectedSeats}
          holding={holding}
          holdingNote={holdingNote}
          note={note}
          onRemove={(id) => setSelected((prev) => prev.filter((s) => s !== id))}
          onHold={onHold}
        />
      )}
    </>
  );
}
