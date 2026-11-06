import { useState } from 'react';
import type { EventRef } from '../../lib/api';
import { photoForEvent } from '../../lib/photos';
import { useEventDetail } from '../../lib/queries';

export interface EventPhoto {
  src: string;
  alt: string;
}

/**
 * The event's picture for the booking pages: poster_url when it has one (and it loads), else the
 * photo from its category pool (lib/photos.ts), the same one the event pages show. Seat map,
 * reservation and booking responses only carry { id, title }, so the category and poster come from
 * GET /events/:id (cached, shared with the event page). Null while that is loading.
 */
export function useEventPhoto(event: EventRef | undefined): { photo: EventPhoto | null; onError: () => void } {
  const detail = useEventDetail(event?.id ?? '');
  const [posterFailed, setPosterFailed] = useState(false);
  if (!event) return { photo: null, onError: () => {} };
  if (detail.isPending && !detail.isError) return { photo: null, onError: () => {} };
  const data = detail.data;
  if (data?.poster_url && !posterFailed) {
    return { photo: { src: data.poster_url, alt: `Poster for ${event.title}` }, onError: () => setPosterFailed(true) };
  }
  // No detail (error): the crowd pool, still stable per event id.
  const photo = photoForEvent({ id: event.id, category: data?.category ?? '' });
  return { photo: { src: photo.src, alt: photo.alt }, onError: () => {} };
}
