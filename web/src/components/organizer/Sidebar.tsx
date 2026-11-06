import { Link, Outlet, useLocation } from 'react-router';
import { initials, useAuth } from '../../lib/auth/useAuth';
import { TicketMark } from '../site/SiteHeader';
import './organizer.css';

const ITEMS = [
  { label: 'Overview', to: '/organizer', match: (p: string) => p === '/organizer' || p === '/organizer/' },
  { label: 'Events', to: '/organizer/events', match: (p: string) => p.startsWith('/organizer/events') },
  { label: 'Venues', to: '/organizer/venues', match: (p: string) => p.startsWith('/organizer/venues') },
];

/**
 * The organizer sidebar (docs/organizer-dashboard-design.html): logo, organization card, nav with
 * the coral dot on the current item, "Back to site" and the user chip. Below 900px it becomes a
 * sticky top bar with the nav as tabs.
 */
export function Sidebar() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const org = user?.organizationName ?? null;

  return (
    <aside aria-label="Organizer" className="og-side">
      <div className="og-side-in">
        <div className="og-side-top">
          <Link to="/" className="og-logo">
            <TicketMark />
            FlashSeat
          </Link>
          <div className="og-top-only">
            {org && <span className="og-top-org">{org}</span>}
            <Link to="/" className="og-back">
              ← Site
            </Link>
          </div>
        </div>

        <div className="og-org">
          <span className="og-org-label">ORGANIZER</span>
          <span className="og-org-name">{org ?? user?.name ?? 'Your organization'}</span>
        </div>

        <nav aria-label="Organizer sections" className="og-nav">
          <ul>
            {ITEMS.map(({ label, to, match }) => {
              const current = match(pathname);
              return (
                <li key={to}>
                  <Link to={to} className="og-navl" aria-current={current ? 'page' : undefined}>
                    <span aria-hidden="true" className="og-dot" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="og-side-foot">
          <Link to="/" className="og-back">
            ← Back to site
          </Link>
          {user && (
            <div className="og-user">
              <span aria-hidden="true" className="og-avatar">
                {initials(user)}
              </span>
              <span className="og-user-text">
                <span className="og-user-name">{user.name ?? 'Organizer'}</span>
                {user.email && (
                  <span className="og-user-mail" title={user.email}>
                    {user.email}
                  </span>
                )}
              </span>
              <button type="button" className="og-logout" onClick={() => void logout()}>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

/** The /organizer frame: sidebar (or top bar) plus the page, which fades in on every navigation. */
export function OrganizerShell() {
  const { pathname } = useLocation();
  return (
    <div className="og-shell">
      <Sidebar />
      <div className="og-main">
        <div key={pathname}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
