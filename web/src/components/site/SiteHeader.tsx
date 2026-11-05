import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router';
import { Menu } from 'lucide-react';
import { useAuth } from '../../lib/auth/useAuth';
import { NAV_LINKS } from '../layout/navLinks';
import { MOBILE_MENU_ID, MobileMenu } from '../layout/Navbar';
import { UserMenu } from '../layout/UserMenu';

/** The ticket mark from the designs. */
export function TicketMark() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 7a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4z" />
      <path d="M9 5v14" strokeDasharray="2 2" />
    </svg>
  );
}

/** "Explore" is current anywhere under /events; hash links (/#categories) never are. */
function isCurrent(to: string, pathname: string): boolean {
  if (to.includes('#')) return false;
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Publishes the header's height as --site-header-h, so sticky bars below it line up exactly. */
function useHeaderHeightVar() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--site-header-h', `${el.offsetHeight}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(set);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

/**
 * The v2 site header (sticky, blurred). Same auth behaviour as the old Navbar: "Log in" for
 * guests, the account menu when signed in, nothing while the session is loading; below 768px the
 * full-screen mobile menu. Used on "/", "/events" and "/events/:eventId" (Layout).
 */
export function SiteHeader() {
  const { status, user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const headerRef = useHeaderHeightVar();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.hash]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    toggleRef.current?.focus();
  }, []);

  return (
    <header ref={headerRef} className="site-header">
      <div className="site-wrap site-header-in">
        <Link to="/" className="site-logo">
          <TicketMark />
          FlashSeat
        </Link>
        <nav aria-label="Main" className="site-nav">
          {NAV_LINKS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="site-navl"
              aria-current={isCurrent(item.to, location.pathname) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="site-header-actions">
          {status === 'anonymous' && (
            <Link to="/login" className="site-navl" style={{ fontSize: 14, padding: '10px 14px' }}>
              Log in
            </Link>
          )}
          {status === 'authenticated' && user && <UserMenu user={user} />}
          <Link to="/events" className="site-btn site-btn-primary site-btn-nav">
            Get tickets <span className="site-arr">→</span>
          </Link>
        </div>
        <button
          ref={toggleRef}
          type="button"
          className="site-menu-btn"
          aria-expanded={menuOpen}
          aria-controls={MOBILE_MENU_ID}
          aria-label="Open menu"
          onClick={() => setMenuOpen(true)}
        >
          <Menu size={24} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      {menuOpen && createPortal(<MobileMenu onClose={closeMenu} />, document.body)}
    </header>
  );
}
