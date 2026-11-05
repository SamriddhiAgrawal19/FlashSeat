import { useEffect, useRef } from 'react';
import { EventList, EventListSkeleton, EventsEmpty, EventsError, Pagination } from '../components/events/EventResults';
import { FilterBar } from '../components/events/FilterBar';
import { useEventFilters, type EventFilters } from '../components/events/useEventFilters';
import { Button } from '../components/ui/Button';
import { Container } from '../components/ui/Container';
import { Accent, Eyebrow } from '../components/ui/Section';
import { categoryLabel } from '../lib/categories';
import { DATE_PRESETS, matchPreset } from '../lib/dateRanges';
import { formatDateRange } from '../lib/format';
import { useEventsList } from '../lib/queries';

/** "Theatre in Pune, this weekend", "Events in Pune", "All upcoming events". */
function describe(filters: EventFilters): string {
  const city = filters.city ? filters.city.charAt(0).toUpperCase() + filters.city.slice(1) : '';
  const what = filters.category ? categoryLabel(filters.category) : city ? 'Events' : '';
  let text = what && city ? `${what} in ${city}` : what || 'All upcoming events';
  const preset = matchPreset(filters.dateFrom || null, filters.dateTo || null);
  const when = preset
    ? DATE_PRESETS.find((p) => p.id === preset)?.phrase
    : formatDateRange(filters.dateFrom || null, filters.dateTo || null)?.replace(/^\w/, (c) => c.toLowerCase());
  if (when) text += `, ${when}`;
  return text;
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

  useEffect(() => {
    document.title = 'Events · FlashSeat';
  }, []);

  // On page change, bring the top of the results into view (below the sticky bar).
  useEffect(() => {
    if (previousPage.current !== page) resultsRef.current?.scrollIntoView({ block: 'start' });
    previousPage.current = page;
  }, [page]);

  const data = query.data;
  const refreshing = query.isFetching && query.isPlaceholderData;

  return (
    <>
      <section aria-labelledby="events-title" className="pt-28 pb-10 md:pt-36 md:pb-12">
        <Container>
          <Eyebrow>Explore</Eyebrow>
          <h1 id="events-title" className="mt-4 text-[clamp(2.75rem,6vw,5rem)] leading-[0.98] font-medium tracking-[-0.045em] text-text">
            What's <Accent>on</Accent>.
          </h1>
          <p className="mt-4 text-[17px] text-text-2" aria-live="polite">
            {describe(filters)}
          </p>
        </Container>
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

      <Container>
        <div ref={resultsRef} className="scroll-mt-40 pt-10 pb-24 md:pt-14" aria-busy={refreshing || undefined}>
          {/* Thin loading line while the previous results stay on screen. */}
          <div aria-hidden="true" className="mb-6 h-px overflow-hidden">
            <div className={refreshing ? 'h-px w-full bg-lime/70 motion-safe:animate-breathe' : 'h-px w-full bg-transparent'} />
          </div>

          {query.isPending ? (
            <EventListSkeleton />
          ) : query.isError && !data ? (
            <EventsError onRetry={() => void query.refetch()} retrying={query.isFetching} />
          ) : data && data.events.length === 0 && data.total > 0 ? (
            <div className="border-y border-rule py-8">
              <p className="text-title font-medium text-text">There's nothing on this page.</p>
              <Button variant="secondary" className="mt-5" onClick={() => setPage(1)}>
                Go to the first page
              </Button>
            </div>
          ) : data && data.events.length === 0 ? (
            <EventsEmpty hasFilters={hasFilters} onClear={clear} />
          ) : data ? (
            <div className={refreshing ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
              <EventList events={data.events} />
              <Pagination
                page={data.page}
                limit={data.limit}
                total={data.total}
                count={data.events.length}
                onPage={setPage}
                busy={query.isFetching}
              />
            </div>
          ) : null}
        </div>
      </Container>
    </>
  );
}
