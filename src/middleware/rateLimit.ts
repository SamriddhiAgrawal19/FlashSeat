import { Request, Response, NextFunction } from 'express';
import { redis, withRedisFallback } from '../redis/client';
import { env } from '../config/env';

interface RateLimitOptions {
  /** Derives the Redis key suffix from the request (e.g. IP, email, user id). Returning null skips the check for that request. */
  keyFn: (req: Request) => string | null;
  limit: number;
  windowSeconds: number;
  /** Namespaces this limiter's Redis keys; also used in logs. */
  name: string;
}

interface LimitCheck {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Fixed-window counter (INCR + EXPIRE), not sliding-window or token-bucket:
//  - INCR is atomic in Redis, so no Lua script or WATCH/MULTI is needed to
//    avoid a races between "read the count" and "increment it" — one round
//    trip (two pipelined commands) is enough.
//  - The only downside is burst behavior at a window edge (a client could
//    send `limit` requests right at the end of one window and another
//    `limit` right at the start of the next, i.e. up to 2x `limit` in a short
//    span). That's acceptable here: these limits exist to blunt brute-force
//    login/register attempts and seat-hold griefing, not to guarantee an
//    exact request rate.
//  - EXPIRE uses NX (set the TTL only if the key doesn't already have one) on
//    every call, not just when the count is 1: that avoids a window where the
//    key exists without a TTL (e.g. if a crash or network blip happened
//    between a separate INCR and EXPIRE call) which would otherwise pin a
//    client under its limit forever.
async function checkFixedWindow(key: string, limit: number, windowSeconds: number): Promise<LimitCheck> {
  const pipeline = redis.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, windowSeconds, 'NX');
  const results = await pipeline.exec();
  if (!results) {
    throw new Error('Redis pipeline returned null (connection unavailable)');
  }
  const [incrErr, count] = results[0];
  if (incrErr) throw incrErr;

  if ((count as number) <= limit) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  const ttl = await redis.ttl(key);
  return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
}

/** Express middleware factory for a fixed-window Redis rate limiter. Fails open on any Redis error. */
export function rateLimit({ keyFn, limit, windowSeconds, name }: RateLimitOptions) {
  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!env.ENABLE_RATE_LIMITING) return next();

    const keyPart = keyFn(req);
    if (!keyPart) return next();

    const redisKey = `ratelimit:${name}:${keyPart}`;
    const result = await withRedisFallback(
      () => checkFixedWindow(redisKey, limit, windowSeconds),
      { allowed: true, retryAfterSeconds: 0 },
      `rateLimit:${name}`
    );

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      return res.status(429).json({ error: { message: 'Too many requests', code: 'RATE_LIMITED' } });
    }
    next();
  };
}
