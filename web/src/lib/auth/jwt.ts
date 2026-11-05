// Decodes the access token's payload for UI purposes only (who is logged in, which role,
// when the token expires). It is NEVER verified here and never trusted for security:
// the API verifies the signature on every request.

export type Role = 'ATTENDEE' | 'ORGANIZER' | 'ADMIN';

/** Claims the backend signs (src/modules/auth/jwt.ts): userId and role, plus jsonwebtoken's iat/exp. */
export interface AccessClaims {
  userId: string;
  role: Role;
  /** Expiry, seconds since the epoch. */
  exp: number;
  iat?: number;
}

const ROLES: readonly Role[] = ['ATTENDEE', 'ORGANIZER', 'ADMIN'];

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The payload of a JWT, or null if it isn't a well-formed FlashSeat access token. */
export function decodeAccessToken(token: string): AccessClaims | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const value: unknown = JSON.parse(base64UrlDecode(payload));
    if (typeof value !== 'object' || value === null) return null;
    const { userId, role, exp, iat } = value as Record<string, unknown>;
    if (typeof userId !== 'string' || typeof exp !== 'number') return null;
    if (typeof role !== 'string' || !ROLES.includes(role as Role)) return null;
    return { userId, role: role as Role, exp, iat: typeof iat === 'number' ? iat : undefined };
  } catch {
    return null;
  }
}
