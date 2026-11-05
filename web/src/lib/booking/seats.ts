// Seat-map helpers shared by the seat map page, its components and the hold page.
import type { SeatMap, SeatStatus } from '../api';
import { formatCategory, formatPaise } from '../format';

/** From reservations.schema.ts (env MAX_SEATS_PER_RESERVATION, default 6). Not exposed by the API. */
export const MAX_SEATS_PER_HOLD = 6;
/** From env HOLD_DURATION_SECONDS (600). Not exposed before a hold; after one, expiresAt is the truth. */
export const HOLD_MINUTES = 10;

export interface SeatInfo {
  id: string;
  section: string;
  row: string;
  number: number;
  category: string;
  pricePaise: number;
  status: SeatStatus;
}

/** Every seat by id, flattened from sections -> rows -> seats. */
export function indexSeats(map: SeatMap): Map<string, SeatInfo> {
  const index = new Map<string, SeatInfo>();
  for (const section of map.sections) {
    for (const row of section.rows) {
      for (const seat of row.seats) {
        index.set(seat.id, { ...seat, section: section.section, row: row.row });
      }
    }
  }
  return index;
}

/** "C5" */
export function seatCode(seat: { row: string; number: number }): string {
  return `${seat.row}${seat.number}`;
}

/** "C5, C6 and D1" */
export function joinCodes(codes: string[]): string {
  if (codes.length <= 1) return codes[0] ?? '';
  return `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`;
}

/** "Row C, seat 5, Regular, ₹600" (screen readers and tooltips). */
export function seatDescription(seat: SeatInfo, withSection: boolean): string {
  const where = `Row ${seat.row}, seat ${seat.number}`;
  return `${withSection ? `${formatCategory(seat.section)}, ` : ''}${where}, ${formatCategory(seat.category)}, ${formatPaise(seat.pricePaise)}`;
}

export interface CategoryInfo {
  category: string;
  /** Lowest and highest price of the category on this map (normally equal). */
  minPaise: number;
  maxPaise: number;
  /** 0 = cheapest. Drives the seat outline strength so tiers read apart without extra colors. */
  tier: number;
}

/** Categories on the map, cheapest first. */
export function categoriesOf(map: SeatMap): CategoryInfo[] {
  const byCategory = new Map<string, { min: number; max: number }>();
  for (const section of map.sections) {
    for (const row of section.rows) {
      for (const seat of row.seats) {
        const entry = byCategory.get(seat.category);
        if (entry) {
          entry.min = Math.min(entry.min, seat.pricePaise);
          entry.max = Math.max(entry.max, seat.pricePaise);
        } else {
          byCategory.set(seat.category, { min: seat.pricePaise, max: seat.pricePaise });
        }
      }
    }
  }
  return [...byCategory.entries()]
    .sort((a, b) => a[1].min - b[1].min || a[0].localeCompare(b[0]))
    .map(([category, { min, max }], tier) => ({ category, minPaise: min, maxPaise: max, tier }));
}
