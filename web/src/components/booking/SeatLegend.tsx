import { formatCategory, formatPriceRange } from '../../lib/format';
import type { CategoryInfo } from '../../lib/booking/seats';
import { cn } from '../../lib/cn';
import { seatLookClass, type SeatLook } from './Seat';

function Swatch({ look, tier = 0 }: { look: SeatLook; tier?: number }) {
  return <span aria-hidden="true" className={cn('inline-block size-4 shrink-0 rounded-[2px]', seatLookClass(look, tier))} />;
}

const STATES: Array<{ look: SeatLook; label: string }> = [
  { look: 'selected', label: 'Your pick' },
  { look: 'held', label: 'Held' },
  { look: 'booked', label: 'Booked' },
];

/** Categories with prices (from the seat data), then what each seat state looks like. */
export function SeatLegend({ categories }: { categories: CategoryInfo[] }) {
  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
      <ul aria-label="Categories and prices" className="flex flex-wrap gap-x-7 gap-y-3">
        {categories.map((c) => (
          <li key={c.category} className="flex items-center gap-2.5">
            <Swatch look="available" tier={c.tier} />
            <span className="text-[15px] text-text">{formatCategory(c.category)}</span>
            <span className="label-mono text-text-2">{formatPriceRange(c.minPaise, c.maxPaise)}</span>
          </li>
        ))}
      </ul>
      <ul aria-label="Seat states" className="flex flex-wrap gap-x-6 gap-y-3">
        {STATES.map((s) => (
          <li key={s.look} className="label-mono flex items-center gap-2 text-text-2">
            <Swatch look={s.look} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
