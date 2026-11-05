import { Container } from '../../ui/Container';
import { HeroSearch } from './HeroSearch';

/** A slim discovery band right under the hero: a one-line prompt and the city + category search. */
export function DiscoverBar() {
  return (
    <section aria-labelledby="discover-title" className="border-b border-rule">
      <Container className="flex flex-col gap-5 py-8 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
        <div>
          <p className="label-mono text-text-2">Find events</p>
          <h2 id="discover-title" className="mt-2 text-xl font-medium tracking-[-0.025em] text-text">
            What are you doing this weekend?
          </h2>
        </div>
        <HeroSearch />
      </Container>
    </section>
  );
}
