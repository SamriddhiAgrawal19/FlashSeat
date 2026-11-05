import { Reveal } from '../../motion/Reveal';
import { ArrowLink } from '../../ui/Button';
import { Container } from '../../ui/Container';
import { Accent, SectionLabel } from '../../ui/Section';
import { FeaturedLead } from './FeaturedLead';
import { FeaturedRows } from './FeaturedRows';
import { FeaturedEmpty, FeaturedError, FeaturedSkeleton } from './FeaturedStates';
import { useFeaturedEvents } from './useFeaturedEvents';

function FeaturedBody() {
  const { list, items } = useFeaturedEvents();

  if (list.isPending) return <FeaturedSkeleton />;
  if (list.isError) return <FeaturedError onRetry={() => void list.refetch()} retrying={list.isFetching} />;

  const [lead, ...rest] = items;
  if (!lead) return <FeaturedEmpty />;

  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-14">
      <Reveal className="lg:col-span-7">
        <FeaturedLead item={lead} />
      </Reveal>
      <Reveal delay={0.1} className="lg:col-span-5">
        <FeaturedRows items={rest} />
      </Reveal>
    </div>
  );
}

export function Featured() {
  return (
    <section id="featured" aria-labelledby="featured-title" className="scroll-mt-24 py-16 md:py-20">
      <Container>
        <SectionLabel index="01">Featured</SectionLabel>
        <Reveal className="mt-8 mb-12 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 md:mb-14">
          <h2 id="featured-title" className="text-section font-medium text-text">
            On sale <Accent>now</Accent>.
          </h2>
          <ArrowLink to="/events" size="lg">
            View all events
          </ArrowLink>
        </Reveal>
        <FeaturedBody />
      </Container>
    </section>
  );
}
