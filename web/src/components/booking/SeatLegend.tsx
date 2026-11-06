import type { CategoryInfo } from '../../lib/booking/seats';
import { formatPriceRange } from '../../lib/format';
import { seatCategoryLabel } from './seatLayout';

/** Real categories with real prices (most expensive first), then "Yours" and "Taken". */
export function SeatLegend({ categories, shades }: { categories: CategoryInfo[]; shades: ReadonlyMap<string, string> }) {
  const byPrice = [...categories].reverse();
  return (
    <ul className="bk-legend" aria-label="Seat categories and prices">
      {byPrice.map((c) => (
        <li key={c.category}>
          <i aria-hidden="true" className="bk-swatch" style={{ borderColor: shades.get(c.category) }} />
          {seatCategoryLabel(c.category)} · {formatPriceRange(c.minPaise, c.maxPaise)}
        </li>
      ))}
      <li>
        <i aria-hidden="true" className="bk-swatch is-yours" />
        Yours
      </li>
      <li>
        <i aria-hidden="true" className="bk-swatch is-taken" />
        Taken
      </li>
    </ul>
  );
}
