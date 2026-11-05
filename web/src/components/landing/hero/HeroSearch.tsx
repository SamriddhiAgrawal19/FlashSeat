import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ChevronDown } from 'lucide-react';
import { CATEGORIES } from '../../../lib/categories';
import { cn } from '../../../lib/cn';
import { Arrow } from '../../ui/Button';

const fieldBox = 'flex h-12 min-w-0 items-center gap-3 px-4';
const control =
  'h-full w-full min-w-0 bg-transparent text-[15px] text-text placeholder:text-text-2 focus-visible:outline-offset-[-2px]';

/** Compact city + category search. The API filters are exact match only, so there is no free-text query. */
export function HeroSearch() {
  const navigate = useNavigate();
  const [city, setCity] = useState('');
  const [category, setCategory] = useState('');

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    const trimmedCity = city.trim();
    if (trimmedCity) params.set('city', trimmedCity);
    if (category) params.set('category', category);
    const search = params.toString();
    navigate(search ? `/events?${search}` : '/events');
  };

  return (
    <form
      role="search"
      aria-label="Find events"
      onSubmit={onSubmit}
      className="grid w-full border border-rule sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:w-auto lg:grid-cols-[15rem_14rem_auto]"
    >
      <div className={cn(fieldBox, 'border-b border-rule sm:border-r sm:border-b-0')}>
        <label htmlFor="search-city" className="label-mono shrink-0 text-text-2">
          City
        </label>
        <input
          id="search-city"
          name="city"
          type="text"
          autoComplete="address-level2"
          placeholder="Anywhere"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className={control}
        />
      </div>

      <div className={cn(fieldBox, 'relative border-b border-rule sm:border-b-0')}>
        <label htmlFor="search-category" className="label-mono shrink-0 text-text-2">
          What
        </label>
        <select
          id="search-category"
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={cn(control, 'appearance-none pr-6', !category && 'text-text-2')}
        >
          <option value="">Anything</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 size-4 text-text-2" strokeWidth={1.5} aria-hidden="true" />
      </div>

      <button
        type="submit"
        className="group flex h-12 items-center justify-center gap-2 bg-lime px-6 text-[15px] font-medium text-bg transition-colors hover:bg-lime-hover"
      >
        Search <Arrow />
      </button>
    </form>
  );
}
