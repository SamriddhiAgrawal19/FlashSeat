import { useQuery } from '@tanstack/react-query';
import { getEvents } from './api';

export const UPCOMING_LIMIT = 10;

/** Upcoming published events, shared by the hero tickets and "Happening soon" (one request). */
export function useUpcomingEvents() {
  return useQuery({
    queryKey: ['events', { limit: UPCOMING_LIMIT }],
    queryFn: ({ signal }) => getEvents({ limit: UPCOMING_LIMIT }, signal),
    retry: 1,
  });
}
