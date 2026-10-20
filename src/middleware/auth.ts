import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../modules/auth/jwt';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';

// Augment Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        role: string;
      };
    }
  }
}

// Deliberately stateless: no DB lookup per request. Deactivating a user therefore
// takes effect at their next refresh or login, at most JWT_ACCESS_EXPIRY later.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or invalid Authorization header', 'UNAUTHORIZED'));
  }

  const token = authHeader.split(' ')[1];

  try {
    req.user = verifyAccessToken(token); // throws TOKEN_EXPIRED / INVALID_TOKEN
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Not authenticated', 'UNAUTHORIZED'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError('Forbidden', 'FORBIDDEN'));
    }

    next();
  };
}
