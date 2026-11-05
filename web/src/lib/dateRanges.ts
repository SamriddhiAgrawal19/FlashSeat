// Quick date filters for /events. Each range is anchored to local day boundaries, so the same
// chip produces the same dateFrom/dateTo all day and can be recognised again from the URL.
// The API compares dateFrom with a show's starts_at and dateTo with its ends_at.

export type DatePreset = 'weekend' | 'next7' | 'month';

export const DATE_PRESETS: Array<{ id: DatePreset; label: string; phrase: string }> = [
  { id: 'weekend', label: 'This weekend', phrase: 'this weekend' },
  { id: 'next7', label: 'Next 7 days', phrase: 'in the next 7 days' },
  { id: 'month', label: 'This month', phrase: 'this month' },
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** The range for a preset as ISO strings (what the API's dateFrom/dateTo accept). */
export function presetRange(preset: DatePreset, now: Date = new Date()): { dateFrom: string; dateTo: string } {
  const today = startOfDay(now);
  let from = today;
  let to: Date;
  if (preset === 'weekend') {
    const weekday = today.getDay(); // 0 Sun ... 6 Sat
    if (weekday === 0) {
      to = endOfDay(today); // already Sunday: just today
    } else {
      const saturday = addDays(today, 6 - weekday);
      from = weekday === 6 ? today : saturday;
      to = endOfDay(addDays(saturday, 1));
    }
  } else if (preset === 'next7') {
    to = endOfDay(addDays(today, 6));
  } else {
    to = endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  }
  return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
}

/** Which preset (if any) a URL's dateFrom/dateTo correspond to today. */
export function matchPreset(dateFrom: string | null, dateTo: string | null, now: Date = new Date()): DatePreset | null {
  if (!dateFrom || !dateTo) return null;
  for (const { id } of DATE_PRESETS) {
    const range = presetRange(id, now);
    if (range.dateFrom === dateFrom && range.dateTo === dateTo) return id;
  }
  return null;
}
