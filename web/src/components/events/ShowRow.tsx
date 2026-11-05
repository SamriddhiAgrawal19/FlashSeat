import type { EventShowSummary, EventStatus } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatPriceRange, formatShowDate, showDateParts } from '../../lib/format';
import { useShowDetail } from '../../lib/queries';
import { Arrow, ButtonLink } from '../ui/Button';
import { showState, type ShowState } from './showState';

function priceRange(prices: Array<{ price_paise: number }>): string | null {
  if (prices.length === 0) return null;
  const values = prices.map((p) => p.price_paise);
  return formatPriceRange(Math.min(...values), Math.max(...values));
}

function Action({ state, showId, eventId }: { state: ShowState; showId: string; eventId: string }) {
  switch (state.kind) {
    case 'bookable':
      return (
        <ButtonLink to={`/shows/${showId}?event=${encodeURIComponent(eventId)}`} size="md" className="w-full sm:w-auto">
          Select seats <Arrow />
        </ButtonLink>
      );
    case 'sales-not-open':
      return (
        <span className="label-mono inline-flex h-12 items-center border border-rule px-4 text-text-2" aria-disabled="true">
          Sales open {formatShowDate(state.opensAt)}
        </span>
      );
    case 'ended':
      return <span className="label-mono text-text-2">Ended</span>;
    case 'cancelled':
      return <span className="label-mono text-text-2">Cancelled</span>;
    case 'checking':
      return <span aria-hidden="true" className="inline-block h-12 w-40 bg-text/[0.07] motion-safe:animate-breathe" />;
  }
}

/** One date in "Dates & tickets": date block, time and venue, price range, and its booking state. */
export function ShowRow({ eventId, eventStatus, show }: { eventId: string; eventStatus: EventStatus; show: EventShowSummary }) {
  const detail = useShowDetail(eventId, show.id);
  const state = showState(eventStatus, show, detail.data, detail.isError);
  const parts = showDateParts(show.starts_at);
  const dimmed = state.kind === 'ended' || state.kind === 'cancelled';
  const price = detail.data ? priceRange(detail.data.category_prices) : null;

  return (
    <li
      className={cn(
        'grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-5 gap-y-4 border-b border-rule py-6 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:gap-x-8',
        dimmed && 'opacity-50',
      )}
    >
      <div className="text-center" aria-hidden="true">
        <p className="text-[2.75rem] leading-none font-medium tracking-[-0.05em] text-text">{parts?.day}</p>
        <p className="label-mono mt-1.5 text-text-2">{parts?.month}</p>
      </div>

      <div className="min-w-0">
        <p className="sr-only">{formatShowDate(show.starts_at)}</p>
        <p aria-hidden="true" className="text-[17px] font-medium tracking-[-0.02em] text-text">
          {parts?.weekday} · {parts?.time}
        </p>
        <p className="mt-1 truncate text-[15px] text-text-2">
          {show.venue_name}, {show.venue_city}
        </p>
        <p className="label-mono mt-2 text-text">
          {detail.isPending ? (
            <span aria-hidden="true" className="inline-block h-3 w-28 bg-text/[0.07] motion-safe:animate-breathe" />
          ) : price ? (
            price
          ) : (
            <span className="text-text-2">Prices unavailable</span>
          )}
        </p>
      </div>

      <div className="col-span-2 sm:col-span-1 sm:justify-self-end">
        <Action state={state} showId={show.id} eventId={eventId} />
      </div>
    </li>
  );
}
