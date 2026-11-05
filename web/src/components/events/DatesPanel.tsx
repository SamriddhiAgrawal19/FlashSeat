import { useId, useState } from 'react';
import type { EventDetail, EventShowSummary, ShowDetail } from '../../lib/api';
import { formatPriceRange, formatShowDate, formatTime, showDateParts } from '../../lib/format';
import { AccentButton, Arrow, DateBlock, FillBar } from '../site/ui';
import { showState, type ShowState } from './showState';

export interface ShowDetailState {
  data: ShowDetail | undefined;
  isError: boolean;
}

const longWeekday = new Intl.DateTimeFormat('en-IN', { weekday: 'long' });

/** "Saturday · 7:30 PM" */
function when(iso: string): string {
  const d = new Date(iso);
  return `${longWeekday.format(d)} · ${formatTime(iso) ?? ''}`;
}

/** "2h 30m", "2h", "45m" */
export function duration(startIso: string, endIso: string): string | null {
  const minutes = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ');
}

export function priceRange(detail: ShowDetail | undefined): string | null {
  const values = detail?.category_prices.map((p) => p.price_paise) ?? [];
  if (values.length === 0) return null;
  return formatPriceRange(Math.min(...values), Math.max(...values));
}

/** "135 seats left" / "Few seats left" (under 10%) / "Sold out", from GET /events/:eventId's counts. */
function seatsLeft(show: EventShowSummary): { text: string; soldOut: boolean } | null {
  if (show.seats_total <= 0) return null;
  if (show.seats_available <= 0) return { text: 'Sold out', soldOut: true };
  if (show.seats_available / show.seats_total < 0.1) return { text: 'Few seats left', soldOut: false };
  return { text: `${show.seats_available} seat${show.seats_available === 1 ? '' : 's'} left`, soldOut: false };
}

/** "SAT 14 NOV" */
function shortDay(iso: string): string {
  const p = showDateParts(iso);
  return p ? `${p.weekday} ${p.day} ${p.month}`.toUpperCase() : '';
}

interface Row {
  show: EventShowSummary;
  state: ShowState;
  detail: ShowDetail | undefined;
}

function SeatsLine({ show }: { show: EventShowSummary }) {
  const left = seatsLeft(show);
  if (!left) return null;
  const sold = 1 - show.seats_available / show.seats_total;
  return (
    <span className="ed-row-seats">
      <FillBar value={sold} tone={sold > 0.5 ? 'accent' : 'text'} />
      {left.text}
    </span>
  );
}

function RowSummary({ row }: { row: Row }) {
  const { show, detail, state } = row;
  const price = priceRange(detail);
  return (
    <>
      <DateBlock iso={show.starts_at} />
      <span className="ed-row-main">
        <span className="sr-only">{formatShowDate(show.starts_at)}</span>
        <span className="ed-row-when" aria-hidden="true">
          {when(show.starts_at)}
        </span>
        <SeatsLine show={show} />
      </span>
      {state.kind === 'sales-not-open' ? (
        <span className="ed-sales">SALES OPEN {shortDay(state.opensAt)}</span>
      ) : state.kind === 'checking' ? (
        <span className="site-skel" aria-hidden="true" style={{ width: 72, height: 12 }} />
      ) : (
        price && <span className="ed-row-price">{price}</span>
      )}
    </>
  );
}

/**
 * "Pick a date" (docs/event-detail-design.html). Upcoming shows first, by start time, then ended
 * and cancelled ones, dimmed. A bookable row with seats left is a button that expands (one open at
 * a time, the first bookable one by default) to show its times and "Select seats". Sales not open,
 * sold out and still-checking rows have no button.
 */
export function DatesPanel({ event, details }: { event: EventDetail; details: Map<string, ShowDetailState> }) {
  const baseId = useId();
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const sorted = [...event.shows].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const rows: Row[] = sorted.map((show) => {
    const d = details.get(show.id);
    return { show, detail: d?.data, state: showState(event.status, show, d?.data, d?.isError ?? false) };
  });
  const live = rows.filter((r) => r.state.kind !== 'ended' && r.state.kind !== 'cancelled');
  const past = rows.filter((r) => r.state.kind === 'ended' || r.state.kind === 'cancelled');
  const canOpen = (r: Row) => r.state.kind === 'bookable' && !seatsLeft(r.show)?.soldOut;
  // Until the visitor picks, the first bookable date is open.
  const openId = picked === undefined ? (live.find(canOpen)?.show.id ?? null) : picked;
  const venues = new Set(event.shows.map((s) => `${s.venue.name}|${s.venue.city}`));

  return (
    <aside id="dates" className="ed-panel" aria-labelledby="dates-title">
      <div className="ed-panel-head">
        <h2 id="dates-title" className="ed-h2">
          Pick a date
        </h2>
        <span className="site-mono" style={{ fontSize: 11, color: 'var(--muted-mono)' }}>
          {live.length || rows.length} SHOW{(live.length || rows.length) === 1 ? '' : 'S'}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="ed-row-note">No dates have been scheduled for this event.</p>
      ) : (
        <ul className="ed-shows">
          {live.map((row, i) => {
            const { show } = row;
            const open = openId === show.id;
            const panelId = `${baseId}-${show.id}`;
            const style = { animationDelay: `${(0.08 * i).toFixed(2)}s` };
            const left = seatsLeft(show);
            const end = formatTime(show.ends_at);
            const length = duration(show.starts_at, show.ends_at);
            return (
              <li key={show.id} style={{ display: 'flex', flexDirection: 'column' }}>
                {canOpen(row) ? (
                  <button
                    type="button"
                    className="ed-row"
                    style={style}
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setPicked(open ? null : show.id)}
                  >
                    <RowSummary row={row} />
                  </button>
                ) : (
                  <div className="ed-row" style={style}>
                    <RowSummary row={row} />
                  </div>
                )}
                {canOpen(row) && open && (
                  <div id={panelId} className="ed-row-open">
                    <span className="ed-row-note">
                      Starts {formatTime(show.starts_at)}
                      {end && ` · ends ${end}`}
                      {length && ` · ${length}`}
                      {venues.size > 1 && ` · ${show.venue.name}, ${show.venue.city}`}
                    </span>
                    <AccentButton to={`/shows/${show.id}`} size="sm">
                      Select seats <Arrow />
                    </AccentButton>
                  </div>
                )}
                {left?.soldOut && <span className="sr-only">This date is sold out.</span>}
              </li>
            );
          })}
          {past.map(({ show, state }) => (
            <li key={show.id} className="ed-past">
              <span className="ed-past-date">{shortDay(show.starts_at)}</span>
              <span className="ed-past-text">{state.kind === 'cancelled' ? 'Cancelled' : 'Ended'}</span>
            </li>
          ))}
        </ul>
      )}
      {event.status !== 'CANCELLED' && live.length > 0 && (
        <p className="ed-hold-note">Seats you pick are kept for you for 10 minutes while you check out.</p>
      )}
    </aside>
  );
}
