// A read-only, compact seat layout: stage at the top, one line per row, seats as small squares
// shaded by category. Rows are drawn as segments (a repeating gradient per run of same-category
// seats), not one element per seat, so a 20,000-seat venue stays cheap to render.
import type { VenueLayout } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatCount } from '../../lib/organizer';

export interface PreviewSegment {
  category: string;
  count: number;
}

export interface PreviewRow {
  row: string;
  segments: PreviewSegment[];
  /** Highlighted as a problem (e.g. the row already exists). */
  conflict?: boolean;
}

export interface PreviewSection {
  section: string;
  rows: PreviewRow[];
  /** A general-admission zone (row G): drawn as a block, not as squares. */
  standing?: { count: number; category: string; conflict?: boolean };
}

const SEAT = 7;
const PITCH = 9;
// Shades of the text color, cheapest/most common first. No new colors: lime stays for actions.
const ALPHAS = [0.3, 0.6, 0.92, 0.16, 0.45, 0.75];
const KNOWN_ORDER = ['REGULAR', 'STANDARD', 'PREMIUM', 'VIP'];

/** Categories in shading order: the known tiers first (cheapest to priciest), then alphabetical. */
export function orderCategories(categories: Iterable<string>): string[] {
  return [...new Set(categories)].sort((a, b) => {
    const ia = KNOWN_ORDER.indexOf(a);
    const ib = KNOWN_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
}

export function categoryColor(category: string, order: string[]): string {
  const i = Math.max(0, order.indexOf(category));
  return `rgb(242 239 233 / ${ALPHAS[i % ALPHAS.length]})`;
}

/** Convert the API layout into preview sections (runs of same-category seats per row). */
export function layoutToPreview(layout: VenueLayout): PreviewSection[] {
  return layout.sections.map(({ section, rows }) => {
    const out: PreviewSection = { section, rows: [] };
    for (const { row, seats } of rows) {
      const segments: PreviewSegment[] = [];
      for (const seat of seats) {
        const last = segments[segments.length - 1];
        if (last && last.category === seat.category) last.count++;
        else segments.push({ category: seat.category, count: 1 });
      }
      out.rows.push({ row, segments });
    }
    return out;
  });
}

export function previewTotals(sections: PreviewSection[]): Map<string, number> {
  const totals = new Map<string, number>();
  const add = (category: string, n: number) => totals.set(category, (totals.get(category) ?? 0) + n);
  for (const s of sections) {
    for (const r of s.rows) for (const seg of r.segments) add(seg.category, seg.count);
    if (s.standing) add(s.standing.category, s.standing.count);
  }
  return totals;
}

function Segment({ segment, order }: { segment: PreviewSegment; order: string[] }) {
  const color = categoryColor(segment.category, order);
  return (
    <span
      className="block shrink-0"
      style={{
        width: segment.count * PITCH - (PITCH - SEAT),
        height: SEAT,
        marginRight: PITCH - SEAT,
        backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 ${SEAT}px, transparent ${SEAT}px ${PITCH}px)`,
      }}
    />
  );
}

export function CategoryTotals({ totals, order, className }: { totals: Map<string, number>; order: string[]; className?: string }) {
  const total = [...totals.values()].reduce((a, b) => a + b, 0);
  return (
    <dl className={cn('flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[12px]', className)}>
      {order
        .filter((c) => totals.has(c))
        .map((c) => (
          <div key={c} className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5" style={{ backgroundColor: categoryColor(c, order) }} />
            <dt className="text-text-2">{c}</dt>
            <dd className="text-text">{formatCount(totals.get(c) ?? 0)}</dd>
          </div>
        ))}
      <div className="flex items-center gap-2 border-l border-rule pl-5">
        <dt className="text-text-3">TOTAL</dt>
        <dd className="text-lime">{formatCount(total)}</dd>
      </div>
    </dl>
  );
}

/** The drawing. `label` names it for screen readers; the totals give the same facts as text. */
export function LayoutPreview({ sections, order, label, className }: { sections: PreviewSection[]; order: string[]; label: string; className?: string }) {
  const widest = Math.max(
    1,
    ...sections.flatMap((s) => s.rows.map((r) => r.segments.reduce((n, seg) => n + seg.count, 0))),
  );
  const width = widest * PITCH;
  const totals = previewTotals(sections);
  const summary = order
    .filter((c) => totals.has(c))
    .map((c) => `${formatCount(totals.get(c) ?? 0)} ${c}`)
    .join(', ');

  return (
    <figure className={cn('min-w-0', className)}>
      <figcaption className="sr-only">
        {label}: {summary || 'no seats'}.
      </figcaption>
      <div aria-hidden="true" className="overflow-x-auto pb-2">
        <div className="mx-auto w-max min-w-full">
          <div className="mx-auto mb-5 flex h-6 max-w-[min(100%,28rem)] items-center justify-center border border-text/25 bg-text/[0.04]" style={{ minWidth: Math.min(width, 160) }}>
            <span className="label-mono text-[10px] text-text-3">Stage</span>
          </div>
          <div className="space-y-5">
            {sections.map((s) => (
              <div key={s.section}>
                {(sections.length > 1 || s.section !== 'MAIN') && <p className="label-mono mb-2 text-center text-[10px] text-text-3">{s.section}</p>}
                <div className="flex flex-col items-center gap-[3px]">
                  {s.rows.map((r) => (
                    <div key={r.row} className="flex items-center gap-2">
                      <span className={cn('w-7 shrink-0 text-right font-mono text-[10px] leading-none', r.conflict ? 'text-danger' : 'text-text-3')}>{r.row}</span>
                      <span className={cn('flex', r.conflict && 'outline outline-1 outline-offset-2 outline-danger/70')}>
                        {r.segments.map((seg, i) => (
                          <Segment key={i} segment={seg} order={order} />
                        ))}
                      </span>
                      <span className="w-7 shrink-0" />
                    </div>
                  ))}
                  {s.standing && (
                    <div
                      className={cn(
                        'flex h-12 w-full max-w-[28rem] min-w-40 items-center justify-center gap-2 border border-dashed font-mono text-[11px]',
                        s.standing.conflict ? 'border-danger/70 text-danger' : 'border-text/30 text-text-2',
                      )}
                      style={{ backgroundColor: `${categoryColor(s.standing.category, order).replace(/\/ [\d.]+\)/, '/ 0.08)')}` }}
                    >
                      {formatCount(s.standing.count)} standing · {s.standing.category}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
