import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { cn } from '../../lib/cn';
import { LandingFooter } from '../landing/LandingFooter';
import { LandingHeader } from '../landing/LandingHeader';
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
  // The landing page has its own design (docs/landing-v2-design.html): its own header and footer,
  // styled inside the .lp scope. Every other page keeps the shared Navbar and Footer.
  const isLanding = useLocation().pathname === '/';

  return (
    <div className={cn('flex min-h-dvh flex-col', isLanding && 'lp')}>
      <a
        href="#main"
        className="sr-only z-[70] rounded-[10px] bg-text px-4 py-2 text-sm font-medium text-bg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      {isLanding ? <LandingHeader /> : <Navbar />}
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      {isLanding ? <LandingFooter /> : <Footer />}
      <Toaster />
    </div>
  );
}
