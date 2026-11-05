// Pure formatting helpers. Dates and times use the viewer's local time zone; money is integer paise.

/** Categories are stored as free text ("LIVE_MUSIC"); show unknown ones as "Live music". */
export function formatCategory(category: string): string {
  const words = category.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function toDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

// --- money ---------------------------------------------------------------------------------

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const wholeRupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** 120000 paise -> "₹1,200"; 120050 -> "₹1,200.50". Money in the API is always integer paise. */
export function formatPaise(paise: number): string {
  return paise % 100 === 0 ? wholeRupees.format(paise / 100) : rupees.format(paise / 100);
}

/** "₹600 – ₹1,200", or a single price when min and max are equal. */
export function formatPriceRange(minPaise: number, maxPaise: number): string {
  return minPaise === maxPaise ? formatPaise(minPaise) : `${formatPaise(minPaise)} – ${formatPaise(maxPaise)}`;
}

// --- dates ---------------------------------------------------------------------------------

const dayParts = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const timeParts = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
const dayMonthParts = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const fullDateParts = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/** "7:30 PM" */
export function formatTime(iso: string): string | null {
  const date = toDate(iso);
  if (!date) return null;
  const parts = timeParts.formatToParts(date);
  return `${part(parts, 'hour')}:${part(parts, 'minute')} ${part(parts, 'dayPeriod').toUpperCase()}`;
}

/** "Sat, 14 Mar" */
export function formatShowDay(iso: string): string | null {
  const date = toDate(iso);
  if (!date) return null;
  const parts = dayParts.formatToParts(date);
  return `${part(parts, 'weekday')}, ${part(parts, 'day')} ${part(parts, 'month')}`;
}

/** "Sat, 14 Mar · 7:30 PM" */
export function formatShowDate(iso: string): string | null {
  const day = formatShowDay(iso);
  const time = formatTime(iso);
  return day && time ? `${day} · ${time}` : null;
}

/** "Sat, 14 Mar 2026" */
export function formatFullDate(iso: string): string | null {
  const date = toDate(iso);
  if (!date) return null;
  const parts = fullDateParts.formatToParts(date);
  return `${part(parts, 'weekday')}, ${part(parts, 'day')} ${part(parts, 'month')} ${part(parts, 'year')}`;
}

/** Pieces for a calendar-style date block: { day: "14", month: "Mar", weekday: "Sat", time: "7:30 PM" }. */
export function showDateParts(iso: string): { day: string; month: string; weekday: string; time: string } | null {
  const date = toDate(iso);
  const time = formatTime(iso);
  if (!date || !time) return null;
  const parts = dayParts.formatToParts(date);
  return { day: part(parts, 'day'), month: part(parts, 'month'), weekday: part(parts, 'weekday'), time };
}

/** "14 – 16 Mar", "28 Mar – 2 Apr", or a single day. Either end may be missing ("From 14 Mar"). */
export function formatDateRange(fromIso: string | null, toIso: string | null): string | null {
  const from = fromIso ? toDate(fromIso) : null;
  const to = toIso ? toDate(toIso) : null;
  if (!from && !to) return null;
  if (from && !to) return `From ${dayMonthParts.format(from)}`;
  if (!from && to) return `Until ${dayMonthParts.format(to)}`;
  const a = dayMonthParts.formatToParts(from as Date);
  const b = dayMonthParts.formatToParts(to as Date);
  const sameMonth = part(a, 'month') === part(b, 'month');
  const sameDay = sameMonth && part(a, 'day') === part(b, 'day');
  if (sameDay) return dayMonthParts.format(from as Date);
  return sameMonth
    ? `${part(a, 'day')} – ${part(b, 'day')} ${part(b, 'month')}`
    : `${part(a, 'day')} ${part(a, 'month')} – ${part(b, 'day')} ${part(b, 'month')}`;
}
