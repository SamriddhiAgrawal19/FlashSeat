// A read-only seat layout (docs/organizer-dashboard-design.html "LIVE PREVIEW"): stage line, then
// one line per row with seat-shaped cells outlined in the category's shade. Big layouts (a venue
// can have 20,000 seats) draw each run of same-category seats as one striped segment instead.
import type { CSSProperties } from 'react';
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
  /** A general-admission zone (row G): drawn as a block, not as seats. */
  standing?: { count: number; category: string; conflict?: boolean };
}

/** Shade by order of categories: first #FAFAFA, then #A1A1AA, #5B5B66, #3F3F46, … */
const SHADES = ['#FAFAFA', '#A1A1AA', '#5B5B66', '#3F3F46', '#34343B', '#2B2B31'];
/** Above this many seats in one drawing, rows are drawn as striped segments. */
const MAX_CELLS = 3000;
const CELL = 12;
const GAP = 4;

/** Categories in first-seen order (deduplicated). The order drives the shades. */
export function orderCategories(categories: Iterable<string>): string[] {
  return [...new Set(categories)];
}

/** Categories as they appear walking the sections and rows (for the shade order). */
export function categoriesInOrder(sections: PreviewSection[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    for (const r of s.rows) for (const seg of r.segments) out.push(seg.category);
    if (s.standing) out.push(s.standing.category);
  }
  return orderCategories(out);
}

export function categoryColor(category: string, order: string[]): string {
  const i = Math.max(0, order.indexOf(category));
  return SHADES[Math.min(i, SHADES.length - 1)] ?? '#3F3F46';
}

/** Convert the API layout into preview sections (runs of same-category seats per row). */
export function layoutToPreview(layout: VenueLayout): PreviewSection[] {
  return layout.sections.map(({ section, rows }) => {
    const out: PreviewSection = { section, rows: [] };
    // The API stores a general-admission zone as the section's only row, G.
    if (rows.length === 1 && rows[0]?.row === 'G' && new Set(rows[0].seats.map((s) => s.category)).size === 1 && rows[0].seats.length > 40) {
      out.standing = { count: rows[0].seats.length, category: rows[0].seats[0]?.category ?? '' };
      return out;
    }
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

/** "VIP 24 · PREMIUM 56 · REGULAR 64 · TOTAL 144" with a shade dot per category. */
export function CategoryTotals({ totals, order, className }: { totals: Map<string, number>; order: string[]; className?: string }) {
  const total = [...totals.values()].reduce((a, b) => a + b, 0);
  return (
    <dl className={cn('og-breakdown', className)} style={{ margin: 0 }}>
      {order
        .filter((c) => totals.has(c))
        .map((c) => (
          <span key={c}>
            <i aria-hidden="true" className="og-sw" style={{ width: 8, height: 8, background: categoryColor(c, order) }} />
            <dt>{c}</dt>
            <dd style={{ margin: 0, color: 'var(--text)' }}>{formatCount(totals.get(c) ?? 0)}</dd>
          </span>
        ))}
      <span>
        <dt style={{ color: 'var(--text-3)' }}>TOTAL</dt>
        <dd style={{ margin: 0, color: 'var(--text)' }}>{formatCount(total)}</dd>
      </span>
    </dl>
  );
}

function countCells(sections: PreviewSection[]): number {
  return sections.reduce((n, s) => n + s.rows.reduce((m, r) => m + r.segments.reduce((k, seg) => k + seg.count, 0), 0), 0);
}

function Row({ row, order, cells }: { row: PreviewRow; order: string[]; cells: boolean }) {
  return (
    <div className="og-prow">
      <span className={cn('og-prow-label', row.conflict && 'is-conflict')}>{row.row}</span>
      {row.segments.map((seg, i) => {
        const c = categoryColor(seg.category, order);
        if (cells) {
          return Array.from({ length: seg.count }, (_, j) => <span key={`${i}-${j}`} className="og-pseat" style={{ '--c': c } as CSSProperties} />);
        }
        const width = seg.count * (CELL + GAP) - GAP;
        return (
          <span
            key={i}
            className="og-pseg"
            style={{ width, backgroundImage: `repeating-linear-gradient(90deg, ${c} 0 ${CELL}px, transparent ${CELL}px ${CELL + GAP}px)`, opacity: 0.8 }}
          />
        );
      })}
      <span className="og-prow-label" aria-hidden="true" />
    </div>
  );
}

/** The rows of some sections (no stage). Section names show when there are several, or not MAIN. */
export function PreviewRows({ sections, order, cells }: { sections: PreviewSection[]; order: string[]; cells?: boolean }) {
  const drawCells = cells ?? countCells(sections) <= MAX_CELLS;
  return (
    <>
      {sections.map((s) => (
        <div key={s.section} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: GAP }}>
          {(sections.length > 1 || s.section !== 'MAIN') && <span className="og-psec">{s.section}</span>}
          {s.rows.map((r) => (
            <Row key={r.row} row={r} order={order} cells={drawCells} />
          ))}
          {s.standing && (
            <div
              className="og-pstand"
              style={{ '--c': s.standing.conflict ? '#FF8A6E' : categoryColor(s.standing.category, order) } as CSSProperties}
            >
              {formatCount(s.standing.count)} standing · {s.standing.category}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/** Stage line plus the rows. `label` names the drawing for screen readers; the totals give the same facts. */
export function LayoutPreview({ sections, order, label, className }: { sections: PreviewSection[]; order: string[]; label: string; className?: string }) {
  const totals = previewTotals(sections);
  const summary = order
    .filter((c) => totals.has(c))
    .map((c) => `${formatCount(totals.get(c) ?? 0)} ${c}`)
    .join(', ');
  return (
    <figure className={cn('og-preview-scroll', className)} style={{ margin: 0 }}>
      <figcaption className="sr-only">
        {label}: {summary || 'no seats'}.
      </figcaption>
      <div aria-hidden="true" className="og-preview-in">
        <div className="og-stage" />
        <span className="og-stage-label">STAGE</span>
        <PreviewRows sections={sections} order={order} />
      </div>
    </figure>
  );
}
