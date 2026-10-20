import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env';
import { UnauthorizedError } from '../../utils/errors';

export interface AccessTokenPayload {
  userId: string;
  role: string;
}

// The payload is attacker-controllable input once the signature is checked, so it
// is validated structurally instead of being trusted via a type cast.
const accessTokenPayloadSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['ATTENDEE', 'ORGANIZER', 'ADMIN']),
});

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_EXPIRY as any,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      clockTolerance: 5,
    });
    return accessTokenPayloadSchema.parse(decoded);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Access token expired', 'TOKEN_EXPIRED');
    }
    // bad signature, wrong alg, malformed or schema-invalid payload
    throw new UnauthorizedError('Invalid access token', 'INVALID_TOKEN');
  }
}
