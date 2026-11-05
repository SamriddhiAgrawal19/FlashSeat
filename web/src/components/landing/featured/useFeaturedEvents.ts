import type { EventListItem } from '../../../lib/api';
import { useUpcomingEvents } from '../../../lib/queries';

export const FEATURED_LIMIT = 5;

export interface FeaturedItem {
  event: EventListItem;
  /** next_show.starts_at from GET /events. */
  startsAt?: string;
  /** next_show.venue.city from GET /events. */
  city?: string;
  /** min_price_paise from GET /events. */
  priceFromPaise?: number;
}

/** Up to five upcoming events with their next show and starting price: one GET /events request. */
export function useFeaturedEvents() {
  const list = useUpcomingEvents();
  const items: FeaturedItem[] = (list.data?.events ?? []).slice(0, FEATURED_LIMIT).map((event) => ({
    event,
    startsAt: event.next_show?.starts_at,
    city: event.next_show?.venue.city,
    priceFromPaise: event.min_price_paise ?? undefined,
  }));
  return { list, items };
}
