/** Categories are stored as free text ("LIVE_MUSIC"); show unknown ones as "Live music". */
export function formatCategory(category: string): string {
  const words = category.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const showDate = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Sat, 14 Mar, 7:30 pm" in the viewer's time zone; null for an unparseable value. */
export function formatShowDate(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : showDate.format(date);
}

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const wholeRupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** 120000 paise -> "₹1,200"; 120050 -> "₹1,200.50". Money in the API is always integer paise. */
export function formatPaise(paise: number): string {
  return paise % 100 === 0 ? wholeRupees.format(paise / 100) : rupees.format(paise / 100);
}
