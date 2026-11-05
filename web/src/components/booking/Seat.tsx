import { memo } from 'react';
import { cn } from '../../lib/cn';

export type SeatLook = 'available' | 'selected' | 'held' | 'booked' | 'unavailable';

// Outline strength per price tier (cheapest first), so categories read apart without new colors.
const TIER_OUTLINES = ['border-text/35', 'border-text/65', 'border-text/95'];

export function tierOutline(tier: number): string {
  return TIER_OUTLINES[tier % TIER_OUTLINES.length] ?? 'border-text/35';
}

/** Fill per state. Lime is reserved for the user's own selection. */
export function seatLookClass(look: SeatLook, tier: number): string {
  switch (look) {
    case 'available':
      return cn('border bg-transparent', tierOutline(tier), 'hover:border-lime hover:bg-lime/10');
    case 'selected':
      return 'border border-lime bg-lime text-bg';
    case 'held':
      // Diagonal hatching: taken for now, may come back.
      return 'border border-text/15 bg-[repeating-linear-gradient(135deg,rgb(242_239_233/0.28)_0_1.5px,transparent_1.5px_5px)]';
    case 'booked':
      return 'border border-transparent bg-text/25';
    case 'unavailable':
      return 'border border-transparent bg-text/[0.07]';
  }
}

interface SeatProps {
  id: string;
  number: number;
  look: SeatLook;
  tier: number;
  /** "Row C, seat 5, Regular, ₹600" */
  label: string;
  /** No clicks while a hold request is in flight, or when the map is read-only. */
  locked: boolean;
  onToggle: (id: string) => void;
}

/** One seat: a small square button. Its number shows on hover and keyboard focus. */
export const Seat = memo(function Seat({ id, number, look, tier, label, locked, onToggle }: SeatProps) {
  const taken = look === 'held' || look === 'booked' || look === 'unavailable';
  const state = look === 'held' ? ', held' : look === 'booked' ? ', booked' : look === 'unavailable' ? ', unavailable' : '';
  return (
    <button
      type="button"
      data-seat-id={id}
      data-look={look}
      aria-pressed={look === 'selected'}
      aria-label={`${label}${state}`}
      title={`${label}${state}`}
      disabled={taken || locked}
      onClick={() => onToggle(id)}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-[2px] font-mono text-[10px] leading-none font-medium transition-colors duration-150',
        'text-transparent hover:text-text focus-visible:text-text',
        seatLookClass(look, tier),
        look === 'selected' && 'text-bg hover:text-bg focus-visible:text-bg',
        taken && 'cursor-not-allowed hover:text-transparent',
        locked && !taken && 'cursor-wait',
      )}
    >
      {number}
    </button>
  );
});
