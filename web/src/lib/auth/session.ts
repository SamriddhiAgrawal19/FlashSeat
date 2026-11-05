// Session store: the access token lives ONLY in this module (memory). The refresh token is the
// backend's HttpOnly cookie (Path=/api/auth through the Vite proxy) and is never readable here.
//
// The backend rotates the refresh token on every POST /auth/refresh and treats a second use of
// an already-rotated token as theft (it revokes every session of that user). So there must never
// be two refreshes in flight: everything goes through refreshSession(), which shares one promise,
// and across tabs the refresh is serialized with the Web Locks API.

import { decodeAccessToken, type AccessClaims, type Role } from './jwt';

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

/**
 * The signed-in user. id and role always come from the access token; name, email and
 * organizationName come from GET /auth/me (absent only if that call could not be made).
 */
export interface SessionUser {
  id: string;
  role: Role;
  name?: string;
  email?: string;
  organizationName?: string | null;
}

/** GET /auth/me body (src/modules/auth/auth.service.ts getMe). */
interface MeResponse {
  user: {
    id: string;
    name: string;
    email: string;
    role: Role;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    organization_name: string | null;
  };
}

export interface SessionSnapshot {
  status: SessionStatus;
  user: SessionUser | null;
}

const REFRESH_URL = '/api/auth/refresh';
const LOGOUT_URL = '/api/auth/logout';
const ME_URL = '/api/auth/me';
const REFRESH_EARLY_MS = 60_000; // refresh one minute before the access token expires
const MIN_REFRESH_DELAY_MS = 5_000;
// Older builds cached the name/email here. Nothing is stored any more; remove the leftover once.
const LEGACY_PROFILE_KEY = 'flashseat:profile';
const CHANNEL_NAME = 'flashseat:auth';
const LOCK_NAME = 'flashseat:refresh';

let accessToken: string | null = null;
let claims: AccessClaims | null = null;
let snapshot: SessionSnapshot = { status: 'unknown', user: null };
let refreshTimer: number | undefined;
let inflight: Promise<boolean> | null = null;
let restoring: Promise<boolean> | null = null;

const listeners = new Set<() => void>();
const expiredHandlers = new Set<() => void>();
const remoteLogoutHandlers = new Set<() => void>();

try {
  localStorage.removeItem(LEGACY_PROFILE_KEY);
} catch {
  // Storage blocked: nothing to clean up.
}

// --- store ---------------------------------------------------------------------------

function emit(next: SessionSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): SessionSnapshot {
  return snapshot;
}

export function getAccessToken(): string | null {
  return accessToken;
}

function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  if (!claims) return;
  const delay = Math.max(claims.exp * 1000 - Date.now() - REFRESH_EARLY_MS, MIN_REFRESH_DELAY_MS);
  refreshTimer = window.setTimeout(() => {
    void refreshSession();
  }, delay);
}

/** Read the current user from GET /auth/me with the given token. */
async function fetchMe(token: string): Promise<SessionUser | 'invalid' | null> {
  let response: Response;
  try {
    response = await fetch(ME_URL, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, credentials: 'include' });
  } catch {
    return null; // network trouble: keep the session, just without profile details
  }
  if (response.status === 401) return 'invalid'; // user deleted or deactivated
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as MeResponse | null;
  const user = body?.user;
  if (!user || typeof user.id !== 'string') return null;
  return { id: user.id, role: user.role, name: user.name, email: user.email, organizationName: user.organization_name };
}

/**
 * Store a freshly issued access token (from login, register or refresh). The first time a user
 * is seen (or when the user changes) their details are loaded from GET /auth/me; token
 * rotations for the same user keep the details already loaded. Returns false if the session
 * could not be established.
 */
export async function setAccessToken(token: string): Promise<boolean> {
  const decoded = decodeAccessToken(token);
  if (!decoded) return false;
  accessToken = token;
  claims = decoded;
  scheduleRefresh();

  const known = snapshot.user?.id === decoded.userId && snapshot.user.name !== undefined ? snapshot.user : null;
  if (known) {
    emit({ status: 'authenticated', user: { ...known, role: decoded.role } });
    return true;
  }
  const me = await fetchMe(token);
  if (me === 'invalid') {
    clearLocal();
    return false;
  }
  emit({ status: 'authenticated', user: me ?? { id: decoded.userId, role: decoded.role } });
  return true;
}

/**
 * Development aid only (used by lib/auth/devtools.ts): forget the in-memory access token while
 * keeping the session marked as signed in, to exercise the 401 -> single refresh -> retry path.
 */
export function dropAccessTokenForTesting() {
  accessToken = null;
}

function clearLocal() {
  accessToken = null;
  claims = null;
  window.clearTimeout(refreshTimer);
  emit({ status: 'anonymous', user: null });
}

// --- refresh ---------------------------------------------------------------------------

async function postRefresh(): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(REFRESH_URL, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
  } catch {
    // Offline or API unreachable: the cookie may still be valid, so don't throw the session away.
    if (snapshot.status === 'unknown') emit({ status: 'anonymous', user: null });
    return false;
  }
  if (response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const token = typeof body === 'object' && body !== null ? (body as { accessToken?: unknown }).accessToken : undefined;
    if (typeof token === 'string' && (await setAccessToken(token))) return true;
  }
  // 401 (no cookie, expired, revoked or reused) or a malformed reply: there is no session.
  clearLocal();
  return false;
}

/**
 * The ONE way to refresh. Concurrent callers (parallel 401s, the proactive timer, StrictMode's
 * double effects) all receive the same promise, so at most one POST /auth/refresh is in flight.
 * Across tabs, the Web Locks API makes tabs take turns, so they never present the same cookie twice.
 */
export function refreshSession(): Promise<boolean> {
  if (inflight) return inflight;
  const run = () => postRefresh();
  inflight = (navigator.locks ? navigator.locks.request(LOCK_NAME, run) : run()).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Restore the session on app start. Idempotent: every caller gets the same first refresh. */
export function restoreSession(): Promise<boolean> {
  restoring ??= refreshSession();
  return restoring;
}

// --- expiry & logout -------------------------------------------------------------------

/** Register a handler for "the session died mid-use" (refresh failed after a 401). */
export function onSessionExpired(handler: () => void): () => void {
  expiredHandlers.add(handler);
  return () => expiredHandlers.delete(handler);
}

/** Called by the API client when a request got a 401 and the refresh failed. */
export function handleSessionExpired() {
  clearLocal();
  expiredHandlers.forEach((handler) => handler());
}

/** Register a handler for "another tab logged out". */
export function onRemoteLogout(handler: () => void): () => void {
  remoteLogoutHandlers.add(handler);
  return () => remoteLogoutHandlers.delete(handler);
}

const channel: BroadcastChannel | null = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
channel?.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.data !== 'logout') return;
  clearLocal();
  remoteLogoutHandlers.forEach((handler) => handler());
});

/** Revoke the refresh token server-side, forget everything locally and tell other tabs. */
export async function logout(): Promise<void> {
  // Let any refresh that is already running finish first, so the cookie we revoke is the current one.
  await inflight?.catch(() => undefined);
  try {
    await fetch(LOGOUT_URL, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
  } catch {
    // Even if the request fails we still end the session in this browser.
  }
  clearLocal();
  channel?.postMessage('logout'); // a plain signal: no tokens or user data are broadcast
}
