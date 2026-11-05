import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { EventImage } from '../components/events/EventImage';
import { isUpcoming } from '../components/events/showState';
import { ShowRow } from '../components/events/ShowRow';
import { Arrow, Button, ButtonLink } from '../components/ui/Button';
import { Container } from '../components/ui/Container';
import { Eyebrow, SectionLabel } from '../components/ui/Section';
import type { EventDetail } from '../lib/api';
import { categoryLabel } from '../lib/categories';
import { isNotFound, useEventDetail } from '../lib/queries';

function EventNotFound() {
  useEffect(() => {
    document.title = 'Event not found · FlashSeat';
  }, []);
  return (
    <section aria-labelledby="nf-title" className="pt-40 pb-28 md:pt-48">
      <Container className="max-w-[42rem]">
        <Eyebrow>404</Eyebrow>
        <h1 id="nf-title" className="mt-4 text-section font-medium text-text">
          Event not found.
        </h1>
        <p className="mt-4 text-text-2">This event doesn't exist or isn't on sale. It may have been removed, or the link may be wrong.</p>
        <ButtonLink to="/events" variant="secondary" className="mt-8">
          Browse events <Arrow />
        </ButtonLink>
      </Container>
    </section>
  );
}

function DetailSkeleton() {
  const block = 'bg-text/[0.07] motion-safe:animate-breathe';
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        Loading event
      </p>
      <div aria-hidden="true" className={`h-[56svh] min-h-[420px] ${block}`} />
      <Container aria-hidden="true" className="py-14">
        <div className={`h-4 w-2/3 max-w-xl ${block}`} />
        <div className={`mt-3 h-4 w-1/2 max-w-md ${block}`} />
      </Container>
    </div>
  );
}

function Detail({ event }: { event: EventDetail }) {
  const datesRef = useRef<HTMLElement>(null);
  const cancelled = event.status === 'CANCELLED';
  const shows = [...event.shows].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const upcoming = shows.filter((s) => isUpcoming(s)).length;

  useEffect(() => {
    document.title = `${event.title} · FlashSeat`;
  }, [event.title]);

  return (
    <>
      <section aria-labelledby="event-title" className="relative h-[62svh] min-h-[460px] overflow-hidden md:h-[70svh]">
        <EventImage event={event} className="absolute inset-0 size-full object-cover" />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to bottom, rgb(12 12 12 / 0.7), transparent 28%), linear-gradient(to top, rgb(12 12 12 / 0.96) 0%, rgb(12 12 12 / 0.55) 40%, transparent 72%)',
          }}
        />
        <Container className="relative flex h-full flex-col justify-end pb-10 md:pb-14">
          <Link to="/events" className="label-mono mb-6 self-start text-text/80 hover:text-lime">
            ← All events
          </Link>
          <p className="label-mono text-text/85">
            {categoryLabel(event.category)}
            {!cancelled && ` · ${upcoming} upcoming date${upcoming === 1 ? '' : 's'}`}
          </p>
          <h1 id="event-title" className="mt-4 max-w-[18ch] text-[clamp(2.5rem,6vw,5.25rem)] leading-[0.98] font-medium tracking-[-0.045em] text-text">
            {event.title}
          </h1>
          {!cancelled && upcoming > 0 && (
            <div className="mt-8">
              <Button size="lg" onClick={() => datesRef.current?.scrollIntoView({ block: 'start' })}>
                Choose seats <Arrow />
              </Button>
            </div>
          )}
        </Container>
      </section>

      {cancelled && (
        <Container className="pt-10">
          <div role="status" className="border-l-2 border-danger bg-surface px-5 py-4">
            <p className="text-[17px] font-medium text-text">This event has been cancelled.</p>
            <p className="mt-1 text-[15px] text-text-2">Tickets for it are no longer on sale.</p>
          </div>
        </Container>
      )}

      {event.description && (
        <section aria-labelledby="about-title" className="py-14 md:py-20">
          <Container>
            <SectionLabel index="01">About</SectionLabel>
            <h2 id="about-title" className="sr-only">
              About this event
            </h2>
            <p className="mt-8 max-w-[62ch] text-[18px] leading-[1.7] whitespace-pre-line text-text">{event.description}</p>
          </Container>
        </section>
      )}

      <section ref={datesRef} id="dates" aria-labelledby="dates-title" className="scroll-mt-20 pt-6 pb-28 md:pt-10">
        <Container>
          <SectionLabel index={event.description ? '02' : '01'}>Dates &amp; tickets</SectionLabel>
          <h2 id="dates-title" className="mt-8 text-section font-medium text-text">
            Pick a date.
          </h2>
          {shows.length === 0 ? (
            <p className="mt-8 text-text-2">No dates have been scheduled for this event.</p>
          ) : (
            <ol className="mt-10 border-t border-rule">
              {shows.map((show) => (
                <ShowRow key={show.id} eventId={event.id} eventStatus={event.status} show={show} />
              ))}
            </ol>
          )}
        </Container>
      </section>
    </>
  );
}

/** /events/:eventId: one GET /events/:eventId, then one GET /events/:eventId/shows/:showId per show. */
export function EventDetailPage() {
  const { eventId = '' } = useParams();
  const query = useEventDetail(eventId);

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    if (isNotFound(query.error)) return <EventNotFound />;
    return (
      <section className="pt-40 pb-28">
        <Container>
          <div role="alert" className="flex flex-col gap-6 border-y border-rule py-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-title font-medium text-text">We couldn't load this event right now.</p>
              <p className="mt-1.5 text-text-2">Check your connection, or try again in a moment.</p>
            </div>
            <Button variant="secondary" onClick={() => void query.refetch()} disabled={query.isFetching}>
              {query.isFetching ? 'Retrying…' : 'Try again'}
            </Button>
          </div>
        </Container>
      </section>
    );
  }
  return <Detail event={query.data} />;
}
