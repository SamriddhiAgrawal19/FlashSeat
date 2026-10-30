import Redis from 'ioredis';
import pino from 'pino';
import { env } from '../config/env';

const logger = pino({ name: 'redis' });

// Redis is advisory, never authoritative, everywhere it's used in this app
// (rate limiting, the admission gate, the seat-map cache): every caller must
// treat an outage as "allow"/"fall through to the DB", never as a reason to
// throw or hang. maxRetriesPerRequest bounds how many times ioredis will
// requeue a command while disconnected before rejecting it (the default is
// unlimited, which would make a caller await forever on a dead connection);
// commandTimeout bounds a single command even against an open-but-stuck
// connection, so a caller can never block on Redis for longer than this.
//
// commandTimeout=2000, not something tighter like 250: the first Step 8 load
// re-run (load/results/throughput-run4-attempt1-commandtimeout-bug.*) used 250
// and measured WORSE throughput than the ungated run from Step 7 — the gate
// made things worse, not better. The server log showed why: at 10,000
// concurrent requests Node's event loop itself lags by over a second (the
// load/run.mjs probe measured up to 1.7s), and ioredis measures commandTimeout
// from when a command is queued, not from the network round trip. A 250ms
// timeout is shorter than the event-loop lag alone, so almost every rate-limit
// and admission-gate check timed out and failed open — not because Redis was
// slow, but because Node was too busy to read Redis's (already-sitting-in-the-
// socket-buffer) reply in time. That let essentially everything through to the
// DB pool ungated, reproducing the exact collapse this feature exists to
// prevent (confirmed: 0 real SERVICE_BUSY responses in that run; ~58k/~86k
// admission-gate/rate-limit Redis calls failed open instead). 2000ms is well
// inside the DB pool's own 5s connectionTimeoutMillis, so a real Redis outage
// still fails open well before a client would notice, while tolerating the
// event-loop lag this app can actually produce under load.
//
// enableOfflineQueue=false: while the client is not connected (before the first
// connect at startup, or while reconnecting after an outage) every command is
// rejected immediately instead of being queued. Every caller fails open on a
// rejection, so during an outage requests go straight through without waiting
// out commandTimeout. It also stops a subtle leak: with the default queue, a
// command whose caller had already given up (commandTimeout fired, request
// failed open) stayed queued and was replayed against Redis on reconnect. A
// replayed admission-gate INCR added an in-flight count that nothing would ever
// decrement (found in the Step 9 Docker battery: the counter sat at baseline+1
// right after the Redis-outage test).
export const redis = new Redis(env.REDIS_URL, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  commandTimeout: 2000,
  retryStrategy(times) {
    return Math.min(times * 200, 2000);
  },
});

// An unhandled 'error' event on an ioredis client crashes the process (same
// hazard as the pg pool in src/db/pool.ts) — one listener, log and move on.
redis.on('error', (err) => {
  logger.warn({ err }, 'Redis connection error');
});

/**
 * Runs a Redis-backed check and returns its result, or `fallback` (logging a
 * warning) if Redis errors or times out. Every call site that treats Redis as
 * advisory goes through this instead of calling `redis` directly, so a Redis
 * outage can never throw or hang a request — it just behaves as if the cache
 * or counter weren't there.
 */
export async function withRedisFallback<T>(
  fn: () => Promise<T>,
  fallback: T,
  context: string
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err, context }, 'Redis operation failed; using fallback');
    return fallback;
  }
}
