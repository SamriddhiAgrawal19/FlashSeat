import { useState } from 'react';
import type { EventRow } from '../../../lib/api';
import { categoryLabel } from '../../../lib/categories';
import { cn } from '../../../lib/cn';
import { formatPaise, formatShowDate } from '../../../lib/format';
import { photoForCategory } from '../../../lib/photos';
import type { FeaturedItem } from './useFeaturedEvents';

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

/** Mono meta line built only from fields the API actually returned: CATEGORY · DATE · CITY · FROM ₹X. */
export function EventMeta({ item, className }: { item: FeaturedItem; className?: string }) {
  const parts = [
    categoryLabel(item.event.category),
    item.startsAt ? formatShowDate(item.startsAt) : null,
    item.city ?? null,
    item.priceFromPaise !== undefined ? `From ${formatPaise(item.priceFromPaise)}` : null,
  ].filter((p): p is string => Boolean(p));

  // One plain string, so screen readers hear "Music · Sat, 7 Nov · Pune" with real separators.
  return (
    <p className={cn('label-mono text-text-2', className)}>
      {parts.join(' · ')}
      {item.metaPending && (
        <span aria-hidden="true" className="ml-2 inline-block h-2 w-20 translate-y-px bg-text/10 motion-safe:animate-breathe" />
      )}
    </p>
  );
}
