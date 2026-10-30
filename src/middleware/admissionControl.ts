import { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { redis } from '../redis/client';
import { env } from '../config/env';

const logger = pino({ name: 'admission-control' });

const INFLIGHT_KEY = 'admission:inflight:booking';

// This is a cheap, approximate admission gate in front of the hot,
// write-heavy, lock-sensitive endpoints (create reservation, checkout,
// confirm) ONLY. It is NOT a replacement for the DB pool's own
// connectionTimeoutMillis/statement_timeout protections built in Batch 2
// (src/db/pool.ts) — both layers stay. What it adds: today, a request that
// arrives when the pool is already saturated still waits up to
// DB_CONNECTION_TIMEOUT_MS (5s) and holds an Express request (and a slot in
// Node's event loop) alive the whole time before getting a 503. Step 7's
// load test (load/RESULTS.md, Test B run 2) showed that past ~3,000
// concurrent requests this queuing is itself the problem: rejecting doomed
// requests late and expensively starves the ~390 req/s of real work the pool
// can actually finish, collapsing goodput to ~1-2/s at 10,000 concurrent.
// This gate rejects excess requests immediately with a Redis INCR, before
// any DB pool checkout is attempted, so the DB layer only ever sees requests
// that were admitted.
//
// MAX_INFLIGHT_BOOKING_REQUESTS=150 (default): chosen from the same run.
// Peak sustained goodput there was ~390 completed holds+409s per second on
// DB_POOL_MAX=10. At 150 admitted requests, the worst-case queuing wait for
// the request at the back of the line is ~150/390 ≈ 385ms — far inside the
// "healthy" regime Step 7 observed below ~1,340 concurrent requests (0 503s,
// p50 1.4s), and nowhere near the 5s pool-checkout timeout where 503s and
// then the goodput collapse began. 150 is a guess informed by that number,
// not a measured optimum — it has 15x headroom over the 10-connection pool,
// which should smooth short bursts without ever queuing long enough to risk
// the same collapse.
async function incrInflight(): Promise<number> {
  const pipeline = redis.pipeline();
  pipeline.incr(INFLIGHT_KEY);
  // Small TTL as a safety net only: if a response is lost (process crash,
  // killed connection) the matching decrement in `release()` below never
  // runs, and without this the counter would drift upward forever.
  //
  // Deliberately NOT 'NX' (set-once): the Step 8 load re-run first shipped
  // with NX here, and under 150s of sustained load at 10,000 concurrent it
  // made the gate nearly inert (SERVICE_BUSY never fired once in that run).
  // The reason: NX sets the TTL only on the request that happens to create
  // the key, so under continuous traffic the key's clock is never pushed
  // out — it expires on its own schedule, deletes the counter outright, and
  // the next INCR starts a fresh count from 1, discarding however many
  // requests were genuinely still in flight. Refreshing the TTL on every
  // INCR instead means it only truly expires after INFLIGHT_SAFETY_TTL_SECONDS
  // of no new admission attempts at all — by which point, given the DB pool's
  // own 5s connectionTimeoutMillis, nothing from before should still be
  // running, so a reset then is actually safe.
  pipeline.expire(INFLIGHT_KEY, env.INFLIGHT_SAFETY_TTL_SECONDS);
  const results = await pipeline.exec();
  if (!results) throw new Error('Redis pipeline returned null (connection unavailable)');
  const [incrErr, count] = results[0];
  if (incrErr) throw incrErr;
  return count as number;
}

function decrInflight(): void {
  redis.decr(INFLIGHT_KEY).catch((err) => {
    logger.warn({ err }, 'Redis error decrementing inflight counter; it will self-heal via the safety TTL');
  });
}

/**
 * Express middleware: a Redis-backed concurrency gate for the reservation and
 * checkout/confirm routes. Fails open exactly like the rate limiter — any
 * Redis error (including a timed-out command) lets the request through
 * untouched, logged as a warning.
 *
 * Express doesn't give a middleware a way to `await` the rest of the request
 * (downstream handlers call `next()` and run independently), so instead of a
 * literal try/finally around the whole request, completion is observed via
 * the response: 'finish' covers every response that was actually sent
 * (success or error, since errorHandler always calls res.json/status), and
 * 'close' covers a connection dropped before a response went out. Both are
 * guarded so exactly one decrement happens per admitted request.
 */
export async function admissionGate(req: Request, res: Response, next: NextFunction) {
  let count: number;
  try {
    count = await incrInflight();
  } catch (err) {
    logger.warn({ err }, 'Redis error in admission gate; failing open');
    return next();
  }

  if (count > env.MAX_INFLIGHT_BOOKING_REQUESTS) {
    decrInflight(); // this request is not being admitted; undo its own increment
    // Logged (like errorHandler's "Mapped database error") so SERVICE_BUSY volume
    // is visible in the logs rather than only inferable by subtracting DB_UNAVAILABLE
    // from the client-observed 503 count — a gap the Step 8 load re-run exposed.
    logger.warn({ count, limit: env.MAX_INFLIGHT_BOOKING_REQUESTS }, 'Admission gate rejected request: SERVICE_BUSY');
    res.setHeader('Retry-After', '1');
    return res.status(503).json({ error: { message: 'Service busy, please retry', code: 'SERVICE_BUSY' } });
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    decrInflight();
  };
  res.on('finish', release);
  res.on('close', release);

  next();
}
