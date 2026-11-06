import { Link } from 'react-router';
import type { EventStatus, OrganizerEvent } from '../../lib/api';
import { formatShowDay } from '../../lib/format';
import { formatCount, nextShow, seatTotals } from '../../lib/organizer';
import { EventImage } from '../events/EventImage';
import { EventStatusPill } from './StatusPill';

export type StatusFilter = 'ALL' | EventStatus;

const FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'DRAFT', label: 'Draft' },
  { id: 'PUBLISHED', label: 'Published' },
  { id: 'CANCELLED', label: 'Cancelled' },
];

export function isStatusFilter(value: string | null): value is StatusFilter {
  return FILTERS.some((f) => f.id === value);
}

export function StatusChips({ events, value, onChange }: { events: OrganizerEvent[]; value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  return (
    <div role="group" aria-label="Filter by status" className="og-chips">
      {FILTERS.map((f) => {
        const count = f.id === 'ALL' ? events.length : events.filter((e) => e.status === f.id).length;
        return (
          <button key={f.id} type="button" className="site-chip" aria-pressed={f.id === value} onClick={() => onChange(f.id)}>
            {f.label}
            <span className="og-chip-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "4 shows · 381 / 1,200 sold", "2 shows · sales open Fri, 13 Nov", "1 show · not published". */
function eventMeta(event: OrganizerEvent, now: number): string {
  const shows = plural(event.shows.length, 'show');
  if (event.status === 'DRAFT') return `${shows} · not published`;
  const { booked, total } = seatTotals(event);
  const next = nextShow(event, now);
  if (event.status === 'PUBLISHED' && booked === 0 && next?.sales_open_at && Date.parse(next.sales_open_at) > now) {
    return `${shows} · sales open ${formatShowDay(next.sales_open_at)}`;
  }
  return `${shows} · ${formatCount(booked)} / ${formatCount(total)} sold`;
}

/** The organizer's events (design "Your events"): photo, title, status, fill bar and meta. Each row is a link. */
export function EventsTable({ events, now }: { events: OrganizerEvent[]; now: number }) {
  return (
    <ul className="og-list">
      {events.map((event) => {
        const { booked, total } = seatTotals(event);
        const pct = event.status === 'DRAFT' || total === 0 ? 0 : (booked / total) * 100;
        return (
          <li key={event.id}>
            <Link to={`/organizer/events/${event.id}`} className="og-row">
              <span className="og-thumb">
                <EventImage event={event} />
              </span>
              <span className="og-row-main">
                <span className="og-row-title">
                  <span>{event.title}</span>
                  <EventStatusPill status={event.status} compact />
                </span>
                <span className="og-row-meta">
                  <span className="og-bar" aria-hidden="true">
                    <span className="og-fill" style={{ width: `${pct.toFixed(1)}%` }} />
                  </span>
                  {eventMeta(event, now)}
                </span>
              </span>
              <span aria-hidden="true" className="og-go">
                →
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
