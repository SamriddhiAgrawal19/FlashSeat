import type { EventListItem } from './api';
import { formatDateRange } from './format';

// /events groups the current page by each event's next show date (viewer's local time):
//   "This week"        today .. this Sunday            range "6 – 8 NOV"
//   "Later this month"  after Sunday .. end of month   range "9 – 30 NOV"
//   one group per later month ("December", "January 2027")  range "DEC 2026"
// Only the current page is grouped; inside a group, events are ordered by next show start.

export interface EventGroup {
  key: string;
  title: string;
  /** Mono date range for the group header. */
  range: string;
  events: EventListItem[];
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const monthName = new Intl.DateTimeFormat('en-IN', { month: 'long' });
const monthShort = new Intl.DateTimeFormat('en-IN', { month: 'short' });

export function startsAt(event: EventListItem): number {
  return event.next_show ? Date.parse(event.next_show.starts_at) : Number.POSITIVE_INFINITY;
}

export function bySoonest(a: EventListItem, b: EventListItem): number {
  return startsAt(a) - startsAt(b) || a.id.localeCompare(b.id);
}

export function groupEventsByDate(events: EventListItem[], now: Date = new Date()): EventGroup[] {
  const today = startOfDay(now);
  // Sunday ends the week (getDay: 0 = Sunday).
  const sunday = endOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((7 - today.getDay()) % 7)));
  const monthEnd = endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  const groups = new Map<string, EventGroup>();
  const add = (key: string, make: () => Omit<EventGroup, 'events'>, event: EventListItem) => {
    const group = groups.get(key) ?? { ...make(), events: [] };
    group.events.push(event);
    groups.set(key, group);
  };

  for (const event of [...events].sort(bySoonest)) {
    const t = startsAt(event);
    if (t <= sunday.getTime()) {
      add('week', () => ({ key: 'week', title: 'This week', range: (formatDateRange(today.toISOString(), sunday.toISOString()) ?? '').toUpperCase() }), event);
    } else if (t <= monthEnd.getTime()) {
      const from = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + 1);
      add('later', () => ({ key: 'later', title: 'Later this month', range: (formatDateRange(from.toISOString(), monthEnd.toISOString()) ?? '').toUpperCase() }), event);
    } else if (Number.isFinite(t)) {
      const d = new Date(t);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const sameYear = d.getFullYear() === today.getFullYear();
      add(
        key,
        () => ({
          key,
          title: sameYear ? monthName.format(d) : `${monthName.format(d)} ${d.getFullYear()}`,
          range: `${monthShort.format(d).toUpperCase()} ${d.getFullYear()}`,
        }),
        event,
      );
    } else {
      add('tbc', () => ({ key: 'tbc', title: 'Dates to be announced', range: '' }), event);
    }
  }
  // Insertion order already follows the sorted events, so groups come out in date order.
  return [...groups.values()];
}

/** "A night train. Six strangers." -> ["A night train.", "Six strangers."]; no sentence end -> [all, ""]. */
export function splitFirstSentence(text: string): [string, string] {
  const trimmed = text.trim();
  const match = /^(.+?[.!?])(\s+)([\s\S]*)$/.exec(trimmed);
  return match ? [match[1]!, match[3]!.trim()] : [trimmed, ''];
}
