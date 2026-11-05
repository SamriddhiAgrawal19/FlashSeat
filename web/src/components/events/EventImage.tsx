import { useState } from 'react';
import type { EventRow } from '../../lib/api';
import { photoForEvent, type Photo } from '../../lib/photos';

/**
 * poster_url when present (and loadable), otherwise a photo from the event's category pool,
 * picked by event id (lib/photos.ts). Lists pass `photo` (from photosForEvents) so neighbours
 * never repeat a photo.
 */
export function EventImage({ event, photo, className }: { event: EventRow; photo?: Photo; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (event.poster_url && !failed) {
    return (
      <img
        src={event.poster_url}
        alt={`Poster for ${event.title}`}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={className}
      />
    );
  }
  const stand = photo ?? photoForEvent(event);
  // The title sits right next to it, so the stand-in category photo is decorative.
  return (
    <img src={stand.src} width={stand.width} height={stand.height} alt="" loading="lazy" decoding="async" className={className} />
  );
}
