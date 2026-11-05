import { PHOTOS } from '../../../lib/photos';
import { Arrow, Button, ButtonLink } from '../../ui/Button';

const block = 'bg-text/[0.07] motion-safe:animate-breathe';

/** Loading: the same lead + rows composition in quiet, pulsing blocks. */
export function FeaturedSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-12 lg:grid-cols-12 lg:gap-14">
      <p className="sr-only" role="status">
        Loading events
      </p>
      <div aria-hidden="true" className="lg:col-span-7">
        <div className={`aspect-[3/2] ${block}`} />
        <div className={`mt-6 h-3 w-56 ${block}`} />
        <div className={`mt-4 h-8 w-3/4 ${block}`} />
        <div className={`mt-4 h-4 w-3/5 ${block}`} />
      </div>
      <div aria-hidden="true" className="border-b border-rule lg:col-span-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid grid-cols-[2rem_1fr_5.5rem] gap-x-4 border-t border-rule py-6">
            <div className={`h-3 w-5 ${block}`} />
            <div>
              <div className={`h-6 w-4/5 ${block}`} />
              <div className={`mt-3 h-3 w-1/2 ${block}`} />
            </div>
            <div className={`aspect-[4/3] ${block}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** API unavailable: a compact strip with the message and a retry. The rest of the page carries on. */
export function FeaturedError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div role="alert" className="flex flex-col gap-6 border-y border-rule py-8 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-4">
        <span aria-hidden="true" className="mt-2.5 size-2 shrink-0 rounded-full bg-text-2" />
        <div>
          <p className="text-title font-medium text-text">We couldn't load events right now.</p>
          <p className="mt-1.5 text-text-2">Check your connection, or try again in a moment.</p>
        </div>
      </div>
      <Button variant="secondary" onClick={onRetry} disabled={retrying} className="shrink-0">
        {retrying ? 'Retrying…' : 'Try again'}
      </Button>
    </div>
  );
}

/** No published events yet: a calm, photo-led invitation to host the first one. */
export function FeaturedEmpty() {
  const photo = PHOTOS.emptyAuditorium;
  return (
    <div className="grid items-center gap-8 border-y border-rule py-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12">
      <div className="aspect-[3/2] overflow-hidden rounded-[2px]">
        <img src={photo.src} width={photo.width} height={photo.height} alt={photo.alt} loading="lazy" decoding="async" className="size-full object-cover" />
      </div>
      <div>
        <p className="label-mono text-text-2">Nothing on sale yet</p>
        <p className="mt-3 text-section font-medium text-text">The stage is being set.</p>
        <p className="mt-4 max-w-[46ch] text-text-2">No events are on sale yet. Check back soon, or host the first one.</p>
        <ButtonLink to="/organizer" className="mt-7">
          Host an event <Arrow />
        </ButtonLink>
      </div>
    </div>
  );
}
