import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { CATEGORIES } from '../../lib/categories';
import { cn } from '../../lib/cn';
import { DATE_PRESETS, matchPreset, presetRange } from '../../lib/dateRanges';
import type { EventFilters } from './useEventFilters';

const fieldClass =
  'h-11 w-full min-w-0 border border-rule bg-surface px-3.5 text-[15px] text-text placeholder:text-text-2 transition-colors focus-visible:border-lime focus-visible:outline-none';

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
    <div>
      <label htmlFor={id} className="label-mono block text-text-2">
        City
      </label>
      <input
        id={id}
        type="search"
        autoComplete="address-level2"
        placeholder="Any city"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className={cn(fieldClass, 'mt-2')}
      />
    </div>
  );
}

export function CategorySelect({ id, value, onChange }: { id: string; value: string; onChange: (category: string) => void }) {
  // Case-insensitive on the API, so a hand-typed ?category=music still selects "Music" here.
  const selected = CATEGORIES.find((c) => c.value.toLowerCase() === value.toLowerCase())?.value ?? value;
  return (
    <div>
      <label htmlFor={id} className="label-mono block text-text-2">
        Category
      </label>
      <div className="relative mt-2">
        <select id={id} value={selected} onChange={(e) => onChange(e.target.value)} className={cn(fieldClass, 'appearance-none pr-9')}>
          <option value="">All</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
          {selected && !CATEGORIES.some((c) => c.value === selected) && <option value={selected}>{selected}</option>}
        </select>
        <ChevronDown aria-hidden="true" strokeWidth={1.5} className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-2" />
      </div>
    </div>
  );
}

/** Quick date ranges. "Any date" clears them. A custom range from the URL leaves no chip pressed. */
export function DateChips({
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
  const chip = (pressed: boolean) =>
    cn(
      'h-11 shrink-0 border px-3.5 text-[14px] whitespace-nowrap transition-colors focus-visible:outline-offset-[-2px]',
      pressed ? 'border-lime bg-lime text-bg' : 'border-rule text-text-2 hover:border-text/40 hover:text-text',
    );
  return (
    <fieldset>
      <legend className="label-mono text-text-2">When</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {DATE_PRESETS.map((p) => (
          <button key={p.id} type="button" aria-pressed={active === p.id} onClick={() => onChange(presetRange(p.id))} className={chip(active === p.id)}>
            {p.label}
          </button>
        ))}
        <button type="button" aria-pressed={anyDate} onClick={() => onChange({ dateFrom: '', dateTo: '' })} className={chip(anyDate)}>
          Any date
        </button>
      </div>
    </fieldset>
  );
}

export interface FilterControlsProps {
  idPrefix: string;
  filters: EventFilters;
  setFilters: (patch: Partial<Omit<EventFilters, 'page'>>, opts?: { replace?: boolean }) => void;
}
