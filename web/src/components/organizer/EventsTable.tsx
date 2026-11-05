import { useNavigate, Link } from 'react-router';
import type { EventStatus, OrganizerEvent } from '../../lib/api';
import { categoryLabel } from '../../lib/categories';
import { cn } from '../../lib/cn';
import { formatShowDate } from '../../lib/format';
import { formatCount, nextShow, seatTotals } from '../../lib/organizer';
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
    <div role="group" aria-label="Filter by status" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {FILTERS.map((f) => {
        const count = f.id === 'ALL' ? events.length : events.filter((e) => e.status === f.id).length;
        const active = f.id === value;
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(f.id)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-2 rounded-[2px] border px-3 text-[13px] transition-colors',
              active ? 'border-text/60 bg-text/[0.06] text-text' : 'border-rule text-text-2 hover:border-text/30 hover:text-text',
            )}
          >
            {f.label}
            <span className="font-mono text-[11px] text-text-3">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

const GRID = 'md:grid md:grid-cols-[minmax(0,1fr)_7.5rem_4.5rem_10.5rem_8.5rem] md:items-center md:gap-4';

function SeatsSold({ event }: { event: OrganizerEvent }) {
  if (event.status !== 'PUBLISHED') return <span className="text-text-3">—</span>;
  const { booked, total } = seatTotals(event);
  const pct = total > 0 ? booked / total : 0;
  return (
    <span className="flex flex-col gap-1.5 md:items-end">
      <span>
        <span className="text-lime">{formatCount(booked)}</span>
        <span className="text-text-3"> / {formatCount(total)}</span>
      </span>
      <span aria-hidden="true" className="hidden h-0.5 w-20 bg-rule md:block">
        <span className="block h-full bg-text/70" style={{ width: `${Math.round(pct * 100)}%` }} />
      </span>
    </span>
  );
}

/** The organizer's events. Rows open the manage page; the title is the real link (keyboard, middle-click). */
export function EventsTable({ events, now }: { events: OrganizerEvent[]; now: number }) {
  const navigate = useNavigate();

  return (
    <div className="border-t border-rule">
      <div className={cn('label-mono hidden border-b border-rule py-2.5 text-text-3', GRID)} aria-hidden="true">
        <span>Event</span>
        <span>Status</span>
        <span className="text-right">Shows</span>
        <span>Next show</span>
        <span className="text-right">Seats sold</span>
      </div>
      <ul>
        {events.map((event) => {
          const next = nextShow(event, now);
          const href = `/organizer/events/${event.id}`;
          return (
            <li
              key={event.id}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('a')) return;
                navigate(href);
              }}
              className={cn('group cursor-pointer border-b border-rule py-3.5 transition-colors hover:bg-text/[0.025] md:px-2', GRID, 'md:-mx-2')}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={href} className="block truncate text-[15px] font-medium tracking-[-0.01em] text-text group-hover:text-lime">
                    {event.title}
                  </Link>
                  <p className="label-mono mt-0.5 text-text-3">{categoryLabel(event.category)}</p>
                </div>
                <EventStatusPill status={event.status} compact className="md:hidden" />
              </div>
              <div className="hidden md:block">
                <EventStatusPill status={event.status} compact />
              </div>
              <dl className="mt-2.5 grid grid-cols-3 gap-3 font-mono text-[12px] text-text-2 md:contents md:text-[13px]">
                <div className="md:text-right">
                  <dt className="label-mono text-text-3 md:sr-only">Shows</dt>
                  <dd className="mt-0.5 md:mt-0">{event.shows.length}</dd>
                </div>
                <div>
                  <dt className="label-mono text-text-3 md:sr-only">Next show</dt>
                  <dd className="mt-0.5 truncate md:mt-0">{next ? formatShowDate(next.starts_at) : <span className="text-text-3">—</span>}</dd>
                </div>
                <div className="md:text-right">
                  <dt className="label-mono text-text-3 md:sr-only">Seats sold</dt>
                  <dd className="mt-0.5 md:mt-0">
                    <SeatsSold event={event} />
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
