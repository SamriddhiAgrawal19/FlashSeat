import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router';
import { Menu } from 'lucide-react';
import { useAuth } from '../../lib/auth/useAuth';
import { NAV_LINKS } from '../layout/navLinks';
import { MOBILE_MENU_ID, MobileMenu } from '../layout/Navbar';
import { UserMenu } from '../layout/UserMenu';

/** The ticket mark from the design. */
export function TicketMark() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 7a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4z" />
      <path d="M9 5v14" strokeDasharray="2 2" />
    </svg>
  );
}

/**
 * The landing page's header (design: sticky, blurred). Same auth behaviour as the shared Navbar:
 * "Log in" for guests, the account menu when signed in, nothing while the session is loading;
 * below 768px the same full-screen mobile menu.
 */
export function LandingHeader() {
  const { status, user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.hash]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    toggleRef.current?.focus();
  }, []);

  return (
    <header className="lp-header">
      <div className="lp-wrap lp-header-in">
        <Link to="/" className="lp-logo">
          <TicketMark />
          FlashSeat
        </Link>
        <nav aria-label="Main" className="lp-nav">
          {NAV_LINKS.map((item) => (
            <Link key={item.to} to={item.to} className="lp-navl">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="lp-header-actions">
          {status === 'anonymous' && (
            <Link to="/login" className="lp-navl" style={{ fontSize: 14, padding: '10px 14px' }}>
              Log in
            </Link>
          )}
          {status === 'authenticated' && user && <UserMenu user={user} />}
          <Link to="/events" className="lp-btn lp-btn-w lp-btn-sm">
            Get tickets <span className="lp-arr">→</span>
          </Link>
        </div>
        <button
          ref={toggleRef}
          type="button"
          className="lp-menu-btn"
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
