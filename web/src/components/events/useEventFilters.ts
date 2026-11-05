import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

/** /events filters. The URL (?city=&category=&dateFrom=&dateTo=&page=) is the source of truth. */
export interface EventFilters {
  city: string;
  category: string;
  dateFrom: string;
  dateTo: string;
  page: number;
}

type FilterPatch = Partial<Omit<EventFilters, 'page'>>;

const KEYS = ['city', 'category', 'dateFrom', 'dateTo'] as const;

export function useEventFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<EventFilters>(() => {
    const page = Number(params.get('page'));
    return {
      city: params.get('city') ?? '',
      category: params.get('category') ?? '',
      dateFrom: params.get('dateFrom') ?? '',
      dateTo: params.get('dateTo') ?? '',
      page: Number.isInteger(page) && page > 1 ? page : 1,
    };
  }, [params]);

  const write = useCallback(
    (next: EventFilters, replace: boolean) => {
      const out = new URLSearchParams();
      for (const key of KEYS) if (next[key]) out.set(key, next[key]);
      if (next.page > 1) out.set('page', String(next.page));
      setParams(out, { replace });
    },
    [setParams],
  );

  /**
   * Change one or more filters; always goes back to page 1. Typing (city) replaces the history
   * entry so every keystroke isn't a Back step; discrete choices push one, so Back undoes them.
   */
  const setFilters = useCallback(
    (patch: FilterPatch, { replace = false }: { replace?: boolean } = {}) => write({ ...filters, ...patch, page: 1 }, replace),
    [filters, write],
  );

  const setPage = useCallback((page: number) => write({ ...filters, page }, false), [filters, write]);

  const clear = useCallback(() => write({ city: '', category: '', dateFrom: '', dateTo: '', page: 1 }, false), [write]);

  // City, category, and one for any date range.
  const activeCount = [filters.city, filters.category, filters.dateFrom || filters.dateTo].filter(Boolean).length;

  return { filters, setFilters, setPage, clear, activeCount, hasFilters: activeCount > 0 };
}
