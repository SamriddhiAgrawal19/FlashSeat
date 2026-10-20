import { Request, Response, NextFunction } from 'express';
import { registerSchema, loginSchema } from './auth.schema';
import * as authService from './auth.service';
import { withTransaction } from '../../db/pool';
import { AppError, UnauthorizedError } from '../../utils/errors';

const COOKIE_NAME = 'refreshToken';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/auth'
};

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const data = registerSchema.parse(req.body);

    const result = await withTransaction(async (client) => {
      return await authService.register(client, data);
    });

    res.cookie(COOKIE_NAME, result.refreshToken, COOKIE_OPTIONS);
    res.status(201).json({
      user: result.user,
      accessToken: result.accessToken
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const data = loginSchema.parse(req.body);

    const result = await withTransaction(async (client) => {
      return await authService.login(client, data);
    });

    res.cookie(COOKIE_NAME, result.refreshToken, COOKIE_OPTIONS);
    res.json({ accessToken: result.accessToken });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) {
      throw new UnauthorizedError('No refresh token provided', 'UNAUTHORIZED');
    }

    const result = await authService.refresh(token);

    res.cookie(COOKIE_NAME, result.refreshToken, COOKIE_OPTIONS);
    res.json({ accessToken: result.accessToken });
  } catch (err) {
    // Every 401 clears the cookie with the same path/options it was set with.
    // Transient 5xx failures deliberately keep it: the session may still be valid.
    if (err instanceof AppError && err.statusCode === 401) {
      res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
    }
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (token) {
      await withTransaction(async (client) => {
        await authService.logout(client, token);
      });
    }
    res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
