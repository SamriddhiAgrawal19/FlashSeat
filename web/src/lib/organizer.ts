// Pure helpers for the organizer dashboard: row labels, local date-time inputs, money input,
// show/event summaries. No React here.
import { ROW_LABEL_PATTERN, type OrganizerEvent, type OrganizerShow } from './api';

// --- row labels ------------------------------------------------------------------------------

export type RowParse = { ok: true; rows: string[] } | { ok: false; error: string };

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_RANGE = 500;

function expandRange(from: string, to: string): string[] | string {
  if (/^\d+$/.test(from) && /^\d+$/.test(to)) {
    const a = Number(from);
    const b = Number(to);
    if (a > b) return `${from}–${to} runs backwards.`;
    if (b - a + 1 > MAX_RANGE) return `${from}–${to} is more than ${MAX_RANGE} rows.`;
    return Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
  }
  if (/^[A-Z]$/.test(from) && /^[A-Z]$/.test(to)) {
    const a = LETTERS.indexOf(from);
    const b = LETTERS.indexOf(to);
    if (a > b) return `${from}–${to} runs backwards.`;
    return LETTERS.slice(a, b + 1).split('');
  }
  return `Ranges work between single letters (A–F) or numbers (1–12), not "${from}–${to}".`;
}

/**
 * "A–C", "A-C, F", "1-12" or "AA, AB" -> uppercase row labels in the order given.
 * Labels must be 1–4 letters or digits (the API rule) and unique.
 */
export function parseRowLabels(input: string): RowParse {
  const tokens = input
    .split(/[,\s]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  // A spaced range ("A - C") splits into three tokens; join them back.
  const joined: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    const after = tokens[i + 1];
    if ((token === '-' || token === '–') && joined.length > 0 && after) {
      joined[joined.length - 1] = `${joined[joined.length - 1] ?? ''}-${after}`;
      i++;
    } else {
      joined.push(token);
    }
  }
  if (joined.length === 0) return { ok: false, error: 'Enter at least one row, e.g. A–C.' };

  const rows: string[] = [];
  for (const token of joined) {
    const parts = token.split(/[-–]/);
    if (parts.length === 2 && parts[0] && parts[1]) {
      const expanded = expandRange(parts[0], parts[1]);
      if (typeof expanded === 'string') return { ok: false, error: expanded };
      rows.push(...expanded);
    } else if (parts.length === 1 && ROW_LABEL_PATTERN.test(token)) {
      rows.push(token);
    } else {
      return { ok: false, error: `"${token}" isn't a row label (1–4 letters or digits).` };
    }
  }
  const dupes = [...new Set(rows.filter((r, i) => rows.indexOf(r) !== i))];
  if (dupes.length > 0) return { ok: false, error: `Row ${dupes.join(', ')} is listed twice.` };
  return { ok: true, rows };
}

/** "A–C" for consecutive single letters/numbers, else "A, C, F". */
export function describeRows(rows: string[]): string {
  const first = rows[0];
  const last = rows[rows.length - 1] ?? '';
  if (first === undefined) return '';
  if (rows.length === 1) return first;
  const isLetterRun = rows.every((r, i) => /^[A-Z]$/.test(r) && (i === 0 || LETTERS.indexOf(r) === LETTERS.indexOf(rows[i - 1] ?? '') + 1));
  const isNumberRun = rows.every((r, i) => /^\d+$/.test(r) && (i === 0 || Number(r) === Number(rows[i - 1]) + 1));
  if (isLetterRun || isNumberRun) return `${first}–${last}`;
  return rows.length > 6 ? `${rows.slice(0, 5).join(', ')} … ${last}` : rows.join(', ');
}

/** Normalized seat tag (section/category): trimmed, uppercase, like the API stores it. */
export function normalizeTag(value: string, fallback: string): string {
  const trimmed = value.trim().toUpperCase();
  return trimmed === '' ? fallback : trimmed;
}

// --- date-time inputs ------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** A Date as the value of <input type="datetime-local"> in the viewer's time zone. */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A datetime-local value (local time) -> Date, or null when empty/invalid. */
export function fromLocalInput(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value); // "YYYY-MM-DDTHH:mm" without a zone parses as local time
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The viewer's zone, e.g. "Asia/Kolkata", for form hints. */
export function localZoneName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
}

// --- money -----------------------------------------------------------------------------------

/** "1,200" or "600.50" (rupees) -> paise; null for empty, negative, or more than 2 decimals. */
export function rupeesToPaise(value: string): number | null {
  const cleaned = value.replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const paise = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}

// --- summaries -------------------------------------------------------------------------------

export function isUpcoming(show: OrganizerShow, now: number): boolean {
  return show.status === 'SCHEDULED' && Date.parse(show.starts_at) > now;
}

/** The earliest upcoming SCHEDULED show, if any. */
export function nextShow(event: OrganizerEvent, now: number): OrganizerShow | null {
  return event.shows.find((s) => isUpcoming(s, now)) ?? null;
}

/** Booked and total seats across all of an event's shows. */
export function seatTotals(event: OrganizerEvent): { booked: number; total: number } {
  return event.shows.reduce((acc, s) => ({ booked: acc.booked + s.seats_booked, total: acc.total + s.seats_total }), { booked: 0, total: 0 });
}

/** "Good morning" / "Good afternoon" / "Good evening" for the viewer's local hour. */
export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const integer = new Intl.NumberFormat('en-IN');
export const formatCount = (n: number) => integer.format(n);
