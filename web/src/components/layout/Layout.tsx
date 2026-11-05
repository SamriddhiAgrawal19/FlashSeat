import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { cn } from '../../lib/cn';
import { SiteFooter } from '../site/SiteFooter';
import { SiteHeader } from '../site/SiteHeader';
import { Toaster } from '../ui/Toaster';
import { Footer } from './Footer';
import { Navbar } from './Navbar';

/** Scroll to the #hash target after navigation (e.g. /#categories), or to the top on a new page. */
function useScrollOnNavigate() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
      return;
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
}

export function Layout() {
  useScrollOnNavigate();
  // Pages on the v2 look (styles/theme-v2.css) get the v2 header and footer inside the .v2 scope;
  // the landing also gets its own .lp scope. /login and /register are v2 and full-bleed (no header
  // or footer). Every other page keeps the old Navbar and Footer.
  const { pathname } = useLocation();
  const isLanding = pathname === '/';
  const isAuth = pathname === '/login' || pathname === '/register';
  const isV2 = isLanding || isAuth || pathname === '/events' || pathname.startsWith('/events/');

  return (
    <div className={cn('flex min-h-dvh flex-col', isV2 && 'v2', isLanding && 'lp')}>
      <a
        href="#main"
        className="sr-only z-[70] rounded-[10px] bg-text px-4 py-2 text-sm font-medium text-bg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      {isAuth ? null : isV2 ? <SiteHeader /> : <Navbar />}
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      {isAuth ? null : isV2 ? <SiteFooter /> : <Footer />}
      <Toaster />
    </div>
  );
}
