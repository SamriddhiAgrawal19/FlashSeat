import { useEffect } from 'react';
import { Link } from 'react-router';
import { Action, ActionLink, Arr, InlineAlert, PageHeader, Skeleton } from '../../components/organizer/ui';
import { formatCount } from '../../lib/organizer';
import { useMyVenues } from '../../lib/organizerQueries';

// Category chips use the seat-builder shades in the venue's own category order.
const SHADES = ['#FAFAFA', '#A1A1AA', '#5B5B66', '#3F3F46'];

export function CategoryTags({ categories }: { categories: string[] }) {
  if (categories.length === 0) return <span className="og-tag">NO SEATS YET</span>;
  return (
    <span className="og-tags">
      {categories.map((c, i) => (
        <span key={c} className="og-tag">
          <i aria-hidden="true" className="og-sw" style={{ width: 7, height: 7, background: SHADES[Math.min(i, SHADES.length - 1)] }} />
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
    <div className="og-view">
      <PageHeader
        crumbs={[{ label: 'Overview', to: '/organizer' }, { label: 'Venues' }]}
        title="Venues"
        small
        actions={
          <ActionLink to="/organizer/venues/new" tone="primary">
            New venue <Arr />
          </ActionLink>
        }
      />

      {query.isPending ? (
        <div aria-busy="true" className="og-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p className="sr-only" role="status">
            Loading venues
          </p>
          <Skeleton style={{ height: 40 }} />
          <Skeleton style={{ height: 40 }} />
        </div>
      ) : query.isError ? (
        <InlineAlert>
          <p style={{ margin: 0 }}>We couldn't load your venues.</p>
          <Action className="mt-3" small onClick={() => void query.refetch()} busy={query.isFetching}>
            Try again
          </Action>
        </InlineAlert>
      ) : query.data.length === 0 ? (
        <section aria-labelledby="no-venues" className="og-card og-card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14 }}>
          <span className="og-eyebrow">NO VENUES YET</span>
          <h2 id="no-venues" className="og-card-title" style={{ fontSize: 22, letterSpacing: '-0.03em' }}>
            Add your first venue
          </h2>
          <p className="og-sub" style={{ maxWidth: '34rem', lineHeight: 1.6 }}>
            A venue is a place plus its seat layout. Shows are scheduled at a venue, and every show gets a copy of its seats.
          </p>
          <ActionLink to="/organizer/venues/new" tone="primary">
            Add a venue <Arr />
          </ActionLink>
        </section>
      ) : (
        <section aria-labelledby="venues-heading" className="og-card is-clip">
          <div className="og-card-head">
            <h2 id="venues-heading" className="og-card-title">
              Your venues
            </h2>
            <span className="og-card-meta">
              {query.data.length} {query.data.length === 1 ? 'VENUE' : 'VENUES'}
            </span>
          </div>
          <ul className="og-list">
            {query.data.map((venue) => (
              <li key={venue.id}>
                <Link to={`/organizer/venues/${venue.id}/seats`} className="og-vrow">
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span className="og-vname">{venue.name}</span>
                    <span className="og-vaddr">
                      {venue.city} · {venue.address}
                    </span>
                  </span>
                  <span className="og-vcount">
                    {formatCount(venue.seat_count)}
                    <span style={{ color: 'var(--text-3)' }}> seats</span>
                  </span>
                  <CategoryTags categories={venue.categories} />
                  <span className="og-vgo">
                    {venue.seat_count === 0 ? 'Add seats' : 'Edit seats'}{' '}
                    <span aria-hidden="true" className="og-go" style={{ display: 'inline-block', fontSize: 13 }}>
                      →
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
