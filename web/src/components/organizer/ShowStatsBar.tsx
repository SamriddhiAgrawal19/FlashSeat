import { cn } from '../../lib/cn';
import { formatCount } from '../../lib/organizer';

export interface ShowStats {
  total: number;
  available: number;
  held: number;
  booked: number;
}

/** A stacked bar (booked coral | held white | available grey) with the numbers in mono underneath. */
export function ShowStatsBar({ stats, muted = false, className }: { stats: ShowStats; muted?: boolean; className?: string }) {
  const pct = (n: number) => (stats.total > 0 ? `${(n / stats.total) * 100}%` : '0%');
  return (
    <div className={cn('og-sbar-wrap', className)}>
      <div
        role="img"
        aria-label={`${stats.booked} of ${stats.total} seats booked, ${stats.held} held, ${stats.available} available`}
        className={cn('og-sbar', muted && 'is-muted')}
      >
        <span style={{ width: pct(stats.booked), background: 'var(--accent)' }} />
        <span style={{ width: pct(stats.held), background: 'var(--text)' }} />
      </div>
      <span aria-hidden="true" className="og-nums">
        {formatCount(stats.booked)} BOOKED · {formatCount(stats.held)} HELD · {formatCount(stats.available)} AVAILABLE
      </span>
    </div>
  );
}
