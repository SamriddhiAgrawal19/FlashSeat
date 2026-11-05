import { PHOTOS } from '../../../lib/photos';
import { useOnScreen } from '../../../lib/motion';
import { LineReveal } from '../../motion/LineReveal';
import { Arrow, ButtonLink } from '../../ui/Button';
import { Container } from '../../ui/Container';
import { Accent } from '../../ui/Section';

const hero = PHOTOS.heroConcert;

// One scrim layer: a short fade at the top for the navbar, and a fade from the bottom
// that only darkens where the headline sits. The rest of the photo keeps its colour.
const scrim =
  'linear-gradient(to bottom, rgb(12 12 12 / 0.75), rgb(12 12 12 / 0.3) 14%, transparent 28%), ' +
  'linear-gradient(to top, rgb(12 12 12 / 0.95) 0%, rgb(12 12 12 / 0.6) 30%, transparent 62%)';

export function Hero() {
  // The slow zoom pauses while the hero is scrolled away.
  const { ref, onScreen } = useOnScreen<HTMLElement>();

  return (
    <section
      ref={ref}
      aria-labelledby="hero-title"
      className="relative h-[82svh] min-h-[560px] overflow-hidden md:h-[88svh] md:max-h-[980px] md:min-h-[600px]"
    >
      <img
        src={hero.src}
        width={hero.width}
        height={hero.height}
        alt={hero.alt}
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 size-full object-cover object-[50%_30%] motion-safe:animate-ken-burns"
        style={{ animationPlayState: onScreen ? 'running' : 'paused' }}
      />
      <div aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: scrim }} />

      <Container className="relative flex h-full flex-col justify-end pb-12 md:pb-20">
        <p className="label-mono text-text/80 motion-safe:animate-rise">Live events · Tickets · Your seat</p>
        <h1 id="hero-title" className="mt-5 text-hero font-medium text-text">
          <LineReveal
            lines={[
              'Make room for',
              <>
                <Accent>moments</Accent> that
              </>,
              'matter.',
            ]}
          />
        </h1>
        <div className="mt-9 flex flex-wrap gap-3 motion-safe:animate-rise [animation-delay:500ms]">
          <ButtonLink to="/events" size="lg">
            Explore events <Arrow />
          </ButtonLink>
          <ButtonLink to="/organizer" size="lg" variant="secondary" className="border-text/45">
            Host an event
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}
