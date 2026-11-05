import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ApiError, getEvent, getEvents, getShow, type GetEventsParams } from './api';

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
    retry: retryUnlessNotFound,
  });
}

export function useShowDetail(eventId: string, showId: string) {
  return useQuery({
    queryKey: ['show', eventId, showId],
    queryFn: ({ signal }) => getShow(eventId, showId, signal),
    staleTime: 60_000,
    retry: retryUnlessNotFound,
  });
}
