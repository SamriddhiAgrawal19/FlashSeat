import { useQueries } from '@tanstack/react-query';
import { getEvent, getShow, type EventDetail, type EventRow, type EventShowSummary, type ShowDetail } from '../../../lib/api';
import { useUpcomingEvents } from '../../../lib/queries';

export const FEATURED_LIMIT = 5;
const DETAIL_STALE_MS = 60_000;

export interface FeaturedItem {
  event: EventRow;
  /** Next scheduled show's start (ISO), from GET /events/:id. Absent if there is none. */
  startsAt?: string;
  /** That show's venue city, from GET /events/:id. */
  city?: string;
  /** Lowest category price of that show in paise, from GET /events/:id/shows/:showId. */
  priceFromPaise?: number;
  /** Still fetching detail for this event (each event loads and fails independently). */
  metaPending: boolean;
}

/** The next show that is scheduled and hasn't started yet (shows come ordered by start). */
function nextShow(detail: EventDetail | undefined, now: number): EventShowSummary | undefined {
  return detail?.shows.find((s) => s.status === 'SCHEDULED' && new Date(s.starts_at).getTime() > now);
}

function lowestPrice(show: ShowDetail | undefined): number | undefined {
  const prices = show?.category_prices.map((p) => p.price_paise) ?? [];
  return prices.length > 0 ? Math.min(...prices) : undefined;
}

/**
 * Up to five upcoming events, enriched with their next show's date, city and starting
 * price. Reuses the shared events query; the detail requests run per event, so one
 * slow or failing event never blocks the others (its meta is simply left out).
 */
export function useFeaturedEvents() {
  const list = useUpcomingEvents();
  const events = list.data?.events.slice(0, FEATURED_LIMIT) ?? [];
  const now = Date.now();

  const details = useQueries({
    queries: events.map((event) => ({
      queryKey: ['event', event.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getEvent(event.id, signal),
      staleTime: DETAIL_STALE_MS,
      retry: 1,
    })),
  });

  const shows = details.map((d) => nextShow(d.data, now));

  const prices = useQueries({
    queries: events.map((event, i) => {
      const show = shows[i];
      return {
        queryKey: ['show', event.id, show?.id ?? null],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          show ? getShow(event.id, show.id, signal) : Promise.reject(new Error('No upcoming show')),
        enabled: show !== undefined,
        staleTime: DETAIL_STALE_MS,
        retry: 1,
      };
    }),
  });

  const items: FeaturedItem[] = events.map((event, i) => {
    const show = shows[i];
    const detailPending = details[i]?.isPending ?? false;
    const pricePending = show !== undefined && (prices[i]?.isPending ?? false);
    return {
      event,
      startsAt: show?.starts_at,
      city: show?.venue_city,
      priceFromPaise: lowestPrice(prices[i]?.data),
      metaPending: detailPending || pricePending,
    };
  });

  return { list, items };
}
