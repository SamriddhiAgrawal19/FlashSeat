import { formatCategory } from './format';

export interface Category {
  /** Exact value sent to GET /events?category= (case-sensitive, exact match). */
  value: string;
  label: string;
}

// The backend stores event.category as free text and filters with an exact,
// case-sensitive match. MUSIC and THEATRE are the values the codebase uses
// (tests/, load/seed.mjs, docs/api.md); the rest follow the same UPPERCASE
// convention so organizers can match them.
export const CATEGORIES: Category[] = [
  { value: 'MUSIC', label: 'Music' },
  { value: 'COMEDY', label: 'Comedy' },
  { value: 'THEATRE', label: 'Theatre' },
  { value: 'SPORTS', label: 'Sports' },
  { value: 'WORKSHOP', label: 'Workshops' },
  { value: 'FESTIVAL', label: 'Fests' },
];

/** Friendly label for a stored category value. */
export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? formatCategory(value);
}
