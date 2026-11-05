import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { loginUrlFor } from '../../lib/auth/redirect';
import { useAuth } from '../../lib/auth/useAuth';
import { SessionLoading } from './SessionLoading';

/** Renders children for logged-in users; others go to /login?next=<this page>. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'unknown') return <SessionLoading />;
  if (status === 'anonymous') return <Navigate to={loginUrlFor(location.pathname, location.search)} replace />;
  return <>{children}</>;
}
