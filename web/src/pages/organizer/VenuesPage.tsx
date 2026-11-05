import { useEffect } from 'react';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { Action, ActionLink, InlineAlert, PageHeader, Skeleton } from '../../components/organizer/ui';
import { formatCount } from '../../lib/organizer';
import { useMyVenues } from '../../lib/organizerQueries';

export function CategoryTags({ categories }: { categories: string[] }) {
  if (categories.length === 0) return <span className="label-mono text-text-3">No seats yet</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {categories.map((c) => (
        <span key={c} className="label-mono rounded-[2px] border border-rule px-1.5 py-px text-text-2">
          {c}
        </span>
      ))}
    </span>
  );
}

/** /organizer/venues */
export function VenuesPage() {
  const query = useMyVenues();

  useEffect(() => {
    document.title = 'Venues · Organizer · FlashSeat';
  }, []);

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Overview', to: '/organizer' }, { label: 'Venues' }]}
        title="Venues"
        actions={
          <ActionLink to="/organizer/venues/new" tone="primary">
            <Plus aria-hidden="true" className="size-4" /> New venue
          </ActionLink>
        }
      />

      <div className="mt-8">
        {query.isPending ? (
          <div aria-busy="true" className="space-y-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : query.isError ? (
          <InlineAlert>
            <p>We couldn't load your venues.</p>
            <Action className="mt-3" onClick={() => void query.refetch()} busy={query.isFetching}>
              Try again
            </Action>
          </InlineAlert>
        ) : query.data.length === 0 ? (
          <div className="border border-rule px-5 py-10 sm:px-8">
            <h2 className="text-[1.25rem] font-medium tracking-[-0.02em] text-text">No venues yet</h2>
            <p className="mt-2 max-w-[32rem] text-[15px] text-text-2">
              A venue is a place plus its seat layout. Shows are scheduled at a venue, and every show gets a copy of its seats.
            </p>
            <ActionLink to="/organizer/venues/new" tone="primary" className="mt-6">
              <Plus aria-hidden="true" className="size-4" /> Add your first venue
            </ActionLink>
          </div>
        ) : (
          <div className="border-t border-rule">
            <div aria-hidden="true" className="label-mono hidden grid-cols-[minmax(0,1fr)_7rem_minmax(0,14rem)_7rem] gap-4 border-b border-rule py-2.5 text-text-3 md:grid">
              <span>Venue</span>
              <span className="text-right">Seats</span>
              <span>Categories</span>
              <span />
            </div>
            <ul>
              {query.data.map((venue) => (
                <li
                  key={venue.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-rule py-3.5 md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,14rem)_7rem]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium text-text">{venue.name}</p>
                    <p className="mt-0.5 truncate text-[13px] text-text-2">
                      {venue.address} · <span className="label-mono text-text-3">{venue.city}</span>
                    </p>
                  </div>
                  <p className="text-right font-mono text-[13px] text-text">
                    {formatCount(venue.seat_count)}
                    <span className="text-text-3 md:hidden"> seats</span>
                  </p>
                  <div className="min-w-0">
                    <CategoryTags categories={venue.categories} />
                  </div>
                  <Link
                    to={`/organizer/venues/${venue.id}/seats`}
                    className="label-mono justify-self-end text-text-2 hover:text-lime"
                  >
                    {venue.seat_count === 0 ? 'Add seats →' : 'Seats →'}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
