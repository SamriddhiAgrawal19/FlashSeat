import { useEffect } from 'react';
import { Categories } from '../components/landing/categories/Categories';
import { Featured } from '../components/landing/featured/Featured';
import { DiscoverBar } from '../components/landing/hero/DiscoverBar';
import { Hero } from '../components/landing/hero/Hero';
import { OrganizerCta } from '../components/landing/organizers/OrganizerCta';
import { WhyStory } from '../components/landing/story/WhyStory';

export function LandingPage() {
  useEffect(() => {
    document.title = 'FlashSeat · Make room for moments that matter';
  }, []);

  return (
    <>
      <Hero />
      <DiscoverBar />
      <Featured />
      <Categories />
      <WhyStory />
      <OrganizerCta />
    </>
  );
}
