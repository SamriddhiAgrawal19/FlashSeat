import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SeatMapSeat } from '../../lib/api';
import { formatCategory, formatPaise } from '../../lib/format';
import { seatCategoryLabel, type SeatLayout } from './seatLayout';
import { Seat, type SeatLook } from './Seat';

interface SeatMapProps {
  layout: SeatLayout;
  selected: ReadonlySet<string>;
  /** Seats we know are gone (409 SEATS_UNAVAILABLE) before the cached map catches up. */
  takenLocally: ReadonlySet<string>;
  /** Seats that went from available to taken on the last refresh (pulse once). */
  justTaken: ReadonlySet<string>;
  /** Outline colour per category. */
  shades: ReadonlyMap<string, string>;
  /** 0.7 .. 1.4, on top of the fit-to-container scale. */
  zoom: number;
  locked: boolean;
  onToggle: (seatId: string) => void;
  onPreview: (seatId: string | null) => void;
}

export function lookOf(seat: Pick<SeatMapSeat, 'id' | 'status'>, selected: ReadonlySet<string>, takenLocally: ReadonlySet<string>): SeatLook {
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

/** Below this the map scrolls instead of shrinking further (seats stay tappable). */
function minScale(boxWidth: number): number {
  return boxWidth < 768 ? 0.78 : 0.5;
}

/**
 * The curved auditorium. Drawn at its natural size, then scaled to fit its box (times the zoom);
 * when that is wider or taller than the box, the box scrolls (never the page).
 */
export function SeatMap({ layout, selected, takenLocally, justTaken, shades, zoom, locked, onToggle, onPreview }: SeatMapProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBoxWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = boxWidth > 0 ? Math.min(1, Math.max(minScale(boxWidth), boxWidth / layout.width)) : 1;
  const scale = fit * zoom;

  // Keep the middle of the view in the middle when the scale changes (zoom, resize, first fit).
  const centre = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const c = centre.current ?? { x: 0.5, y: 0 };
    el.scrollLeft = c.x * el.scrollWidth - el.clientWidth / 2;
    if (centre.current) el.scrollTop = c.y * el.scrollHeight - el.clientHeight / 2;
  }, [scale]);
  const onScroll = () => {
    const el = boxRef.current;
    if (!el || el.scrollWidth === 0) return;
    centre.current = {
      x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
      y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight,
    };
  };

  // Arrow keys move between seats that can take focus (left/right in a row, up/down to the nearest).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const target = e.target as HTMLElement;
    const id = target.dataset.seatId;
    if (!id) return;
    const index = layout.seats.findIndex((p) => p.seat.id === id);
    const here = layout.seats[index];
    if (!here) return;
    const focusable = (i: number) => boxRef.current?.querySelector<HTMLButtonElement>(`[data-seat-id="${CSS.escape(layout.seats[i]!.seat.id)}"]:not(:disabled)`);
    let next: HTMLButtonElement | null | undefined = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const line = layout.lines[here.line] ?? [];
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      for (let p = line.indexOf(index) + step; p >= 0 && p < line.length && !next; p += step) next = focusable(line[p]!);
    } else {
      const step = e.key === 'ArrowUp' ? -1 : 1;
      for (let l = here.line + step; l >= 0 && l < layout.lines.length && !next; l += step) {
        const candidates = [...(layout.lines[l] ?? [])].sort((a, b) => Math.abs(layout.seats[a]!.x - here.x) - Math.abs(layout.seats[b]!.x - here.x));
        for (const c of candidates) {
          next = focusable(c);
          if (next) break;
        }
      }
    }
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  const withSection = layout.multipleSections;
  return (
    <div
      ref={boxRef}
      className="bk-mapbox"
      role="region"
      aria-label="Seat map. Use the arrow keys to move between seats."
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onMouseLeave={() => onPreview(null)}
    >
      <div className="bk-map-sizer" style={{ width: layout.width * scale, height: layout.height * scale }}>
        <div className="bk-map" style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
          <div className="bk-stage" aria-hidden="true" style={{ left: layout.stage.left, width: layout.stage.width }}>
            <span>STAGE</span>
          </div>
          {layout.sectionLabels.map((s) => (
            <span key={s.key} className="bk-seclabel" style={{ top: s.y }}>
              {s.label}
            </span>
          ))}
          {layout.rowLabels.map((r) => (
            <span key={r.key} aria-hidden="true" className="bk-rowlabel" style={{ left: Math.round(r.x), top: Math.round(r.y) }}>
              {r.label}
            </span>
          ))}
          {layout.seats.map(({ seat, x, y, angle }) => (
            <Seat
              key={seat.id}
              id={seat.id}
              look={lookOf(seat, selected, takenLocally)}
              shade={shades.get(seat.category) ?? '#A1A1AA'}
              x={x}
              y={y}
              angle={angle}
              label={`${withSection ? `${formatCategory(seat.section)}, ` : ''}Row ${seat.row}, seat ${seat.number}, ${seatCategoryLabel(seat.category)}, ${formatPaise(seat.pricePaise)}`}
              just={justTaken.has(seat.id)}
              locked={locked}
              onToggle={onToggle}
              onPreview={onPreview}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
