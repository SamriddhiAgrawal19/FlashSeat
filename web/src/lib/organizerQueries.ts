// TanStack Query hooks and cache invalidation for the organizer dashboard.
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { getMyEvents, getMyVenues, getSeatMap, getVenueLayout } from './api';
import { isNotFound } from './queries';

export const organizerKeys = {
  events: ['organizer', 'events'] as const,
  venues: ['organizer', 'venues'] as const,
  layout: (venueId: string) => ['organizer', 'venueLayout', venueId] as const,
};

/** Show stats refresh every 15 s while the page is visible. */
export const SHOW_STATS_REFRESH_MS = 15_000;

/** GET /events/mine: every event in every status, each with all of its shows. */
export function useMyEvents() {
  return useQuery({
    queryKey: organizerKeys.events,
    queryFn: ({ signal }) => getMyEvents(signal),
    staleTime: 10_000,
    retry: 1,
  });
}

export function useMyVenues() {
  return useQuery({
    queryKey: organizerKeys.venues,
    queryFn: ({ signal }) => getMyVenues(signal),
    staleTime: 10_000,
    retry: 1,
  });
}

export function useVenueLayout(venueId: string) {
  return useQuery({
    queryKey: organizerKeys.layout(venueId),
    queryFn: ({ signal }) => getVenueLayout(venueId, signal),
    enabled: venueId !== '',
    staleTime: 0,
    retry: (count, error) => !isNotFound(error) && count < 1,
  });
}

/**
 * Live seat counts of one show, from the seat map's summary. It shares the ['seatMap', showId]
 * cache entry with the attendee seat map. Off for DRAFT events (the seat map 404s for them).
 */
export function useShowStats(showId: string, { enabled, live }: { enabled: boolean; live: boolean }) {
  return useQuery({
    queryKey: ['seatMap', showId],
    queryFn: ({ signal }) => getSeatMap(showId, signal),
    enabled,
    select: (map) => map.summary,
    staleTime: 0,
    // refetchInterval pauses while the tab is hidden (refetchIntervalInBackground is false).
    refetchInterval: live ? SHOW_STATS_REFRESH_MS : false,
    retry: 1,
  });
}

/** After an event or show mutation: the organizer list, the public event page and lists, seat maps. */
export function invalidateEventCaches(queryClient: QueryClient, eventId: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: organizerKeys.events }),
    queryClient.invalidateQueries({ queryKey: ['event', eventId] }),
    queryClient.invalidateQueries({ queryKey: ['events'] }),
    queryClient.invalidateQueries({ queryKey: ['show', eventId] }),
    queryClient.invalidateQueries({ queryKey: ['seatMap'] }),
  ]);
}

/** After seats are added: the venue list (counts, categories) and that venue's layout. */
export function invalidateVenueCaches(queryClient: QueryClient, venueId: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: organizerKeys.venues }),
    queryClient.invalidateQueries({ queryKey: organizerKeys.layout(venueId) }),
  ]);
}
