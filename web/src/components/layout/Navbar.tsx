import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useAuth, displayName } from '../../lib/auth/useAuth';
import { Arrow, ButtonLink } from '../ui/Button';
import { Container } from '../ui/Container';
import { NAV_LINKS } from './navLinks';
import { accountLinks, Avatar, UserMenu } from './UserMenu';
import { Wordmark } from './Wordmark';

const MOBILE_MENU_ID = 'mobile-menu';

/** Is this nav target the current page? Hash links (/#categories) count only on that hash. */
function isCurrent(to: string, pathname: string, hash: string): boolean {
  const [path, anchor] = to.split('#');
  if (anchor) return pathname === (path || '/') && hash === `#${anchor}`;
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Off-white nav link; lime with a sliding underline on hover, and when it is the current page. */
function NavLink({ to, children, current }: { to: string; children: string; current: boolean }) {
  return (
    <Link
      to={to}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'group relative rounded-[2px] py-2 text-[15px] transition-colors duration-200 hover:text-lime',
        current ? 'text-lime' : 'text-text/85',
      )}
    >
      {children}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-x-0 bottom-1 h-px origin-left bg-lime transition-transform duration-300 group-hover:scale-x-100',
          current ? 'scale-x-100' : 'scale-x-0',
        )}
      />
    </Link>
  );
}

const LOGIN_LINK = { label: 'Log in', to: '/login' };

function MobileMenu({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { status, user, logout } = useAuth();
  const signedIn = status === 'authenticated' && user;
  const links = signedIn ? [...NAV_LINKS, ...accountLinks(user)] : status === 'anonymous' ? [...NAV_LINKS, LOGIN_LINK] : NAV_LINKS;

  useEffect(() => {
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      id={MOBILE_MENU_ID}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg md:hidden"
    >
      <Container className="flex h-16 shrink-0 items-center justify-between">
        <Wordmark onClick={onClose} />
        <button
          ref={closeRef}
          type="button"
          className="-mr-2 grid size-11 place-items-center rounded-[2px] text-text"
          aria-label="Close menu"
          onClick={onClose}
        >
          <X className="size-6" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </Container>
      <Container className="flex flex-1 flex-col justify-between pt-10 pb-10">
        <nav aria-label="Mobile">
          <ul className="border-t border-rule">
            {links.map((item, i) => {
              const stagger: CSSProperties = { animationDelay: `${0.06 + i * 0.06}s` };
              return (
                <li key={item.to} className="overflow-hidden border-b border-rule">
                  <Link
                    to={item.to}
                    onClick={onClose}
                    style={stagger}
                    className="group flex items-baseline justify-between py-5 text-[2.75rem] leading-none font-medium tracking-[-0.045em] text-text hover:text-lime motion-safe:animate-line-up"
                  >
                    {item.label}
                    <Arrow className="text-2xl text-lime" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-12">
          {signedIn && (
            <div className="mb-6 flex items-center justify-between gap-4">
              <p className="flex min-w-0 items-center gap-3 text-[15px] text-text">
                <Avatar user={user} />
                <span className="truncate">{displayName(user)}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  void logout();
                }}
                className="shrink-0 rounded-[2px] py-2 text-[15px] text-text-2 underline decoration-text/30 underline-offset-4 hover:text-lime"
              >
                Log out
              </button>
            </div>
          )}
          <ButtonLink to="/events" size="lg" onClick={onClose} className="w-full">
            Get tickets <Arrow />
          </ButtonLink>
        </div>
      </Container>
    </div>
  );
}

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { status, user } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the mobile menu whenever the route (or hash) changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.hash]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    toggleRef.current?.focus();
  }, []);

  return (
    <header
      // A light dark tint + blur keeps links readable over the brightest part of the hero;
      // once the page scrolls it settles into a near-opaque bar with a hairline.
      className={cn(
        'fixed inset-x-0 top-0 z-40 border-b backdrop-blur-md transition-[background-color,border-color] duration-300',
        scrolled ? 'border-rule bg-[rgb(12_12_12/0.88)]' : 'border-transparent bg-[rgb(12_12_12/0.28)]',
      )}
    >
      <Container className="flex h-16 items-center justify-between gap-8">
        <Wordmark />

        <div className="hidden items-center gap-10 md:flex">
          <nav aria-label="Main">
            <ul className="flex items-center gap-8">
              {[...NAV_LINKS, ...(status === 'anonymous' ? [LOGIN_LINK] : [])].map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} current={isCurrent(item.to, location.pathname, location.hash)}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          {/* Signed in: the account menu replaces "Log in". Nothing shows while the session is being checked. */}
          {status === 'authenticated' && user && <UserMenu user={user} />}
          <ButtonLink to="/events" size="sm">
            Get tickets
          </ButtonLink>
        </div>

        <button
          ref={toggleRef}
          type="button"
          className="-mr-2 grid size-11 place-items-center rounded-[2px] text-text md:hidden"
          aria-expanded={menuOpen}
          aria-controls={MOBILE_MENU_ID}
          aria-label="Open menu"
          onClick={() => setMenuOpen(true)}
        >
          <Menu className="size-6" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </Container>

      {/* Portaled so the overlay is never constrained by the header's own box. */}
      {menuOpen && createPortal(<MobileMenu onClose={closeMenu} />, document.body)}
    </header>
  );
}
