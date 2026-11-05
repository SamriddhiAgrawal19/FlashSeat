import { useState } from 'react';
import type { EventRow } from '../../lib/api';
import { photoForCategory } from '../../lib/photos';

/** poster_url when present (and loadable), otherwise the event's category photo. */
export function EventImage({ event, className }: { event: EventRow; className?: string }) {
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
  const photo = photoForCategory(event.category);
  // The title sits right next to it, so the stand-in category photo is decorative.
  return (
    <img src={photo.src} width={photo.width} height={photo.height} alt="" loading="lazy" decoding="async" className={className} />
  );
}
