import { useRef } from 'react';
import { useInView } from 'motion/react';
import { useReducedMotionPref } from '../../../lib/motion';
import { CountUp } from '../../motion/CountUp';
import { Reveal } from '../../motion/Reveal';
import { Arrow, ArrowLink, ButtonLink } from '../../ui/Button';
import { Container } from '../../ui/Container';
import { Accent, SectionLabel } from '../../ui/Section';

const CAPABILITIES = [
  'Create venues',
  'Define seat layouts',
  'Schedule shows',
  'Set category-wise prices',
  'Publish when ready',
  'Track sales',
];

// Illustrative only, and labelled as sample data in the preview. The stats are derived from
// the shows below, so the numbers always agree with each other.
const SHOWS = [
  { name: 'An Evening of Jazz', when: 'Sat 14 Dec · 8:00 PM', venue: 'Main Hall', sold: 84, capacity: 120, status: 'On sale' },
  { name: 'Late Night Stand-up', when: 'Fri 20 Dec · 9:00 PM', venue: 'The Loft', sold: 112, capacity: 140, status: 'On sale' },
  { name: 'Winter Choir', when: 'Sun 22 Dec · 6:00 PM', venue: 'Main Hall', sold: 0, capacity: 120, status: 'Draft' },
] as const;
const STATS: Array<[string, number]> = [
  ['Venues', new Set(SHOWS.map((s) => s.venue)).size],
  ['Upcoming shows', SHOWS.length],
  ['Tickets sold', SHOWS.reduce((sum, s) => sum + s.sold, 0)],
];
const PRICES: Array<[string, string]> = [
  ['Regular', '₹499'],
  ['Premium', '₹899'],
  ['Balcony', '₹349'],
];

/** Thin sales bar that fills from the left once the dashboard is on screen. */
function SalesBar({ label, sold, capacity, play }: { label: string; sold: number; capacity: number; play: boolean }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={capacity}
      aria-valuenow={sold}
      className="mt-3 h-[3px] overflow-hidden bg-text/10"
    >
      <div
        className="h-full origin-left bg-lime transition-transform duration-1000 ease-out"
        style={{ transform: `scaleX(${play ? sold / capacity : 0})` }}
      />
    </div>
  );
}

/** A small, product-like organizer dashboard: stats, upcoming shows with sales progress, prices. */
function DashboardPreview() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const reduced = useReducedMotionPref();
  const play = reduced || inView;

  return (
    <figure ref={ref} aria-label="Sample organizer dashboard" className="overflow-hidden rounded-[4px] border border-rule bg-surface">
      <div className="flex items-center justify-between border-b border-rule px-6 py-3.5">
        <p className="label-mono text-text-2">Organizer dashboard</p>
        <p className="label-mono rounded-[2px] border border-rule px-2 py-0.5 text-text-2">Sample data</p>
      </div>

      <dl className="grid grid-cols-3 divide-x divide-rule border-b border-rule">
        {STATS.map(([label, value]) => (
          <div key={label} className="px-6 py-5">
            <dt className="label-mono text-text-2">{label}</dt>
            <dd className="mt-2 text-[clamp(1.5rem,2.4vw,2rem)] leading-none font-medium tracking-[-0.04em] text-text">
              <CountUp value={value} />
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex items-baseline justify-between px-6 pt-5">
        <p className="label-mono text-text-2">Upcoming shows</p>
        <p className="label-mono text-text-2">Sold / capacity</p>
      </div>
      <ul className="px-6 pb-1">
        {SHOWS.map((show, i) => (
          <Reveal as="li" key={show.name} delay={0.1 + i * 0.08} className="border-b border-rule py-4 last:border-b-0">
            <div className="flex items-baseline justify-between gap-4">
              <p className="truncate text-[17px] font-medium tracking-[-0.02em] text-text">{show.name}</p>
              <p className="label-mono shrink-0 text-text">
                {show.sold}
                <span className="text-text-2">/{show.capacity}</span>
              </p>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-4">
              <p className="label-mono truncate text-text-2">
                {show.when} · {show.venue}
              </p>
              <p className={`label-mono shrink-0 ${show.status === 'On sale' ? 'text-lime' : 'text-text-2'}`}>{show.status}</p>
            </div>
            <SalesBar label={`${show.name} tickets sold`} sold={show.sold} capacity={show.capacity} play={play} />
          </Reveal>
        ))}
      </ul>

      <dl className="grid grid-cols-3 divide-x divide-rule border-t border-rule">
        {PRICES.map(([category, price]) => (
          <div key={category} className="px-6 py-4">
            <dt className="label-mono text-text-2">{category}</dt>
            <dd className="mt-1 text-[17px] font-medium text-text">{price}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

export function OrganizerCta() {
  return (
    <section id="organizers" aria-labelledby="organizers-title" className="scroll-mt-24 py-16 md:py-20">
      <Container>
        <SectionLabel index="04">For organizers</SectionLabel>
        <div className="mt-8 grid gap-12 lg:grid-cols-12 lg:items-center lg:gap-16">
          <Reveal className="lg:col-span-5">
            <h2 id="organizers-title" className="text-section font-medium text-text">
              Your stage.
              <br />
              <Accent>Our</Accent> platform.
            </h2>
            <p className="mt-5 max-w-[46ch] text-text-2">
              Set up your venue and seat layout, schedule shows with category prices, publish when ready and cancel safely if
              plans change.
            </p>
            <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-rule pt-6">
              {CAPABILITIES.map((item) => (
                <li key={item} className="flex items-center gap-3 text-[15px] text-text">
                  <span aria-hidden="true" className="size-1.5 shrink-0 bg-lime" />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              <ButtonLink to="/organizer" size="lg">
                Start hosting <Arrow />
              </ButtonLink>
              <ArrowLink to="/organizer" tone="secondary" size="lg">
                Learn more
              </ArrowLink>
            </div>
          </Reveal>
          <Reveal delay={0.1} className="lg:col-span-7">
            <DashboardPreview />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
