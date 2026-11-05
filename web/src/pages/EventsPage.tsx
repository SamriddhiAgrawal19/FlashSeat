import { useEffect, useRef } from 'react';
import '../components/events/events.css';
import { EventListSkeleton, EventResultsView, EventsEmpty, EventsError, PageEmpty, Pagination } from '../components/events/EventResults';
import { FilterBar } from '../components/events/FilterBar';
import { useEventFilters, type EventFilters } from '../components/events/useEventFilters';
import { usePlayWhenVisible } from '../components/site/hooks';
import { Eyebrow } from '../components/site/ui';
import { categoryLabel } from '../lib/categories';
import { cn } from '../lib/cn';
import { DATE_PRESETS, matchPreset } from '../lib/dateRanges';
import { formatDateRange } from '../lib/format';
import { useEventsList } from '../lib/queries';

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** The headline's last word: "tonight." or the category ("comedy.", "fests."). */
function headWord(category: string): string {
  return category ? `${categoryLabel(category).toLowerCase()}.` : 'tonight.';
}

/**
 * The subtitle under the headline, from the filters:
 *   none                -> "Every upcoming show, sorted by date."
 *   category only       -> "Upcoming comedy across all cities."
 *   otherwise           -> "Theatre in Pune, this weekend." / "Events in Pune." / "Every upcoming show, this month."
 */
function subtitle(filters: EventFilters): string {
  const city = filters.city ? titleCase(filters.city) : '';
  const cat = filters.category ? categoryLabel(filters.category) : '';
  const preset = matchPreset(filters.dateFrom || null, filters.dateTo || null);
  const when = preset
    ? DATE_PRESETS.find((p) => p.id === preset)?.phrase
    : formatDateRange(filters.dateFrom || null, filters.dateTo || null)?.replace(/^\w/, (c) => c.toLowerCase());

  if (!city && !cat && !when) return 'Every upcoming show, sorted by date.';
  if (cat && !city && !when) return `Upcoming ${cat.toLowerCase()} across all cities.`;
  let text = cat && city ? `${cat} in ${city}` : cat || (city ? `Events in ${city}` : 'Every upcoming show');
  if (when) text += `, ${when}`;
  return `${text}.`;
}

export function EventsPage() {
  const { filters, setFilters, setPage, clear, hasFilters, activeCount } = useEventFilters();
  const { city, category, dateFrom, dateTo, page } = filters;
  const query = useEventsList({
    city: city || undefined,
    category: category || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
  });
  const resultsRef = useRef<HTMLDivElement>(null);
  const previousPage = useRef(page);
  const pulse = usePlayWhenVisible<HTMLSpanElement>();

  useEffect(() => {
    document.title = 'Events · FlashSeat';
  }, []);

  // On page change, bring the top of the results into view (below the sticky bars).
  useEffect(() => {
    if (previousPage.current !== page) resultsRef.current?.scrollIntoView({ block: 'start' });
    previousPage.current = page;
  }, [page]);

  const data = query.data;
  const refreshing = query.isFetching && query.isPlaceholderData;
  const word = headWord(category);

  return (
    <>
      <section aria-labelledby="events-title" className="site-wrap ev-head">
        <div className="ev-head-text">
          <Eyebrow>Explore</Eyebrow>
          {/* Keyed on the last word, so a category change replays the word reveal. */}
          <h1 id="events-title" key={word} className="ev-h1">
            <span className="site-w" style={{ animationDelay: '.05s' }}>
              What's
            </span>{' '}
            <span className="site-w" style={{ animationDelay: '.12s' }}>
              on
            </span>{' '}
            <span className="site-w site-serif" style={{ animationDelay: '.2s' }}>
              {word}
            </span>
          </h1>
          <p className="ev-sub" aria-live="polite">
            {subtitle(filters)}
          </p>
        </div>
        {data && (
          <span ref={pulse.ref} className={cn('ev-count', !pulse.playing && 'site-paused')}>
            <i className="site-pulse" aria-hidden="true" />
            {data.total} EVENT{data.total === 1 ? '' : 'S'} ON SALE
          </span>
        )}
      </section>

      <FilterBar
        idPrefix="events"
        filters={filters}
        setFilters={setFilters}
        hasFilters={hasFilters}
        activeCount={activeCount}
        onClear={clear}
        total={data?.total}
      />

      <div
        ref={resultsRef}
        className="site-wrap ev-main"
        style={{ scrollMarginTop: 'calc(var(--site-header-h) + 72px)' }}
        aria-busy={refreshing || undefined}
      >
        {refreshing && (
          <div className="ev-loading-line" aria-hidden="true">
            <span />
          </div>
        )}

        {query.isPending ? (
          <EventListSkeleton />
        ) : query.isError && !data ? (
          <EventsError onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : data && data.events.length === 0 && data.total > 0 ? (
          <PageEmpty onFirstPage={() => setPage(1)} />
        ) : data && data.events.length === 0 ? (
          <EventsEmpty hasFilters={hasFilters} onClear={clear} />
        ) : data ? (
          <>
            <div className={cn('ev-main', refreshing && 'ev-refreshing')} style={{ padding: 0 }}>
              <EventResultsView events={data.events} featureFirst={data.page === 1} />
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} count={data.events.length} onPage={setPage} busy={query.isFetching} />
          </>
        ) : null}
      </div>
    </>
  );
}
