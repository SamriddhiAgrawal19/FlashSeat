import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { HeroSearch } from './HeroSearch';
import { SeatRace } from './SeatRace';

const delay = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

export function Hero() {
  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <div className="lp-grid-bg" aria-hidden="true" />
      <div className="lp-wrap lp-hero-in">
        <div className="lp-hero-text">
          <span className="lp-badge lp-fade">
            <i className="lp-dot lp-pulse" />
            LIVE SEAT MAPS
          </span>
          <h1 id="hero-title" className="lp-h1">
            <span className="lp-w" style={delay(0.05)}>Every</span> <span className="lp-w" style={delay(0.12)}>seat,</span>
            <br />
            <span className="lp-w lp-dim" style={delay(0.22)}>yours</span> <span className="lp-w lp-dim" style={delay(0.29)}>to</span>{' '}
            <span className="lp-w lp-serif" style={{ ...delay(0.36), letterSpacing: '-0.01em' }}>choose.</span>
          </h1>
          <p className="lp-lede lp-fade" style={delay(0.5)}>
            Concerts, comedy, theatre and fests near you. See the whole venue, pick the exact seat you want, and get your ticket in
            seconds.
          </p>
          <div className="lp-row lp-fade" style={delay(0.6)}>
            <Link to="/events" className="lp-btn lp-btn-w lp-btn-md">
              Explore events <span className="lp-arr">→</span>
            </Link>
            <Link to="/organizer" className="lp-btn lp-btn-g lp-btn-md">
              Host an event
            </Link>
          </div>
          <HeroSearch className="lp-fade" style={delay(0.7)} />
        </div>
        <SeatRace />
      </div>
    </section>
  );
}
