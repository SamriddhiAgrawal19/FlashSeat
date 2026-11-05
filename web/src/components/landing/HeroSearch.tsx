import { useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ChevronDown } from 'lucide-react';
import { CATEGORIES } from '../../lib/categories';
import { cn } from '../../lib/cn';

/**
 * City + category search (same behaviour as before: /events?city=&category=). The API filters
 * are exact match only, so there is no free-text query.
 */
export function HeroSearch({ className, style }: { className?: string; style?: CSSProperties }) {
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
    <form role="search" aria-label="Find events" onSubmit={onSubmit} className={cn('lp-search', className)} style={style}>
      <label className="lp-field">
        <span className="lp-field-label">CITY</span>
        <input
          name="city"
          type="text"
          autoComplete="address-level2"
          placeholder="Any city"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="lp-input"
        />
      </label>
      <label className="lp-field">
        <span className="lp-field-label">CATEGORY</span>
        <select
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={cn('lp-input lp-select', !category && 'is-empty')}
        >
          <option value="">Anything</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <ChevronDown className="lp-caret" size={14} strokeWidth={1.75} aria-hidden="true" />
      </label>
      <button type="submit" className="lp-search-btn">
        Search
      </button>
    </form>
  );
}
