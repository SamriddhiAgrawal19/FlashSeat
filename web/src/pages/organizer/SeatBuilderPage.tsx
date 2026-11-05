import { useEffect } from 'react';
import { useParams } from 'react-router';
import { CategoryTotals, layoutToPreview, LayoutPreview, orderCategories, previewTotals } from '../../components/organizer/LayoutPreview';
import { SeatBuilder } from '../../components/organizer/SeatBuilder';
import { Action, ActionLink, InlineAlert, PageHeader, Panel, Skeleton } from '../../components/organizer/ui';
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
    { label: 'Overview', to: '/organizer' },
    { label: 'Venues', to: '/organizer/venues' },
    { label: venue?.name ?? 'Venue' },
  ];

  if (isNotFound(layout.error) || (venues.isSuccess && !venue && !layout.isPending)) {
    return (
      <div>
        <PageHeader crumbs={crumbs.slice(0, 2).concat({ label: 'Not found' })} title="Venue not found" />
        <p className="mt-6 text-[15px] text-text-2">It may belong to another account, or the link is wrong.</p>
        <ActionLink to="/organizer/venues" className="mt-6">
          All venues
        </ActionLink>
      </div>
    );
  }

  const current = layout.data;
  const preview = current ? layoutToPreview(current) : [];
  const order = orderCategories(current?.categories ?? []);

  return (
    <div>
      <PageHeader
        crumbs={crumbs}
        eyebrow={venue ? `${venue.city} · ${venue.address}` : undefined}
        title={venue ? `${venue.name}` : <Skeleton className="h-8 w-56" />}
        actions={
          current && current.seat_count > 0 ? (
            <ActionLink to="/organizer/events/new">Create an event →</ActionLink>
          ) : undefined
        }
      />

      <div className="mt-8 space-y-8">
        {layout.isPending ? (
          <Skeleton className="h-40" />
        ) : layout.isError ? (
          <InlineAlert>
            <p>We couldn't load this venue's seats.</p>
            <Action className="mt-3" onClick={() => void layout.refetch()} busy={layout.isFetching}>
              Try again
            </Action>
          </InlineAlert>
        ) : current && current.seat_count > 0 ? (
          <Panel title="Current layout" meta={`${formatCount(current.seat_count)} seats · read-only`}>
            <LayoutPreview sections={preview} order={order} label={`Current layout of ${venue?.name ?? 'the venue'}`} />
            <CategoryTotals totals={previewTotals(preview)} order={order} className="mt-4 border-t border-rule pt-3" />
          </Panel>
        ) : (
          <p className="border-l-2 border-text/40 pl-4 text-[14px] text-text-2">
            This venue has no seats yet. Add at least one group below; shows can only be scheduled at venues with seats.
          </p>
        )}

        <section aria-labelledby="builder-title">
          <h2 id="builder-title" className="mb-4 text-[15px] font-medium text-text">
            {current && current.seat_count > 0 ? 'Add more seats' : 'Lay out seats'}
          </h2>
          {layout.isSuccess && <SeatBuilder venueId={venueId} venueName={venue?.name ?? 'this venue'} layout={current} />}
        </section>
      </div>
    </div>
  );
}
