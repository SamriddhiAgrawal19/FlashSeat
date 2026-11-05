import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import { Reveal } from '../../motion/Reveal';
import { Container } from '../../ui/Container';
import { Accent, SectionLabel } from '../../ui/Section';
import { DiscoverVisual, ReservedVisual, TicketVisual, VenueVisual } from './StoryVisuals';

interface Step {
  id: string;
  title: string;
  text: string;
  visual: (active: boolean) => ReactNode;
}

const STEPS: Step[] = [
  {
    id: 'discover',
    title: 'Discover events',
    text: 'Concerts, comedy, theatre, sports, workshops and festivals happening around you, filtered by city and category.',
    visual: () => <DiscoverVisual />,
  },
  {
    id: 'venue',
    title: 'See the whole venue',
    text: 'Every row and every seat, from the front to the back, with what is free and what is already sold.',
    visual: () => <VenueVisual />,
  },
  {
    id: 'yours',
    title: 'The seat you pick is yours',
    text: 'Choose a seat and it is held for you while you check out. Nobody else can book it in the meantime.',
    visual: () => <ReservedVisual />,
  },
  {
    id: 'ticket',
    title: 'Get your ticket',
    text: 'A digital ticket with its own code for every seat, ready to show at the door.',
    visual: (active) => <TicketVisual active={active} />,
  },
];

const number = (i: number) => String(i + 1).padStart(2, '0');

/**
 * Desktop: a normal-flow, two-column block. The user picks a step (click, or arrow keys) and the
 * preview changes. Nothing is sticky or tied to the scroll position, and the preview area keeps
 * one fixed height (all previews share a grid cell), so changing steps never moves the page.
 */
function StepPicker() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Tabs pattern: arrow keys move between steps, Home/End jump to the ends.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = STEPS.length;
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? (active + 1) % count
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? (active - 1 + count) % count
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="hidden lg:grid lg:grid-cols-12 lg:items-start lg:gap-14">
      <div role="tablist" aria-orientation="vertical" aria-label="How FlashSeat works" onKeyDown={onKeyDown} className="lg:col-span-5">
        {STEPS.map((step, i) => {
          const on = active === i;
          return (
            <button
              key={step.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              id={`step-tab-${step.id}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`step-panel-${step.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(i)}
              className="group relative block w-full border-t border-rule py-6 pl-6 text-left last:border-b focus-visible:outline-offset-[-2px]"
            >
              {/* Lime marker on the chosen step. */}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-6 bottom-6 left-0 w-0.5 bg-lime transition-opacity duration-300',
                  on ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span className="label-mono text-text-2">
                <span className={cn('transition-colors', on && 'text-lime')}>{number(i)}</span> / {number(STEPS.length - 1)}
              </span>
              <span
                className={cn(
                  'mt-2 block text-title font-medium transition-colors duration-200',
                  on ? 'text-text' : 'text-text-2 group-hover:text-text',
                )}
              >
                {step.title}
              </span>
              {/* Every description is always rendered, so the list never changes height. */}
              <span className={cn('mt-2 block max-w-[44ch] text-text-2 transition-opacity duration-300', on ? 'opacity-100' : 'opacity-60')}>
                {step.text}
              </span>
            </button>
          );
        })}
      </div>

      {/* All previews share one grid cell: the area is as tall as the tallest preview and never resizes. */}
      <div className="grid lg:col-span-7">
        {STEPS.map((step, i) => (
          <div
            key={step.id}
            id={`step-panel-${step.id}`}
            role="tabpanel"
            aria-labelledby={`step-tab-${step.id}`}
            aria-hidden={active !== i}
            className={cn(
              'flex items-start justify-center transition-opacity duration-300 ease-out [grid-area:1/1]',
              active === i ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            {step.visual(active === i)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Phones and tablets: each step with its preview directly underneath, in plain document flow. */
function StepList() {
  return (
    <ol className="flex flex-col gap-14 lg:hidden">
      {STEPS.map((step, i) => (
        <li key={step.id} className="border-t border-rule pt-6">
          <p className="label-mono text-text-2">
            <span className="text-lime">{number(i)}</span> / {number(STEPS.length - 1)}
          </p>
          <h3 className="mt-2 text-title font-medium text-text">{step.title}</h3>
          <p className="mt-2 max-w-[52ch] text-text-2">{step.text}</p>
          <div aria-hidden="true" className="mt-7 flex justify-center">
            {step.visual(true)}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function WhyStory() {
  return (
    <section id="how-it-works" aria-labelledby="why-title" className="scroll-mt-24 py-16 md:py-20">
      <Container>
        <SectionLabel index="03">How it works</SectionLabel>
        <Reveal className="mt-8 mb-12 md:mb-14">
          <h2 id="why-title" className="max-w-[22ch] text-section font-medium text-text">
            From first look to your <Accent>seat</Accent>, in four steps.
          </h2>
        </Reveal>
        <StepPicker />
        <StepList />
      </Container>
    </section>
  );
}
