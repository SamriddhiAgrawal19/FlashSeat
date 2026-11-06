import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import '../components/booking/booking.css';
import { BookingHeader } from '../components/booking/BookingHeader';
import { HoldStatusPanel } from '../components/booking/HoldStatusPanel';
import { buildSeatLayout, shadeForRank } from '../components/booking/seatLayout';
import { SeatLegend } from '../components/booking/SeatLegend';
import { SeatMap } from '../components/booking/SeatMap';
import { MobileSelectionBar, SelectionCard } from '../components/booking/SelectionBar';
import { useEventPhoto } from '../components/booking/useEventPhoto';
import { ViewFromSeat } from '../components/booking/ViewFromSeat';
import { AccentButton, Arrow, Eyebrow, GhostButton } from '../components/site/ui';
import { ApiError, activeReservationId, seatsUnavailableIds, type SeatMap as SeatMapData, type SeatStatus } from '../lib/api';
import { holdSeatsWithRetry, HOLD_RETRY_DELAYS_MS } from '../lib/booking/holdRequest';
import { clearPendingHold, newIdempotencyKey, readPendingHold, savePendingHold } from '../lib/booking/idempotency';
import { serverNow } from '../lib/booking/serverClock';
import { categoriesOf, indexSeats, joinCodes, MAX_SEATS_PER_HOLD, seatCode, type SeatInfo } from '../lib/booking/seats';
import { formatShowDate } from '../lib/format';
import { isNotFound, useSeatMap } from '../lib/queries';
import { showToast } from '../lib/toast';

/** The seat map's cache (Redis, 2 s TTL) can briefly show a seat we were just told is taken. */
const LOCAL_TAKEN_GRACE_MS = 2500;

type ReadOnlyReason = 'cancelled' | 'started' | 'sales-not-open' | 'closed';

type Panel =
  | { kind: 'active-hold'; reservationId: string | null }
  | { kind: 'error'; title: string; body: string };

/**
 * Why the map is read-only, or null when seats can be held. `bookable` is the server's verdict
 * (status, start time and sales_open_at, by the database clock); the rest only picks the words.
 * Cancelling an event cancels its shows, so show status covers both.
 */
function readOnlyReason(map: SeatMapData, refused: boolean): ReadOnlyReason | null {
  if (map.show.bookable && !refused) return null;
  if (map.show.status === 'CANCELLED') return 'cancelled';
  if (map.show.status === 'COMPLETED' || Date.parse(map.show.startsAt) <= serverNow()) return 'started';
  if (map.show.salesOpenAt && Date.parse(map.show.salesOpenAt) > serverNow()) return 'sales-not-open';
  return 'closed';
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
    <>
      <BookingHeader step="seats" />
      <section className="bk-main bk-narrow bk-step-in">
        <Eyebrow>404</Eyebrow>
        <h1 className="bk-h1-lg">
          Show not <span className="site-serif">found.</span>
        </h1>
        <p className="bk-lede">This show doesn't exist or isn't on sale.</p>
        <GhostButton to="/events" size="lg">
          Browse events <Arrow />
        </GhostButton>
      </section>
    </>
  );
}

function MapSkeleton() {
  return (
    <div aria-busy="true" className="bk-mapbox bk-skelmap">
      <p className="sr-only" role="status">
        Loading seats
      </p>
      <div aria-hidden="true" className="bk-skelmap-in">
        <span className="site-skel" style={{ width: '46%', height: 6, marginBottom: 28 }} />
        {[14, 16, 18, 20, 20, 18].map((n, i) => (
          <div key={i} className="bk-skelmap-row">
            {Array.from({ length: n }, (_, j) => (
              <span key={j} className="site-skel" style={{ width: 16, height: 14, borderRadius: '5px 5px 3px 3px' }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.4;
const ZOOM_STEP = 0.1;
/** How long a seat taken by someone else pulses after a refresh shows it (the CSS animation is 1.2 s). */
const JUST_TAKEN_MS = 1300;

/** /shows/:showId: pick seats and hold them. (An old ?event= parameter is simply ignored.) */
export function SeatMapPage() {
  const { showId = '' } = useParams();
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
  const map = seatMap.data;
  const event = map?.event;
  const seats = useMemo(() => (map ? indexSeats(map) : new Map<string, SeatInfo>()), [map]);
  const categories = useMemo(() => (map ? categoriesOf(map) : []), [map]);
  const reason = map ? readOnlyReason(map, refused) : null;
  const readOnly = reason !== null;

  // --- presentation only: curved layout, category shades, zoom, view from seat, taken pulse ----
  const layout = useMemo(() => (map ? buildSeatLayout(map) : null), [map]);
  // categoriesOf is cheapest first (tier 0); the shade rank is most expensive first.
  const shades = useMemo(() => new Map(categories.map((c) => [c.category, shadeForRank(categories.length - 1 - c.tier, categories.length)])), [categories]);
  const { photo, onError: onPhotoError } = useEventPhoto(event);
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState<string | null>(null);
  const [justTaken, setJustTaken] = useState<ReadonlySet<string>>(() => new Set());
  const lastStatuses = useRef<Map<string, SeatStatus> | null>(null);
  const justTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(justTimer.current), []);
  useEffect(() => {
    if (!map) return;
    const next = new Map<string, SeatStatus>();
    for (const seat of seats.values()) next.set(seat.id, seat.status);
    const prev = lastStatuses.current;
    lastStatuses.current = next;
    if (!prev) return;
    const changed = [...next].filter(([id, status]) => status !== 'AVAILABLE' && prev.get(id) === 'AVAILABLE').map(([id]) => id);
    if (changed.length === 0) return;
    setJustTaken(new Set(changed));
    window.clearTimeout(justTimer.current);
    justTimer.current = window.setTimeout(() => setJustTaken(new Set()), JUST_TAKEN_MS);
  }, [map]);

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
        if (mounted.current) navigate(`/reservations/${reservation.id}`);
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
    [showId, seats],
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

  // The view panel follows the hovered/focused seat, else the last selected one, else the centre.
  const placedById = new Map((layout?.seats ?? []).map((p) => [p.seat.id, p]));
  const middleLine = layout?.lines[Math.floor(layout.lines.length / 2)] ?? [];
  const centreSeat = layout?.seats[middleLine[Math.floor(middleLine.length / 2)] ?? -1] ?? null;
  const viewed = (preview && placedById.get(preview)) || placedById.get(selected[selected.length - 1] ?? '') || centreSeat;
  const sortedSeats = [...selectedSeats].sort((a, b) => (placedById.get(a.id)?.order ?? 0) - (placedById.get(b.id)?.order ?? 0));
  const zoomBy = (step: number) => setZoom((z) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + step)) * 10) / 10);

  return (
    <>
      <BookingHeader step="seats" event={event} startsAt={map?.show.startsAt} venue={map?.show.venue} />
      <div className="bk-main bk-seats bk-step-in">
        <section aria-labelledby="seatmap-title" className="bk-mapcard">
          <div className="bk-mapcard-top">
            <div className="bk-titlewrap">
              <h1 id="seatmap-title" className="bk-h1">
                Pick your <span className="site-serif">seats.</span>
              </h1>
              {map && (
                <span className="bk-live">
                  <i aria-hidden="true" className="site-pulse" />
                  LIVE · {map.summary.available.toLocaleString('en-IN')} {map.summary.available === 1 ? 'SEAT' : 'SEATS'} LEFT
                </span>
              )}
            </div>
            <div className="bk-zoom" role="group" aria-label="Zoom the seat map">
              <button type="button" className="bk-zbtn" aria-label="Zoom out" onClick={() => zoomBy(-ZOOM_STEP)} disabled={!map || zoom <= ZOOM_MIN}>
                −
              </button>
              <span className="bk-zoom-pct" aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <button type="button" className="bk-zbtn" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} disabled={!map || zoom >= ZOOM_MAX}>
                +
              </button>
            </div>
          </div>

          <div className="bk-panels">
            {reason && map && <ReadOnlyBanner reason={reason} salesOpenAt={map.show.salesOpenAt} />}
            {panel?.kind === 'active-hold' && (
              <HoldStatusPanel
                title="You already have seats held for this show."
                action={
                  panel.reservationId ? (
                    <AccentButton to={`/reservations/${panel.reservationId}`} size="sm">
                      Go to your hold <Arrow />
                    </AccentButton>
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
                  <GhostButton size="sm" onClick={() => setPanel(null)}>
                    Dismiss
                  </GhostButton>
                }
              >
                {panel.body}
              </HoldStatusPanel>
            )}
          </div>

          {map && layout ? (
            // Read-only maps stay legible but clearly inert.
            <div className={readOnly ? 'bk-readonly' : undefined}>
              <SeatMap
                layout={layout}
                selected={selectedSet}
                takenLocally={takenLocally.ids}
                justTaken={justTaken}
                shades={shades}
                zoom={zoom}
                locked={holding || readOnly}
                onToggle={onToggle}
                onPreview={setPreview}
              />
            </div>
          ) : seatMap.isError ? (
            <HoldStatusPanel
              tone="error"
              role="alert"
              title="We couldn't load the seats right now."
              action={
                <GhostButton size="sm" onClick={() => void seatMap.refetch()} disabled={seatMap.isFetching}>
                  {seatMap.isFetching ? 'Retrying…' : 'Try again'}
                </GhostButton>
              }
            >
              Check your connection, or try again in a moment.
            </HoldStatusPanel>
          ) : (
            <MapSkeleton />
          )}

          {categories.length > 0 && <SeatLegend categories={categories} shades={shades} />}
        </section>

        <aside className="bk-aside" aria-label="Your selection">
          {layout && <ViewFromSeat placed={viewed} totalRows={layout.totalRows} photo={photo} onPhotoError={onPhotoError} />}
          {map && !readOnly && (
            <SelectionCard
              seats={sortedSeats}
              holding={holding}
              holdingNote={holdingNote}
              note={note}
              onRemove={(id) => setSelected((prev) => prev.filter((s) => s !== id))}
              onHold={onHold}
            />
          )}
        </aside>
      </div>

      {map && !readOnly && (
        <MobileSelectionBar
          seats={sortedSeats}
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
