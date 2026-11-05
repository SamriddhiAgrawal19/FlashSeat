import type { ReactNode } from 'react';
import type { Role } from '../../lib/auth/jwt';
import { useAuth } from '../../lib/auth/useAuth';
import { Arrow, ButtonLink } from '../ui/Button';
import { Container } from '../ui/Container';
import { Eyebrow } from '../ui/Section';

/** Place inside <RequireAuth>. Logged-in users without the role see a short explanation. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role === role) return <>{children}</>;

  return (
    <section aria-labelledby="role-title" className="pt-40 pb-28 md:pt-48">
      <Container className="max-w-[40rem]">
        <Eyebrow>Restricted</Eyebrow>
        <h1 id="role-title" className="mt-4 text-section font-medium text-text">
          Organizer accounts only.
        </h1>
        <p className="mt-4 text-text-2">
          This area is for people who host events. You're signed in with an attendee account, so there's nothing to manage
          here yet.
        </p>
        <ButtonLink to="/" variant="secondary" className="mt-8">
          Back to home <Arrow />
        </ButtonLink>
      </Container>
    </section>
  );
}
