import { Request, Response } from 'express';
import { registerSchema, loginSchema } from './auth.schema';
import * as authService from './auth.service';
import { pool, withTransaction } from '../../db/pool';

const COOKIE_NAME = 'refresh_token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/auth'
};

export async function register(req: Request, res: Response) {
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
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
    } else if (err instanceof authService.AuthError) {
      res.status(err.statusCode).json({ error: err.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export async function login(req: Request, res: Response) {
  try {
    const data = loginSchema.parse(req.body);
    
    const result = await withTransaction(async (client) => {
      return await authService.login(client, data);
    });

    res.cookie(COOKIE_NAME, result.refreshToken, COOKIE_OPTIONS);
    res.json({ accessToken: result.accessToken });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
    } else if (err instanceof authService.AuthError) {
      res.status(err.statusCode).json({ error: err.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export async function refresh(req: Request, res: Response) {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) {
      res.status(401).json({ error: 'No refresh token provided' });
      return;
    }

    const result = await withTransaction(async (client) => {
      return await authService.refresh(client, token);
    });

    res.cookie(COOKIE_NAME, result.refreshToken, COOKIE_OPTIONS);
    res.json({ accessToken: result.accessToken });
  } catch (err: any) {
    if (err instanceof authService.AuthError) {
      res.status(err.statusCode).json({ error: err.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export async function logout(req: Request, res: Response) {
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
    res.status(500).json({ error: 'Internal server error' });
  }
}
