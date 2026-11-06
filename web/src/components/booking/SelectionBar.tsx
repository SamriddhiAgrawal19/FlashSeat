import type { SeatInfo } from '../../lib/booking/seats';
import { HOLD_MINUTES, MAX_SEATS_PER_HOLD, seatCode } from '../../lib/booking/seats';
import { cn } from '../../lib/cn';
import { formatPaise } from '../../lib/format';

interface SelectionProps {
  /** Selected seats, already sorted in map order. */
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
  return <span aria-hidden="true" className="bk-spin" />;
}

function holdLabel(seats: SeatInfo[], total: number): string {
  if (seats.length === 0) return 'Choose seats to continue';
  return `Hold ${seats.length} ${seats.length === 1 ? 'seat' : 'seats'} · ${formatPaise(total)}`;
}

function HoldButton({ seats, total, holding, onHold, compact = false }: { seats: SeatInfo[]; total: number; holding: boolean; onHold: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onHold}
      disabled={seats.length === 0 || holding}
      aria-busy={holding}
      className={cn('site-btn site-btn-accent bk-btn-block bk-hold-btn', holding && 'is-busy', compact && 'is-compact')}
    >
      {holding ? (
        <>
          <Spinner /> Holding…
        </>
      ) : (
        <>
          {compact && seats.length > 0 ? `Hold ${seats.length}` : holdLabel(seats, total)} <span className="site-arr" aria-hidden="true">→</span>
        </>
      )}
    </button>
  );
}

function Chips({ seats, holding, onRemove }: Pick<SelectionProps, 'seats' | 'holding' | 'onRemove'>) {
  return (
    <ul aria-label="Your seats" className="bk-chips">
      {seats.map((seat) => (
        <li key={seat.id}>
          <button type="button" className="bk-chip" onClick={() => onRemove(seat.id)} disabled={holding} aria-label={`Remove row ${seat.row}, seat ${seat.number}`}>
            {seatCode(seat)} <span aria-hidden="true">×</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Right panel (768px and up): chips, total, "Hold N seats · ₹X", the seat limit and the hold time. */
export function SelectionCard({ seats, holding, holdingNote, note, onRemove, onHold }: SelectionProps) {
  const total = seats.reduce((sum, s) => sum + s.pricePaise, 0);
  return (
    <div className="bk-card bk-selcard">
      <div className="bk-selhead">
        <span className="bk-mono-label">
          YOUR SEATS · {seats.length}/{MAX_SEATS_PER_HOLD}
        </span>
        <span className="bk-total">{formatPaise(total)}</span>
      </div>
      <div className="bk-chips-wrap">
        {seats.length > 0 ? <Chips seats={seats} holding={holding} onRemove={onRemove} /> : <span className="bk-hint">Tap a seat on the map. Hover to preview the view.</span>}
      </div>
      <p aria-live="polite" className={cn('bk-note', !note && !holdingNote && 'is-empty')}>
        {note ?? holdingNote}
      </p>
      <HoldButton seats={seats} total={total} holding={holding} onHold={onHold} />
      <span className="bk-small">Your seats are kept for you for {HOLD_MINUTES} minutes while you check out.</span>
    </div>
  );
}

/** Below 768px: a sticky bottom bar with the chips, count, total and the hold button. */
export function MobileSelectionBar({ seats, holding, holdingNote, note, onRemove, onHold }: SelectionProps) {
  const total = seats.reduce((sum, s) => sum + s.pricePaise, 0);
  return (
    <div className="bk-bar">
      {seats.length > 0 && <Chips seats={seats} holding={holding} onRemove={onRemove} />}
      <p aria-live="polite" className="bk-note">
        {note ?? holdingNote ?? (seats.length === 0 ? `Tap a seat to pick it. Up to ${MAX_SEATS_PER_HOLD} seats, held for ${HOLD_MINUTES} minutes.` : '')}
      </p>
      <div className="bk-bar-row">
        <div className="bk-bar-sum">
          <span className="bk-mono-label">
            {seats.length}/{MAX_SEATS_PER_HOLD} SEATS
          </span>
          <span className="bk-bar-total">{formatPaise(total)}</span>
        </div>
        <HoldButton seats={seats} total={total} holding={holding} onHold={onHold} compact />
      </div>
    </div>
  );
}
