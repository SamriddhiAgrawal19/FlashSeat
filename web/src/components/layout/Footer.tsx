import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CATEGORIES } from '../../lib/categories';
import { Container } from '../ui/Container';
import { GITHUB_URL } from './navLinks';
import { WordmarkDot } from './Wordmark';

const linkClass = 'rounded-[2px] text-[15px] text-text-2 transition-colors hover:text-lime';

function Column({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="label-mono text-text-2">{title}</p>
      <ul className="mt-4 flex flex-col gap-2.5">{children}</ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-8 border-t border-rule">
      <Container className="grid gap-12 py-14 md:py-16 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-4">
          <Link to="/" className="inline-flex items-baseline gap-[0.08em] rounded-[2px] text-[2rem] leading-none font-semibold tracking-[-0.05em] text-text">
            FlashSeat
            <WordmarkDot />
          </Link>
          <p className="mt-4 max-w-[30ch] text-text-2">Live events, your seat, one tap away.</p>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4 lg:col-span-8">
          <Column title="Explore">
            <li>
              <Link to="/events" className={linkClass}>
                Events
              </Link>
            </li>
            <li>
              <Link to="/#categories" className={linkClass}>
                Categories
              </Link>
            </li>
          </Column>
          <Column title="Categories">
            {CATEGORIES.map((c) => (
              <li key={c.value}>
                <Link to={`/events?category=${encodeURIComponent(c.value)}`} className={linkClass}>
                  {c.label}
                </Link>
              </li>
            ))}
          </Column>
          <Column title="Organizers">
            <li>
              <Link to="/organizer" className={linkClass}>
                Host an event
              </Link>
            </li>
            <li>
              <Link to="/#organizers" className={linkClass}>
                For organizers
              </Link>
            </li>
          </Column>
          <Column title="Source">
            <li>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
                GitHub
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          </Column>
        </nav>
      </Container>

      <Container>
        <div className="flex flex-col gap-2 border-t border-rule py-6 text-sm text-text-2 sm:flex-row sm:justify-between">
          <p>© 2026 FlashSeat. All rights reserved.</p>
          <p>Photography from Unsplash and Pexels, used under their licenses.</p>
        </div>
      </Container>
    </footer>
  );
}
