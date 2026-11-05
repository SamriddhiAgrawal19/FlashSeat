import type { SeatMap as SeatMapData, SeatMapSeat } from '../../lib/api';
import { formatCategory } from '../../lib/format';
import { seatDescription } from '../../lib/booking/seats';
import { Seat, type SeatLook } from './Seat';

interface SeatMapProps {
  map: SeatMapData;
  selected: ReadonlySet<string>;
  /** Seats we know are gone (409 SEATS_UNAVAILABLE) before the cached map catches up. */
  takenLocally: ReadonlySet<string>;
  tiers: ReadonlyMap<string, number>;
  locked: boolean;
  onToggle: (seatId: string) => void;
}

function lookOf(seat: SeatMapSeat, selected: ReadonlySet<string>, takenLocally: ReadonlySet<string>): SeatLook {
  switch (seat.status) {
    case 'HELD':
      return 'held';
    case 'BOOKED':
      return 'booked';
    case 'UNAVAILABLE':
      return 'unavailable';
    case 'AVAILABLE':
      if (takenLocally.has(seat.id)) return 'held';
      return selected.has(seat.id) ? 'selected' : 'available';
  }
}

function RowLabel({ label }: { label: string }) {
  return (
    <span aria-hidden="true" className="label-mono w-6 shrink-0 text-center text-text-3">
      {label}
    </span>
  );
}

/**
 * The venue as the API returns it: sections, then rows in API order, then seats. Wide venues
 * scroll sideways inside their own container; the page itself never scrolls horizontally.
 */
export function SeatMap({ map, selected, takenLocally, tiers, locked, onToggle }: SeatMapProps) {
  const multipleSections = map.sections.length > 1;
  return (
    <div
      className="overflow-x-auto overscroll-x-contain border-y border-rule py-10"
      role="region"
      aria-label="Seat map. Scroll sideways for more seats."
      tabIndex={0}
    >
      <div className="flex w-max min-w-full justify-center px-4">
        {/* The stage spans the widest row, so it lines up with the seats at any width. */}
        <div className="flex min-w-[16rem] flex-col gap-10">
          <div>
            <div className="h-1.5 w-full rounded-t-full bg-text/25" />
            <p className="label-mono mt-2 text-center text-text-2">Stage</p>
          </div>

          {map.sections.map((section) => (
            <section key={section.section} aria-label={multipleSections ? `Section ${formatCategory(section.section)}` : 'Seats'} className="flex flex-col items-center gap-2">
              {multipleSections && <p className="label-mono mb-2 text-text-2">{formatCategory(section.section)}</p>}
              {section.rows.map((row) => (
                <div key={row.row} role="group" aria-label={`Row ${row.row}`} className="flex items-center gap-3">
                  <RowLabel label={row.row} />
                  <div className="flex gap-1.5">
                    {row.seats.map((seat) => (
                      <Seat
                        key={seat.id}
                        id={seat.id}
                        number={seat.number}
                        look={lookOf(seat, selected, takenLocally)}
                        tier={tiers.get(seat.category) ?? 0}
                        label={seatDescription({ ...seat, section: section.section, row: row.row }, multipleSections)}
                        locked={locked}
                        onToggle={onToggle}
                      />
                    ))}
                  </div>
                  <RowLabel label={row.row} />
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
