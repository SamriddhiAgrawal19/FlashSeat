import { Link } from 'react-router';
import type { EventRef, VenueRef } from '../../lib/api';
import { cn } from '../../lib/cn';
import { showDateParts } from '../../lib/format';
import { TicketMark } from '../site/SiteHeader';

export type BookingStep = 'seats' | 'hold' | 'pay' | 'tickets';

const STEPS: Array<{ id: BookingStep; label: string }> = [
  { id: 'seats', label: 'Seats' },
  { id: 'hold', label: 'Hold' },
  { id: 'pay', label: 'Pay' },
  { id: 'tickets', label: 'Tickets' },
];

/** "SAT 14 NOV · 7:30 PM · RANGDEEP THEATRE, PUNE" */
export function showMetaLine(startsAt: string, venue: VenueRef): string {
  const p = showDateParts(startsAt);
  const when = p ? `${p.weekday} ${p.day} ${p.month} · ${p.time}` : '';
  return [when, `${venue.name}, ${venue.city}`].filter(Boolean).join(' · ').toUpperCase();
}

interface BookingHeaderProps {
  step: BookingStep;
  event?: EventRef;
  startsAt?: string;
  venue?: VenueRef;
}

/**
 * The header on /shows/:id, /reservations/:id and /pay/:id: logo, the event (title links to the
 * event page) with date · time · venue, and the step tracker Seats -> Hold -> Pay -> Tickets.
 */
export function BookingHeader({ step, event, startsAt, venue }: BookingHeaderProps) {
  const current = STEPS.findIndex((s) => s.id === step);
  return (
    <header className="bk-head">
      <div className="bk-head-in">
        <Link to="/" className="site-logo">
          <TicketMark />
          FlashSeat
        </Link>
        {event && (
          <div className="bk-head-event">
            <Link to={`/events/${event.id}`} className="bk-head-title">
              {event.title}
            </Link>
            {startsAt && venue && <span className="bk-head-meta">{showMetaLine(startsAt, venue)}</span>}
          </div>
        )}
        <ol aria-label="Booking steps" className="bk-steps">
          {STEPS.map((s, i) => {
            const done = i < current;
            const isCurrent = i === current;
            return (
              <li key={s.id}>
                <span aria-current={isCurrent ? 'step' : undefined} className={cn('bk-step', done && 'is-done', isCurrent && 'is-current')}>
                  {done && <span aria-hidden="true">✓ </span>}
                  {s.label}
                  {done && <span className="sr-only"> (done)</span>}
                </span>
                {i < STEPS.length - 1 && <span aria-hidden="true" className="bk-step-sep" />}
              </li>
            );
          })}
        </ol>
      </div>
    </header>
  );
}
