import { memo, type CSSProperties } from 'react';
import { cn } from '../../lib/cn';

export type SeatLook = 'available' | 'selected' | 'held' | 'booked' | 'unavailable';

interface SeatProps {
  id: string;
  look: SeatLook;
  /** Category outline colour (by price rank). */
  shade: string;
  x: number;
  y: number;
  angle: number;
  /** "Row C, seat 5, Premium, ₹799" (the state is appended here). */
  label: string;
  /** Just changed from available to taken on the last refresh: pulse once. */
  just: boolean;
  /** No clicks while a hold request is in flight, or when the map is read-only. */
  locked: boolean;
  onToggle: (id: string) => void;
  onPreview: (id: string) => void;
}

/** One seat of the curved map (docs/booking-flow-design.html): a small rounded-top button. */
export const Seat = memo(function Seat({ id, look, shade, x, y, angle, label, just, locked, onToggle, onPreview }: SeatProps) {
  const taken = look === 'held' || look === 'booked' || look === 'unavailable';
  const selected = look === 'selected';
  const state = selected ? 'selected' : taken ? 'taken' : 'available';
  return (
    <button
      type="button"
      data-seat-id={id}
      data-look={look}
      aria-pressed={selected}
      aria-label={`${label}, ${state}`}
      title={`${label}, ${state}`}
      disabled={taken || locked}
      onClick={() => onToggle(id)}
      onMouseEnter={() => onPreview(id)}
      onFocus={() => onPreview(id)}
      className={cn('bk-seat', selected && 'is-sel', taken && 'is-taken', just && 'is-just', locked && !taken && 'is-locked')}
      style={{ left: Math.round(x), top: Math.round(y), transform: angle ? `rotate(${angle.toFixed(1)}deg)` : undefined, '--shade': shade } as CSSProperties}
    />
  );
});
