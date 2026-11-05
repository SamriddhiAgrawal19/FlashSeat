import { useEffect, useRef, useState } from 'react';
import { CATEGORIES } from '../../lib/categories';
import { DATE_PRESETS, matchPreset, presetRange } from '../../lib/dateRanges';
import { Chip, Tab } from '../site/ui';
import type { EventFilters } from './useEventFilters';

function PinIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B8B94" strokeWidth="1.8">
      <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

/** City input, debounced 300ms. Re-syncs when the URL changes underneath it (Back/Forward, Clear). */
export function CityInput({ id, value, onCommit }: { id: string; value: string; onCommit: (city: string) => void }) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    const next = draft.trim();
    if (next === committed.current) return;
    const timer = window.setTimeout(() => {
      committed.current = next;
      commit.current(next);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft]);

  return (
    <label className="ev-city" htmlFor={id}>
      <PinIcon />
      <span className="sr-only">City</span>
      <input
        id={id}
        type="search"
        autoComplete="address-level2"
        placeholder="Any city"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
    </label>
  );
}

/** "All" plus every category, as pills. Case-insensitive, so ?category=music presses "Music". */
export function CategoryPills({ value, onChange }: { value: string; onChange: (category: string) => void }) {
  const selected = CATEGORIES.find((c) => c.value.toLowerCase() === value.toLowerCase())?.value ?? value;
  return (
    <div role="group" aria-label="Category" className="ev-pills">
      <Chip pressed={!selected} onClick={() => onChange('')}>
        All
      </Chip>
      {CATEGORIES.map((c) => (
        <Chip key={c.value} pressed={selected === c.value} onClick={() => onChange(c.value)}>
          {c.label}
        </Chip>
      ))}
    </div>
  );
}

/** This weekend / Next 7 days / This month / Any date. A custom range from the URL presses none. */
export function DateTabs({
  dateFrom,
  dateTo,
  onChange,
}: {
  dateFrom: string;
  dateTo: string;
  onChange: (range: { dateFrom: string; dateTo: string }) => void;
}) {
  const active = matchPreset(dateFrom || null, dateTo || null);
  const anyDate = !dateFrom && !dateTo;
  return (
    <div role="group" aria-label="Date" className="ev-tabs">
      {DATE_PRESETS.map((p) => (
        <Tab key={p.id} pressed={active === p.id} onClick={() => onChange(presetRange(p.id))}>
          {p.label}
        </Tab>
      ))}
      <Tab pressed={anyDate} onClick={() => onChange({ dateFrom: '', dateTo: '' })}>
        Any date
      </Tab>
    </div>
  );
}

export interface FilterControlsProps {
  idPrefix: string;
  filters: EventFilters;
  setFilters: (patch: Partial<Omit<EventFilters, 'page'>>, opts?: { replace?: boolean }) => void;
}
