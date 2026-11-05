import { useEffect } from 'react';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../components/landing/landing.css';
import { CategoryMarquee } from '../components/landing/CategoryMarquee';
import { FinalCta } from '../components/landing/FinalCta';
import { Hero } from '../components/landing/Hero';
import { ThisWeek } from '../components/landing/ThisWeek';
import { TryIt } from '../components/landing/TryIt';
import { WhyFlashSeat } from '../components/landing/WhyFlashSeat';

/**
 * The landing page (docs/landing-v2-design.html). Its header and footer (LandingHeader,
 * LandingFooter) are rendered by Layout on "/", inside the .lp style scope.
 */
export function LandingPage() {
  useEffect(() => {
    document.title = 'FlashSeat · Every seat, yours to choose';
  }, []);

  return (
    <>
      <Hero />
      <CategoryMarquee />
      <ThisWeek />
      <TryIt />
      <WhyFlashSeat />
      <FinalCta />
    </>
  );
}
