import type { EventShowSummary, EventStatus, ShowDetail } from '../../lib/api';

export type ShowState =
  | { kind: 'bookable' }
  | { kind: 'sales-not-open'; opensAt: string }
  | { kind: 'ended' }
  | { kind: 'cancelled' }
  /** Still waiting for the show's detail (needed to know whether sales are open). */
  | { kind: 'checking' };

/**
 * Mirrors the backend's rules. The seat map's `bookable` is status SCHEDULED + event PUBLISHED +
 * starts_at > now() (show-seats.service.ts); holding seats also needs sales_open_at to be null or
 * past (reservations.repository.ts). GET /events/:eventId has no bookable flag, so this uses:
 *   - event.status and show.status / starts_at from GET /events/:eventId
 *   - sales_open_at from GET /events/:eventId/shows/:showId
 * "Now" is the viewer's clock here; the server still enforces every rule when seats are held.
 */
export function showState(
  eventStatus: EventStatus,
  show: EventShowSummary,
  detail: ShowDetail | undefined,
  detailFailed: boolean,
  now: number = Date.now(),
): ShowState {
  if (eventStatus === 'CANCELLED' || show.status === 'CANCELLED') return { kind: 'cancelled' };
  if (show.status === 'COMPLETED' || new Date(show.starts_at).getTime() <= now) return { kind: 'ended' };
  if (detail?.sales_open_at && new Date(detail.sales_open_at).getTime() > now) {
    return { kind: 'sales-not-open', opensAt: detail.sales_open_at };
  }
  if (!detail && !detailFailed) return { kind: 'checking' };
  return { kind: 'bookable' };
}

/** SCHEDULED and not started yet (viewer's clock): what the hero counts as "upcoming dates". */
export function isUpcoming(show: EventShowSummary, now: number = Date.now()): boolean {
  return show.status === 'SCHEDULED' && new Date(show.starts_at).getTime() > now;
}
