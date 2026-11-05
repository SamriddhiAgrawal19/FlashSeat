import { ArrowLeft, CalendarDays, LayoutGrid, MapPin } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../lib/auth/useAuth';
import { cn } from '../../lib/cn';

const ITEMS = [
  { label: 'Overview', to: '/organizer', icon: LayoutGrid, match: (p: string) => p === '/organizer' || p === '/organizer/' },
  { label: 'Events', to: '/organizer/events', icon: CalendarDays, match: (p: string) => p.startsWith('/organizer/events') },
  { label: 'Venues', to: '/organizer/venues', icon: MapPin, match: (p: string) => p.startsWith('/organizer/venues') },
];

/** Desktop: a slim left column. Phones and tablets: a tab bar under the site navbar. */
export function Sidebar() {
  const { pathname } = useLocation();
  const { user } = useAuth();

  return (
    <>
      <aside aria-label="Organizer" className="hidden w-52 shrink-0 border-r border-rule lg:block">
        <div className="sticky top-16 flex h-[calc(100dvh-4rem)] flex-col px-3 py-8">
          <p className="label-mono truncate px-3 text-text-3" title={user?.organizationName ?? undefined}>
            {user?.organizationName ?? 'Organizer'}
          </p>
          <nav aria-label="Organizer sections" className="mt-4">
            <ul className="flex flex-col gap-0.5">
              {ITEMS.map(({ label, to, icon: Icon, match }) => {
                const current = match(pathname);
                return (
                  <li key={to}>
                    <Link
                      to={to}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'relative flex h-9 items-center gap-3 rounded-[2px] px-3 text-[14px] transition-colors',
                        current ? 'bg-text/[0.06] text-text' : 'text-text-2 hover:bg-text/[0.03] hover:text-text',
                      )}
                    >
                      {current && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 bg-lime" />}
                      <Icon aria-hidden="true" strokeWidth={1.5} className="size-4" />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <Link to="/" className="mt-auto flex h-9 items-center gap-3 rounded-[2px] px-3 text-[14px] text-text-3 transition-colors hover:text-text">
            <ArrowLeft aria-hidden="true" strokeWidth={1.5} className="size-4" />
            Back to site
          </Link>
        </div>
      </aside>

      <nav aria-label="Organizer sections" className="sticky top-16 z-30 border-b border-rule bg-bg/95 backdrop-blur-md lg:hidden">
        <ul className="no-scrollbar flex overflow-x-auto px-4 sm:px-6">
          {ITEMS.map(({ label, to, match }) => {
            const current = match(pathname);
            return (
              <li key={to} className="shrink-0">
                <Link
                  to={to}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    '-mb-px flex h-11 items-center border-b-2 px-3 text-[14px] transition-colors first:pl-0',
                    current ? 'border-lime text-text' : 'border-transparent text-text-2 hover:text-text',
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
          <li className="ml-auto shrink-0 pl-3">
            <Link to="/" className="flex h-11 items-center gap-1.5 text-[14px] text-text-3 hover:text-text">
              <ArrowLeft aria-hidden="true" strokeWidth={1.5} className="size-3.5" />
              Site
            </Link>
          </li>
        </ul>
      </nav>
    </>
  );
}

/** The /organizer frame: sidebar (or tabs) plus the page. Sits under the fixed 64px site navbar. */
export function OrganizerShell() {
  return (
    <div className="pt-16 lg:flex">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[72rem] px-4 pt-6 pb-24 sm:px-6 lg:px-10 lg:pt-10">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
