import { Link } from 'react-router';
import { cn } from '../../lib/cn';
import { PHOTOS } from '../../lib/photos';
import { useReveal } from '../site/hooks';

const photo = PHOTOS.heroConcert;

export function FinalCta() {
  const reveal = useReveal<HTMLDivElement>();
  return (
    <section className="lp-cta" aria-labelledby="cta-title">
      <img src={photo.src} width={photo.width} height={photo.height} alt="" loading="lazy" decoding="async" className="lp-cta-photo" />
      <div className="lp-cta-shade" aria-hidden="true" />
      <div ref={reveal.ref} className={cn('lp-wrap lp-cta-in', reveal.className)}>
        <h2 id="cta-title" className="lp-cta-h2">
          Your next night out
          <br />
          <span className="lp-dim">starts with a </span>
          <span className="lp-serif">seat.</span>
        </h2>
        <Link to="/events" className="lp-btn lp-btn-w lp-btn-lg">
          Explore events <span className="lp-arr">→</span>
        </Link>
      </div>
    </section>
  );
}
