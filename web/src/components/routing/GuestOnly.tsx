import type { ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { postAuthTarget } from '../../lib/auth/redirect';
import { useAuth } from '../../lib/auth/useAuth';
import { SessionLoading } from './SessionLoading';

/** For /login and /register: logged-in users are sent on (to ?next if safe, else by role). */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [params] = useSearchParams();

  if (status === 'unknown') return <SessionLoading />;
  if (status === 'authenticated' && user) return <Navigate to={postAuthTarget(user.role, params.get('next'))} replace />;
  return <>{children}</>;
}
