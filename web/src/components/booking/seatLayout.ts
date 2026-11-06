// Geometry of the curved auditorium (docs/booking-flow-design.html, renderVals), built from the
// REAL seat map: sections and rows in API order, seats left to right. Each row is centred, and
// seats are lifted toward the stage on a gentle parabola by their distance from the row centre,
// each rotated slightly to face the centre. Gaps only where the API shows a break: a new section
// (vertical gap + label) or a jump in seat numbers within a row (an aisle).
// General-admission sections (one row "G": docs/api.md GENERAL_ADMISSION) are a straight grid.
import type { SeatMap } from '../../lib/api';
import type { SeatInfo } from '../../lib/booking/seats';
import { formatCategory } from '../../lib/format';

export const SEAT_W = 22;
export const SEAT_H = 20;
/** Seat-to-seat distance in a row (22px seat + 8px gap), as in the design. */
const PITCH = 30;
/** Extra space where seat numbers jump (an aisle in the real layout). */
const AISLE = 22;
const ROW_PITCH = 40;
/** Room above the first row for the stage. */
const TOP = 92;
/** Room on each side for the row letters. */
const SIDE = 46;
const SECTION_LABEL = 28;
const SECTION_GAP = 22;
/** The design's curvature (k) for its widest row (half-width ~367px); wider rows curve less. */
const K = 0.00026;
const K_REF_HALF = 367;
const GA_COLS = 24;
const GA_PITCH_Y = 32;
const MIN_WIDTH = 420;

export interface PlacedSeat {
  seat: SeatInfo;
  /** Top-left of the seat, in map pixels. */
  x: number;
  y: number;
  /** Degrees. */
  angle: number;
  /** 0 = front row, counting every row (and every GA grid line) across sections. */
  rowIndex: number;
  /** Horizontal offset from the centre, -1 (far left) .. 1 (far right). */
  dxNorm: number;
  /** Index into `rows` (keyboard navigation). */
  line: number;
  /** API order across the whole map (sorting chips). */
  order: number;
}

export interface SeatLayout {
  width: number;
  height: number;
  stage: { left: number; width: number };
  seats: PlacedSeat[];
  /** Seat indexes (into `seats`) per visual line, left to right. */
  lines: number[][];
  rowLabels: Array<{ key: string; label: string; x: number; y: number }>;
  sectionLabels: Array<{ key: string; label: string; y: number }>;
  totalRows: number;
  multipleSections: boolean;
  generalAdmission: boolean;
}

/** One row labelled G is how the API stores a general-admission block. */
export function isGeneralAdmission(section: SeatMap['sections'][number]): boolean {
  return section.rows.length === 1 && section.rows[0]?.row === 'G';
}

interface RowPlan {
  section: string;
  row: string;
  seats: SeatInfo[];
  /** x of each seat relative to the row's first seat. */
  xs: number[];
  width: number;
}

export function buildSeatLayout(map: SeatMap): SeatLayout {
  const multipleSections = map.sections.length > 1;

  // Pass 1: row widths (and GA grid widths) to find the widest line.
  type Block = { kind: 'rows'; section: string; rows: RowPlan[] } | { kind: 'ga'; section: string; seats: SeatInfo[]; cols: number };
  const blocks: Block[] = [];
  let widest = 0;
  for (const section of map.sections) {
    if (isGeneralAdmission(section)) {
      const row = section.rows[0]!;
      const seats = row.seats.map((s) => ({ ...s, section: section.section, row: row.row }));
      const cols = Math.max(1, Math.min(GA_COLS, seats.length));
      widest = Math.max(widest, (cols - 1) * PITCH + SEAT_W);
      blocks.push({ kind: 'ga', section: section.section, seats, cols });
      continue;
    }
    const rows: RowPlan[] = section.rows.map((row) => {
      const seats = row.seats.map((s) => ({ ...s, section: section.section, row: row.row }));
      const xs: number[] = [];
      let x = 0;
      seats.forEach((seat, i) => {
        if (i > 0) x += PITCH + (seat.number - seats[i - 1]!.number > 1 ? AISLE : 0);
        xs.push(x);
      });
      const width = seats.length ? x + SEAT_W : 0;
      widest = Math.max(widest, width);
      return { section: section.section, row: row.row, seats, xs, width };
    });
    blocks.push({ kind: 'rows', section: section.section, rows });
  }

  const width = Math.max(MIN_WIDTH, Math.ceil(widest + SIDE * 2));
  const cx = width / 2;
  const half = Math.max(1, widest / 2);
  const k = K * Math.min(1, (K_REF_HALF / half) ** 2);

  // Pass 2: positions.
  const seats: PlacedSeat[] = [];
  const lines: number[][] = [];
  const rowLabels: SeatLayout['rowLabels'] = [];
  const sectionLabels: SeatLayout['sectionLabels'] = [];
  let y = TOP;
  let rowIndex = 0;
  let order = 0;
  const generalAdmission = blocks.length > 0 && blocks.every((b) => b.kind === 'ga');

  blocks.forEach((block, bi) => {
    if (bi > 0) y += SECTION_GAP;
    if (multipleSections || block.kind === 'ga') {
      sectionLabels.push({ key: `s-${block.section}`, label: block.kind === 'ga' ? `${block.section} · GENERAL ADMISSION` : block.section, y });
      y += SECTION_LABEL;
    }
    if (block.kind === 'ga') {
      const gridWidth = (block.cols - 1) * PITCH + SEAT_W;
      const x0 = cx - gridWidth / 2;
      for (let i = 0; i < block.seats.length; i += block.cols) {
        const line: number[] = [];
        block.seats.slice(i, i + block.cols).forEach((seat, c) => {
          const x = x0 + c * PITCH;
          line.push(seats.length);
          seats.push({ seat, x, y, angle: 0, rowIndex, dxNorm: (x + SEAT_W / 2 - cx) / half, line: lines.length, order: order++ });
        });
        lines.push(line);
        rowIndex++;
        y += GA_PITCH_Y;
      }
      y += ROW_PITCH - GA_PITCH_Y;
      return;
    }
    for (const row of block.rows) {
      const x0 = cx - row.width / 2;
      const line: number[] = [];
      row.seats.forEach((seat, i) => {
        const x = x0 + row.xs[i]!;
        const dx = x + SEAT_W / 2 - cx;
        const sy = y - k * dx * dx;
        const angle = -Math.atan(2 * k * dx) * (180 / Math.PI);
        if (i === 0) rowLabels.push({ key: `${row.section}-${row.row}`, label: row.row, x: x - 26, y: sy + 3 });
        line.push(seats.length);
        seats.push({ seat, x, y: sy, angle, rowIndex, dxNorm: dx / half, line: lines.length, order: order++ });
      });
      lines.push(line);
      rowIndex++;
      y += ROW_PITCH;
    }
  });

  const stageWidth = Math.round(Math.min(400, Math.max(180, widest * 0.55)));
  return {
    width,
    height: Math.max(y + 8, TOP + 60),
    stage: { left: Math.round(cx - stageWidth / 2), width: stageWidth },
    seats,
    lines,
    rowLabels,
    sectionLabels,
    totalRows: rowIndex,
    multipleSections,
    generalAdmission,
  };
}

// --- category shades -----------------------------------------------------------------------

const STOPS = ['#FAFAFA', '#A1A1AA', '#5B5B66'].map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));

/** Outline shade by price rank: 0 = most expensive (#FAFAFA) .. last = cheapest (#5B5B66). */
export function shadeForRank(rank: number, count: number): string {
  const t = count <= 1 ? 0 : rank / (count - 1);
  const pos = t * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = STOPS[i]!;
  const b = STOPS[i + 1]!;
  const rgb = a.map((v, j) => Math.round(v + (b[j]! - v) * f));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Seat category for display: short acronyms stay upper case ("VIP", "GA"), others "Premium". */
export function seatCategoryLabel(category: string): string {
  return /^[A-Z]{2,3}$/.test(category) ? category : formatCategory(category);
}
