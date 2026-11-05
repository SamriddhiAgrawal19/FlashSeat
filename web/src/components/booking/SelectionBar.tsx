import type { SeatInfo } from '../../lib/booking/seats';
import { HOLD_MINUTES, seatCode } from '../../lib/booking/seats';
import { formatCategory, formatPaise } from '../../lib/format';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { Container } from '../ui/Container';

interface SelectionBarProps {
  seats: SeatInfo[];
  holding: boolean;
  /** "Retrying…" status while the hold request backs off. */
  holdingNote: string | null;
  /** Inline note, e.g. the per-hold seat limit. */
  note: string | null;
  onRemove: (seatId: string) => void;
  onHold: () => void;
}

function Spinner() {
  return <span aria-hidden="true" className="inline-block size-4 animate-spin rounded-full border-2 border-bg/30 border-t-bg" />;
}

/** Sticky bottom bar: picked seats as removable chips, the total and "Hold seats". */
export function SelectionBar({ seats, holding, holdingNote, note, onRemove, onHold }: SelectionBarProps) {
  const total = seats.reduce((sum, s) => sum + s.pricePaise, 0);
  return (
    <div className="sticky bottom-0 z-30 border-t border-rule bg-bg/95 backdrop-blur-md">
      <Container className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between md:gap-8">
        <div className="min-w-0">
          {seats.length === 0 ? (
            <p className="text-[15px] text-text-2">Tap a seat to pick it.</p>
          ) : (
            <ul aria-label="Your seats" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 md:flex-wrap md:overflow-visible">
              {seats.map((seat) => (
                <li key={seat.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => onRemove(seat.id)}
                    disabled={holding}
                    aria-label={`Remove row ${seat.row}, seat ${seat.number}`}
                    className="group flex h-9 items-center gap-2 rounded-[2px] border border-lime/60 pr-2 pl-3 text-[14px] text-text transition-colors hover:border-lime disabled:opacity-50"
                  >
                    <span className="font-medium">{seatCode(seat)}</span>
                    <span className="label-mono text-text-2">{formatCategory(seat.category)}</span>
                    <span aria-hidden="true" className="text-text-2 group-hover:text-lime">
                      ✕
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p aria-live="polite" className="mt-2 min-h-4 text-[13px] text-text-2">
            {note ?? holdingNote ?? `Seats are held for you for ${HOLD_MINUTES} minutes while you check out.`}
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-6 md:justify-end">
          <p className="flex flex-col">
            <span className="label-mono text-text-2">
              {seats.length} seat{seats.length === 1 ? '' : 's'} · Total
            </span>
            <span className="text-title font-medium text-text">{formatPaise(total)}</span>
          </p>
          <Button onClick={onHold} disabled={seats.length === 0 || holding} aria-busy={holding} className={cn('min-w-40', holding && 'disabled:opacity-100')}>
            {holding ? (
              <>
                <Spinner /> Holding…
              </>
            ) : (
              'Hold seats'
            )}
          </Button>
        </div>
      </Container>
    </div>
  );
}
