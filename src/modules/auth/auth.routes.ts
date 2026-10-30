import { Router } from 'express';
import * as authController from './auth.controller';
import { rateLimit } from '../../middleware/rateLimit';
import { env } from '../../config/env';

export const authRouter = Router();

// Blunts credential-stuffing from a single source IP.
const loginIpLimit = rateLimit({
  name: 'login-ip',
  keyFn: (req) => req.ip ?? null,
  limit: env.RATE_LIMIT_LOGIN_IP_LIMIT,
  windowSeconds: env.RATE_LIMIT_LOGIN_IP_WINDOW_SECONDS,
});

// Tighter limit keyed on the targeted account rather than the source: the
// actual brute-force vector, and the one an attacker can't dodge by
// rotating IPs. Both this and loginIpLimit must pass.
const loginEmailLimit = rateLimit({
  name: 'login-email',
  keyFn: (req) => (typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : null),
  limit: env.RATE_LIMIT_LOGIN_EMAIL_LIMIT,
  windowSeconds: env.RATE_LIMIT_LOGIN_EMAIL_WINDOW_SECONDS,
});

// Throttles mass account creation from one source.
const registerIpLimit = rateLimit({
  name: 'register-ip',
  keyFn: (req) => req.ip ?? null,
  limit: env.RATE_LIMIT_REGISTER_IP_LIMIT,
  windowSeconds: env.RATE_LIMIT_REGISTER_IP_WINDOW_SECONDS,
});

authRouter.post('/register', registerIpLimit, authController.register);
authRouter.post('/login', loginIpLimit, loginEmailLimit, authController.login);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authController.logout);
