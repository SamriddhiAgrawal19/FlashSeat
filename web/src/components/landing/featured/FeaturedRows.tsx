import { Link } from 'react-router';
import { Arrow, ArrowLink } from '../../ui/Button';
import { EventImage, EventMeta } from './EventParts';
import type { FeaturedItem } from './useFeaturedEvents';

// Each row's thumbnail gets its own shape, so the column reads as a layout, not a list of clones.
const THUMB_SHAPES = ['aspect-square w-24', 'aspect-[3/2] w-32', 'aspect-[4/5] w-20', 'aspect-[16/10] w-32'];

/** Supporting events as typographic rows between hairlines. */
export function FeaturedRows({ items }: { items: FeaturedItem[] }) {
  if (items.length === 0) {
    return (
      <div className="border-t border-rule pt-6">
        <p className="text-title font-medium text-text-2">More shows go on sale soon.</p>
        <ArrowLink to="/events" className="mt-5">
          View all events
        </ArrowLink>
      </div>
    );
  }

  return (
    <ol className="border-b border-rule">
      {items.map((item, i) => (
        <li key={item.event.id} className="group relative grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-x-4 border-t border-rule py-6">
          <span className="label-mono pt-1.5 text-text-2">{String(i + 2).padStart(2, '0')}</span>
          <div className="min-w-0">
            <h3 className="text-title font-medium text-text/80 transition-colors group-hover:text-text">
              <Link to={`/events/${item.event.id}`} className="rounded-[2px] after:absolute after:inset-0 after:content-['']">
                {item.event.title}
              </Link>
            </h3>
            <EventMeta item={item} className="mt-3" />
            <Arrow className="mt-3 text-lime" />
          </div>
          <div className={`${THUMB_SHAPES[i % THUMB_SHAPES.length]} overflow-hidden rounded-[2px] bg-surface`}>
            <EventImage
              event={item.event}
              className="size-full object-cover transition-transform duration-[600ms] ease-out motion-safe:group-hover:scale-[1.04]"
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
