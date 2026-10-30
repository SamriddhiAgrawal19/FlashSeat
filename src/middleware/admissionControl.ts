import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { redis } from '../redis/client';
import { env } from '../config/env';

const logger = pino({ name: 'admission-control' });

// A sorted set, under a new key name: the old plain-counter key held a string,
// and a ZADD on it would fail (WRONGTYPE) until it expired.
const INFLIGHT_KEY = 'admission:inflight:booking:set';

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
// This gate rejects excess requests immediately with one Redis script call, before
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
// Each in-flight request is its own member of a sorted set, scored by the
// Redis server time it was admitted at. This replaced a plain INCR/DECR
// counter, which could leak a slot for good: if an INCR reached Redis but the
// app never saw the reply (commandTimeout fired, or the command was replayed
// after a reconnect), the request failed open and never decremented. With
// steady traffic, the counter's TTL was refreshed by every INCR, so the
// phantom count never expired (found in the Step 9 Docker battery). Here a
// lost release can only ever cost one member, and every member drops out on
// its own INFLIGHT_SAFETY_TTL_SECONDS after it was added, however much
// traffic follows: the next admission check removes it by score.
//
// One Lua script, so drop-stale + count + add is atomic: no two requests can
// both see the last free slot. Time comes from Redis's own clock (TIME), never
// the app's, for the same reason the DB clock is used for holds: several app
// instances share this set, and their clocks need not agree. (TIME before a
// write is allowed in scripts since Redis 5's effects replication.) The key's
// own PEXPIRE just cleans up an idle set; per-entry expiry is the ZREMRANGEBYSCORE.
//
// INFLIGHT_SAFETY_TTL_SECONDS (10s) must outlast any legitimate request, or a
// slow one would stop being counted while still running; the DB pool's 5s
// connectionTimeoutMillis and statement_timeout bound those well below that.
const ACQUIRE_SCRIPT = `
local t = redis.call('TIME')
local nowMs = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local ttlMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', nowMs - ttlMs)
local count = redis.call('ZCARD', KEYS[1])
if count < limit then
  redis.call('ZADD', KEYS[1], nowMs, ARGV[3])
  redis.call('PEXPIRE', KEYS[1], ttlMs)
  return {1, count + 1}
end
return {0, count}
`;

/** Returns whether this request was admitted, and the in-flight count it saw (for logs). */
async function acquireSlot(requestId: string): Promise<{ admitted: boolean; count: number }> {
  const [admitted, count] = (await redis.eval(
    ACQUIRE_SCRIPT,
    1,
    INFLIGHT_KEY,
    env.INFLIGHT_SAFETY_TTL_SECONDS * 1000,
    env.MAX_INFLIGHT_BOOKING_REQUESTS,
    requestId
  )) as [number, number];
  return { admitted: admitted === 1, count };
}

function releaseSlot(requestId: string): void {
  redis.zrem(INFLIGHT_KEY, requestId).catch((err) => {
    logger.warn({ err }, 'Redis error releasing admission slot; it expires on its own after the safety TTL');
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
 * guarded so exactly one release happens per admitted request.
 */
export async function admissionGate(req: Request, res: Response, next: NextFunction) {
  const requestId = randomUUID();
  let slot: { admitted: boolean; count: number };
  try {
    slot = await acquireSlot(requestId);
  } catch (err) {
    logger.warn({ err }, 'Redis error in admission gate; failing open');
    return next();
  }

  if (!slot.admitted) {
    // Nothing to undo: a rejected request was never added to the set.
    // Logged (like errorHandler's "Mapped database error") so SERVICE_BUSY volume
    // is visible in the logs rather than only inferable by subtracting DB_UNAVAILABLE
    // from the client-observed 503 count — a gap the Step 8 load re-run exposed.
    logger.warn({ count: slot.count, limit: env.MAX_INFLIGHT_BOOKING_REQUESTS }, 'Admission gate rejected request: SERVICE_BUSY');
    res.setHeader('Retry-After', '1');
    return res.status(503).json({ error: { message: 'Service busy, please retry', code: 'SERVICE_BUSY' } });
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseSlot(requestId);
  };
  res.on('finish', release);
  res.on('close', release);

  next();
}
