import { useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { CATEGORIES } from '../../../lib/categories';
import { cn } from '../../../lib/cn';
import { photoForCategory } from '../../../lib/photos';
import { Reveal } from '../../motion/Reveal';
import { Arrow, ArrowLink } from '../../ui/Button';
import { Container } from '../../ui/Container';
import { Accent, SectionLabel } from '../../ui/Section';

const hrefFor = (value: string) => `/events?category=${encodeURIComponent(value)}`;

const BLURBS: Record<string, string> = {
  MUSIC: 'Gigs, concerts and club nights, from small rooms to big stages.',
  COMEDY: 'Stand-up sets, open mics and late-night shows.',
  THEATRE: 'Plays, musicals and dance, with every seat on the map.',
  SPORTS: 'Matches, races and big-screen nights in the stands.',
  WORKSHOP: 'Hands-on classes where you leave having made something.',
  FESTIVAL: 'Multi-day festivals, fairs and open-air weekends.',
};

/**
 * Two-column category explorer. Mouse: hovering a row selects it and crossfades the photo;
 * clicking navigates. Keyboard: focusing a row selects it; Enter navigates. Touch/pen have no
 * hover, so the first tap on a row selects it and a second tap opens it. The last selection
 * stays when the pointer leaves.
 */
export function Categories() {
  const [active, setActive] = useState(CATEGORIES[0]?.value ?? 'MUSIC');
  const current = CATEGORIES.find((c) => c.value === active) ?? CATEGORIES[0];

  // Recorded at pointerdown, because a tap also focuses the link before the click arrives.
  const tap = useRef<{ touch: boolean; wasActive: boolean } | null>(null);

  const onRowClick = (event: MouseEvent<HTMLAnchorElement>, value: string) => {
    const t = tap.current;
    tap.current = null;
    if (t?.touch && !t.wasActive) {
      event.preventDefault();
      setActive(value);
    }
  };

  return (
    <section id="categories" aria-labelledby="categories-title" className="scroll-mt-24 py-16 md:py-20">
      <Container>
        <SectionLabel index="02">Categories</SectionLabel>
        <Reveal className="mt-8 mb-12 grid gap-4 md:mb-14 lg:grid-cols-12 lg:items-end">
          <h2 id="categories-title" className="text-section font-medium text-text lg:col-span-7">
            Pick your <Accent>kind</Accent> of night.
          </h2>
          <p className="max-w-[44ch] text-text-2 lg:col-span-5">
            Six ways into the weekend. Browse the list and open a category to see everything on sale.
          </p>
        </Reveal>

        <Reveal className="grid gap-8 md:grid-cols-12 md:items-start md:gap-10 lg:gap-14">
          {/* Left: the selected category. All photos are stacked; only the active one is visible. */}
          <div className="md:col-span-7">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[2px] bg-surface">
              {CATEGORIES.map((c) => {
                const photo = photoForCategory(c.value);
                const on = c.value === active;
                return (
                  <img
                    key={c.value}
                    src={photo.src}
                    width={photo.width}
                    height={photo.height}
                    alt={on ? photo.alt : ''}
                    aria-hidden={!on}
                    loading="lazy"
                    decoding="async"
                    className={cn(
                      'absolute inset-0 size-full object-cover transition-[opacity,transform] duration-700 ease-out',
                      on ? 'scale-100 opacity-100' : 'scale-[1.04] opacity-0',
                    )}
                  />
                );
              })}
            </div>
            {current && (
              <div aria-live="polite" className="mt-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
                <div key={current.value} className="motion-safe:animate-fade-in">
                  <p className="text-title font-medium text-text">{current.label}</p>
                  <p className="mt-1.5 max-w-[46ch] text-text-2">{BLURBS[current.value]}</p>
                </div>
                <ArrowLink to={hrefFor(current.value)} size="lg">
                  Explore {current.label.toLowerCase()}
                </ArrowLink>
              </div>
            )}
          </div>

          {/* Right: the list. */}
          <ul className="border-t border-rule md:col-span-5">
            {CATEGORIES.map((c, i) => {
              const on = c.value === active;
              return (
                <li key={c.value} className="border-b border-rule">
                  <Link
                    to={hrefFor(c.value)}
                    aria-current={on ? 'true' : undefined}
                    onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(c.value)}
                    onPointerDown={(e) => {
                      tap.current = { touch: e.pointerType !== 'mouse', wasActive: c.value === active };
                    }}
                    onFocus={() => {
                      if (!tap.current?.touch) setActive(c.value);
                    }}
                    onClick={(e) => onRowClick(e, c.value)}
                    className="group relative flex items-center justify-between gap-4 py-4 pl-5 md:py-[1.15rem]"
                  >
                    {/* Lime marker for the selected row. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute top-3 bottom-3 left-0 w-0.5 origin-center bg-lime transition-transform duration-300',
                        on ? 'scale-y-100' : 'scale-y-0',
                      )}
                    />
                    <span className="flex items-baseline gap-4">
                      <span className={cn('label-mono transition-colors', on ? 'text-lime' : 'text-text-2')}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span
                        className={cn(
                          'text-[clamp(1.25rem,1.8vw,1.625rem)] font-medium tracking-[-0.03em] transition-colors duration-200',
                          on ? 'text-text' : 'text-text-2 group-hover:text-text',
                        )}
                      >
                        {c.label}
                      </span>
                    </span>
                    <Arrow className={cn('transition-colors', on ? 'text-lime' : 'text-text-2')} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Reveal>
      </Container>
    </section>
  );
}
