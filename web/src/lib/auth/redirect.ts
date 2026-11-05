import type { Role } from './jwt';

/**
 * A ?next= value is only followed when it is a same-site relative path: it must start with a
 * single "/" (not "//" or "/\", which browsers treat as another host).
 */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  return next;
}

/** Where to go after logging in or registering: ?next if safe, else by role. */
export function postAuthTarget(role: Role, next: string | null): string {
  return safeNext(next) ?? (role === 'ORGANIZER' ? '/organizer' : '/events');
}

/** /login?next=<path> for the given location. */
export function loginUrlFor(pathname: string, search = ''): string {
  return `/login?next=${encodeURIComponent(pathname + search)}`;
}
