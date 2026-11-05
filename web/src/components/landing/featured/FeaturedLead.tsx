import { Link } from 'react-router';
import { Arrow } from '../../ui/Button';
import { EventImage, EventMeta } from './EventParts';
import type { FeaturedItem } from './useFeaturedEvents';

/** The dominant event: a wide image, then meta, a big title and a short description. */
export function FeaturedLead({ item }: { item: FeaturedItem }) {
  const { event } = item;
  return (
    <article className="group relative">
      <div className="aspect-[3/2] overflow-hidden rounded-[2px] bg-surface">
        <EventImage
          event={event}
          className="size-full object-cover transition-transform duration-[600ms] ease-out motion-safe:group-hover:scale-[1.04]"
        />
      </div>
      <EventMeta item={item} className="mt-6" />
      <h3 className="mt-3 text-section font-medium text-text">
        {/* Stretched link: the whole article is one click target with one accessible name. */}
        <Link to={`/events/${event.id}`} className="rounded-[2px] after:absolute after:inset-0 after:content-['']">
          {event.title}
        </Link>
      </h3>
      {event.description && <p className="mt-4 line-clamp-2 max-w-[56ch] text-text-2">{event.description}</p>}
      <p aria-hidden="true" className="mt-6 inline-flex items-center gap-2 text-[17px] font-medium text-text group-hover:text-lime">
        Get tickets <Arrow className="text-lime" />
      </p>
    </article>
  );
}
