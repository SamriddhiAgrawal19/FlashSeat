import { cn } from '../../lib/cn';
import { formatCount } from '../../lib/organizer';

export interface ShowStats {
  total: number;
  available: number;
  held: number;
  booked: number;
}

const HATCH = 'bg-[repeating-linear-gradient(135deg,rgb(242_239_233/0.4)_0_1.5px,transparent_1.5px_4px)]';

/** A thin stacked bar (booked | held | available) with the numbers in mono underneath. */
export function ShowStatsBar({ stats, muted = false, className }: { stats: ShowStats; muted?: boolean; className?: string }) {
  const pct = (n: number) => (stats.total > 0 ? `${(n / stats.total) * 100}%` : '0%');
  const items = [
    { label: 'Booked', value: stats.booked, swatch: 'bg-text/80', key: true },
    { label: 'Held', value: stats.held, swatch: HATCH },
    { label: 'Available', value: stats.available, swatch: 'bg-text/15' },
    { label: 'Total', value: stats.total },
  ];
  return (
    <div className={cn('min-w-0', className)}>
      <div
        role="img"
        aria-label={`${stats.booked} of ${stats.total} seats booked, ${stats.held} held, ${stats.available} available`}
        className="flex h-1.5 w-full overflow-hidden bg-text/15"
      >
        <span className={cn('h-full transition-[width] duration-500', muted ? 'bg-text/40' : 'bg-text/80')} style={{ width: pct(stats.booked) }} />
        <span className={cn('h-full transition-[width] duration-500', HATCH)} style={{ width: pct(stats.held) }} />
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            {item.swatch && <span aria-hidden="true" className={cn('size-2', item.swatch)} />}
            <dt className="text-text-3">{item.label}</dt>
            <dd className={item.key && !muted ? 'text-lime' : 'text-text'}>{formatCount(item.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
