import { createContext, useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { loginRequest, registerRequest, type RegisterBody } from './authApi';
import { loginUrlFor } from './redirect';
import * as session from './session';
import type { SessionStatus, SessionUser } from './session';

export interface AuthContextValue {
  status: SessionStatus;
  user: SessionUser | null;
  /** Throws ApiError on failure (INVALID_CREDENTIALS, RATE_LIMITED, NETWORK_ERROR, ...). */
  login: (email: string, password: string) => Promise<SessionUser>;
  /** Throws ApiError on failure (EMAIL_TAKEN, VALIDATION_ERROR, RATE_LIMITED, ...). */
  register: (body: RegisterBody) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

function currentUser(): SessionUser {
  const { user } = session.getSnapshot();
  if (!user) throw new Error('Session was not established');
  return user;
}

/** Owns the browser session: restores it on start, reacts to expiry and to logout in other tabs. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { status, user } = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Restore once. restoreSession() is idempotent, so StrictMode's second effect run shares the
  // first refresh instead of starting another one.
  useEffect(() => {
    void session.restoreSession();
  }, []);

  // A request got a 401 and the refresh failed: the session is gone; send the user to log in.
  useEffect(
    () =>
      session.onSessionExpired(() => {
        queryClient.clear();
        navigate(loginUrlFor(window.location.pathname, window.location.search), { replace: true });
      }),
    [navigate, queryClient],
  );

  // Another tab logged out: drop cached data here too. Guards redirect protected pages.
  useEffect(() => session.onRemoteLogout(() => queryClient.clear()), [queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken } = await loginRequest(email, password);
    session.setAccessToken(accessToken, { email });
    return currentUser();
  }, []);

  const register = useCallback(async (body: RegisterBody) => {
    const { user: created, accessToken } = await registerRequest(body);
    session.setAccessToken(accessToken, { name: created.name, email: created.email });
    return currentUser();
  }, []);

  const logout = useCallback(async () => {
    await session.logout();
    queryClient.clear();
    navigate('/');
  }, [navigate, queryClient]);

  const value = useMemo<AuthContextValue>(() => ({ status, user, login, register, logout }), [status, user, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
