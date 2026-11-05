import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ApiError, getBooking, getEvent, getEvents, getMyBookings, getReservation, getSeatMap, getShow, type GetEventsParams } from './api';

export const UPCOMING_LIMIT = 10;
export const EVENTS_PAGE_SIZE = 20;

/** Upcoming published events for the landing page (one request). */
export function useUpcomingEvents() {
  return useQuery({
    queryKey: ['events', { limit: UPCOMING_LIMIT }],
    queryFn: ({ signal }) => getEvents({ limit: UPCOMING_LIMIT }, signal),
    retry: 1,
  });
}

/**
 * /events results, keyed by the filters. The previous page stays on screen while the next one
 * loads (placeholderData), so changing a filter or page never flashes an empty list.
 */
export function useEventsList(params: GetEventsParams) {
  return useQuery({
    queryKey: ['events', 'list', params],
    queryFn: ({ signal }) => getEvents({ ...params, limit: EVENTS_PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

/** A 404 (unknown or DRAFT) or 400 (malformed id) will not change by asking again. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

const retryUnlessNotFound = (count: number, error: Error) => !isNotFound(error) && count < 1;

export function useEventDetail(eventId: string) {
  return useQuery({
    queryKey: ['event', eventId],
    queryFn: ({ signal }) => getEvent(eventId, signal),
    enabled: eventId !== '',
    retry: retryUnlessNotFound,
  });
}

export function useShowDetail(eventId: string, showId: string) {
  return useQuery({
    queryKey: ['show', eventId, showId],
    queryFn: ({ signal }) => getShow(eventId, showId, signal),
    enabled: eventId !== '' && showId !== '',
    staleTime: 60_000,
    retry: retryUnlessNotFound,
  });
}

/** The seat map refreshes every 5 s while the tab is visible, and when it regains focus. */
export const SEAT_MAP_REFRESH_MS = 5000;

export function useSeatMap(showId: string, { paused = false, enabled = true }: { paused?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['seatMap', showId],
    queryFn: ({ signal }) => getSeatMap(showId, signal),
    enabled: enabled && showId !== '',
    staleTime: 0,
    // refetchInterval only runs while the document is visible (refetchIntervalInBackground: false).
    refetchInterval: paused ? false : SEAT_MAP_REFRESH_MS,
    refetchOnWindowFocus: !paused,
    retry: retryUnlessNotFound,
  });
}

export function useReservation(reservationId: string) {
  return useQuery({
    queryKey: ['reservation', reservationId],
    queryFn: ({ signal }) => getReservation(reservationId, signal),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: retryUnlessNotFound,
  });
}

export function useBooking(bookingId: string) {
  return useQuery({
    queryKey: ['booking', bookingId],
    queryFn: ({ signal }) => getBooking(bookingId, signal),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: retryUnlessNotFound,
  });
}

/** API maximum page size for /bookings/mine. */
const BOOKINGS_PAGE_LIMIT = 50;
/** Safety cap: 10 pages = 500 bookings. */
const BOOKINGS_MAX_PAGES = 10;

/**
 * All of the user's bookings. The tabs (Upcoming / Pending / Past / Cancelled) need status and
 * show time together, which the API can't filter by, so this walks the pages (usually one).
 */
export function useMyBookings() {
  return useQuery({
    queryKey: ['bookings', 'mine'],
    queryFn: async ({ signal }) => {
      const first = await getMyBookings(1, BOOKINGS_PAGE_LIMIT, signal);
      const bookings = [...first.bookings];
      const pages = Math.min(Math.ceil(first.total / BOOKINGS_PAGE_LIMIT), BOOKINGS_MAX_PAGES);
      for (let page = 2; page <= pages; page++) {
        bookings.push(...(await getMyBookings(page, BOOKINGS_PAGE_LIMIT, signal)).bookings);
      }
      return { bookings, total: first.total };
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
