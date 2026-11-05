import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { categoryLabel } from '../lib/categories';
import { ButtonLink } from '../components/ui/Button';
import { Container } from '../components/ui/Container';
import { Eyebrow } from '../components/ui/Section';

interface ComingSoonProps {
  title: string;
  heading?: string;
  message?: string;
}

/** "Theatre in Pune" from ?category=THEATRE&city=Pune, or null when there are no filters. */
function useSearchSummary(): string | null {
  const [params] = useSearchParams();
  const city = params.get('city');
  const category = params.get('category');
  if (!city && !category) return null;
  const what = category ? categoryLabel(category) : 'Events';
  return city ? `${what} in ${city}` : what;
}

/** Placeholder for pages that are not built yet. */
export function ComingSoon({
  title,
  heading = 'Coming soon',
  message = "We're still building this page. Check back shortly.",
}: ComingSoonProps) {
  const searchSummary = useSearchSummary();

  useEffect(() => {
    document.title = `${title} · FlashSeat`;
  }, [title]);

  return (
    <section aria-labelledby="coming-soon-title" className="relative isolate overflow-hidden pt-40 pb-28 md:pt-48">
      <Container className="flex flex-col items-center text-center">
        <Eyebrow>{title}</Eyebrow>
        <h1 id="coming-soon-title" className="mt-4 text-section font-medium text-text">
          {heading}
        </h1>
        {searchSummary && (
          <p className="label-mono mt-6 border-y border-rule px-3 py-2 text-text-2">
            You searched for: {searchSummary}
          </p>
        )}
        <p className="mt-4 max-w-[46ch] text-text-2">{message}</p>
        <ButtonLink to="/" variant="secondary" className="mt-8">
          <span aria-hidden="true">←</span> Back to home
        </ButtonLink>
      </Container>
    </section>
  );
}
