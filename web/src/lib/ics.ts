// "Add to calendar": an iCalendar (.ics, RFC 5545) file built in the browser and downloaded.
// No external services. Times are written in UTC (…Z), so every calendar app shows them in the
// viewer's own time zone.

export interface CalendarEvent {
  uid: string;
  title: string;
  startIso: string;
  endIso: string;
  location: string;
  description?: string;
}

/** 2026-11-14T14:00:00.000Z -> 20261114T140000Z */
function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Escape TEXT values: backslash, semicolon, comma and newlines. */
function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold lines longer than 75 octets (approximated by characters) with CRLF + space. */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 74) parts.push(line.slice(i, i + 74));
  return parts.join('\r\n ');
}

export function buildIcs(event: CalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FlashSeat//Tickets//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(event.startIso)}`,
    `DTEND:${icsDate(event.endIso)}`,
    `SUMMARY:${icsText(event.title)}`,
    `LOCATION:${icsText(event.location)}`,
    ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Download the event as "<title>.ics". */
export function downloadIcs(event: CalendarEvent): void {
  const blob = new Blob([buildIcs(event)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${event.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'event'}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
