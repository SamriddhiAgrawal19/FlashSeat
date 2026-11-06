import { useEffect } from 'react';
import { useParams } from 'react-router';
import { SeatBuilder } from '../../components/organizer/SeatBuilder';
import { Action, ActionLink, Arr, InlineAlert, PageHeader, Skeleton } from '../../components/organizer/ui';
import { formatCount } from '../../lib/organizer';
import { useMyVenues, useVenueLayout } from '../../lib/organizerQueries';
import { isNotFound } from '../../lib/queries';

/** /organizer/venues/:venueId/seats */
export function SeatBuilderPage() {
  const { venueId = '' } = useParams();
  const venues = useMyVenues();
  const layout = useVenueLayout(venueId);
  const venue = venues.data?.find((v) => v.id === venueId.toLowerCase());

  useEffect(() => {
    document.title = `${venue ? `${venue.name} seats` : 'Seats'} · Organizer · FlashSeat`;
  }, [venue]);

  const crumbs = [
    { label: 'Venues', to: '/organizer/venues' },
    { label: venue?.name ?? 'Venue' },
  ];

  if (isNotFound(layout.error) || (venues.isSuccess && !venue && !layout.isPending)) {
    return (
      <div className="og-view">
        <PageHeader crumbs={[crumbs[0]!, { label: 'Not found' }]} title="Venue not found" small />
        <p className="og-sub">It may belong to another account, or the link is wrong.</p>
        <div>
          <ActionLink to="/organizer/venues">All venues</ActionLink>
        </div>
      </div>
    );
  }

  const current = layout.data;
  const seats = current?.seat_count ?? venue?.seat_count ?? 0;

  return (
    <div className="og-view">
      <PageHeader
        crumbs={crumbs}
        title={
          <>
            Seat <span className="site-serif">builder</span>
          </>
        }
        small
        actions={
          <>
            {venue && (
              <span className="og-sub">
                {venue.name} · {venue.city} · <span style={{ color: 'var(--text)' }}>{formatCount(seats)} seats</span>
              </span>
            )}
            {current && current.seat_count > 0 && (
              <ActionLink to="/organizer/events/new" small>
                Create an event <Arr />
              </ActionLink>
            )}
          </>
        }
      />

      {layout.isPending ? (
        <div className="og-sb" aria-busy="true">
          <p className="sr-only" role="status">
            Loading seats
          </p>
          <Skeleton style={{ height: 320, borderRadius: 18 }} />
          <Skeleton style={{ height: 320, borderRadius: 18 }} />
        </div>
      ) : layout.isError ? (
        <InlineAlert>
          <p style={{ margin: 0 }}>We couldn't load this venue's seats.</p>
          <Action className="mt-3" small onClick={() => void layout.refetch()} busy={layout.isFetching}>
            Try again
          </Action>
        </InlineAlert>
      ) : (
        <>
          {!(current && current.seat_count > 0) && (
            <InlineAlert tone="info">This venue has no seats yet. Add at least one group; shows can only be scheduled at venues with seats.</InlineAlert>
          )}
          <SeatBuilder venueId={venueId} venueName={venue?.name ?? 'this venue'} layout={current} />
        </>
      )}
    </div>
  );
}
