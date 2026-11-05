import { categoryLabel } from '../../../lib/categories';
import { cn } from '../../../lib/cn';
import { formatPaise, formatShowDay } from '../../../lib/format';
import type { FeaturedItem } from './useFeaturedEvents';

/** Mono meta line built only from fields the API actually returned: CATEGORY · DATE · CITY · FROM ₹X. */
export function EventMeta({ item, className }: { item: FeaturedItem; className?: string }) {
  const parts = [
    categoryLabel(item.event.category),
    item.startsAt ? formatShowDay(item.startsAt) : null,
    item.city ?? null,
    item.priceFromPaise !== undefined ? `From ${formatPaise(item.priceFromPaise)}` : null,
  ].filter((p): p is string => Boolean(p));

  // One plain string, so screen readers hear "Music · Sat, 7 Nov · Pune" with real separators.
  return (
    <p className={cn('label-mono text-text-2', className)}>
      {parts.join(' · ')}
    </p>
  );
}
