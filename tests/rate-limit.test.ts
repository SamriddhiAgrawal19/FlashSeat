/**
 * Redis rate limiting / admission control / seat-map cache (Phase 2, Step 8).
 *
 * This file must run with ENABLE_RATE_LIMITING=true and ENABLE_SEAT_MAP_CACHE=true
 * on the server under test (`npm run test:rate-limit`, see package.json). The whole
 * regression battery (`npm test`) now runs with both ON too — their defaults and the
 * local .env — and passed 79/79 that way (2026-10-30). Two kinds of pre-existing
 * test had to be adapted to real enforcement against a shared test server/IP:
 *   - auth.test.ts's L-3 case E fires many failed logins against one email (to
 *     measure a timing oracle) — exactly the pattern login-by-email rate limiting
 *     exists to stop — so it paces itself to stay under the login limits.
 *   - Several tests (e.g. concurrency.test.ts's confirm-mock races) read the seat
 *     map right after a mutation; they account for the cache's documented
 *     staleness window (see show-seats.controller.ts).
 * The suite also registers ~300 users from one IP, which is why the local .env
 * raises RATE_LIMIT_REGISTER_IP_LIMIT to 400 (production default: 30/60s).
 * See src/config/env.ts for the ENABLE_RATE_LIMITING / ENABLE_SEAT_MAP_CACHE flags.
 *
 * Every test clears the relevant Redis keys first (`beforeEach`) so none of these
 * depend on execution order or leak into each other.
 */
import { execSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, db, email, hold, holdRowLock, register, setupShow, sleep } from './helpers';
import { env } from '../src/config/env';
import { redis } from '../src/redis/client';

const rnd = () => Math.random().toString(36).slice(2, 8);
const ADMISSION_KEY = 'admission:inflight:booking:set';

beforeEach(async () => {
  // The client fails commands fast while disconnected (enableOfflineQueue=false),
  // and the Redis-outage test below restarts Redis: wait for it to be back.
  await redisReady();
  const keys = await redis.keys('ratelimit:*');
  if (keys.length) await redis.del(...keys);
  await redis.del(ADMISSION_KEY);
});

describe('rate limiting', () => {
  it('login-by-IP: exceeding the limit returns 429 RATE_LIMITED with Retry-After, and succeeds again after the window', async () => {
    const limit = env.RATE_LIMIT_LOGIN_IP_LIMIT;
    const windowSeconds = env.RATE_LIMIT_LOGIN_IP_WINDOW_SECONDS;
    // A distinct unknown email per call keeps every one of these under the
    // (lower) login-by-email limit, isolating the IP limiter.
    const attempt = (tag: string) =>
      api('POST', '/auth/login', { body: { email: email(tag), password: 'wrong-password' } });

    for (let i = 0; i < limit; i++) {
      const r = await attempt(`rlip${i}`);
      expect(r.status, `attempt ${i} (under the limit)`).toBe(401);
    }

    const blocked = await attempt('rlip-blocked');
    expect(blocked.status).toBe(429);
    expect(blocked.data.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.retryAfter)).toBeGreaterThan(0);
    expect(Number(blocked.retryAfter)).toBeLessThanOrEqual(windowSeconds);

    await sleep((windowSeconds + 1) * 1000);

    const after = await attempt('rlip-after-window');
    expect(after.status).toBe(401);
  }, 90_000);

  it('login-by-email: exceeding the limit for one email returns 429, even while the shared IP is still under its own (higher) limit', async () => {
    const limit = env.RATE_LIMIT_LOGIN_EMAIL_LIMIT;
    expect(limit).toBeLessThan(env.RATE_LIMIT_LOGIN_IP_LIMIT); // precondition for this test to isolate the email limiter
    const targetEmail = email('rlemail');

    for (let i = 0; i < limit; i++) {
      const r = await api('POST', '/auth/login', { body: { email: targetEmail, password: `wrong-${i}` } });
      expect(r.status, `attempt ${i} (under the limit)`).toBe(401);
    }

    const blocked = await api('POST', '/auth/login', { body: { email: targetEmail, password: 'wrong-final' } });
    expect(blocked.status).toBe(429);
    expect(blocked.data.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.retryAfter)).toBeGreaterThan(0);

    // A different email from the same IP is unaffected: this really is keyed on the
    // targeted account, not (just) the source.
    const other = await api('POST', '/auth/login', { body: { email: email('rlemail-other'), password: 'wrong' } });
    expect(other.status).toBe(401);
  });

  it('register rate limiting by IP', async () => {
    const limit = env.RATE_LIMIT_REGISTER_IP_LIMIT;
    const windowSeconds = env.RATE_LIMIT_REGISTER_IP_WINDOW_SECONDS;

    // Registering `limit` users for real doesn't work against a loosened local
    // limit: at ~4.5 argon2 registrations/s, 400 of them take ~90s, longer than
    // the 60s fixed window, so the window resets mid-loop and the "blocked"
    // call lands in a fresh window (201). Instead, one real registration
    // creates this IP's counter (whatever form req.ip takes), then the counter
    // is seeded to exactly the limit with its TTL kept, the same technique as
    // the admission-control test below.
    await register(`rlreg${rnd()}`); // throws (failing the test) on anything but 201
    const keys = await redis.keys('ratelimit:register-ip:*');
    expect(keys).toHaveLength(1);
    await redis.set(keys[0], limit, 'KEEPTTL');

    const blocked = await api('POST', '/auth/register', {
      body: { name: 'blocked', email: email('rlreg-blocked'), password: 'Passw0rd!123', role: 'ATTENDEE' },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.data.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.retryAfter)).toBeGreaterThan(0);
    expect(Number(blocked.retryAfter)).toBeLessThanOrEqual(windowSeconds);
  });

  it('reservation creation rate limiting for one authenticated user', async () => {
    const limit = env.RATE_LIMIT_RESERVATION_USER_LIMIT;
    const s = await setupShow('rluser', 1);

    for (let i = 0; i < limit; i++) {
      // The seat is already held after the first call; 409 ACTIVE_RESERVATION_EXISTS
      // on the rest still counts against the limit, which is all this test needs.
      const r = await hold(s.user, s.showId, `rluser-${i}-${rnd()}`, [s.seatIds[0]]);
      expect(r.status, `attempt ${i} (under the limit)`).toBeLessThan(429);
    }

    const blocked = await hold(s.user, s.showId, `rluser-blocked-${rnd()}`, [s.seatIds[0]]);
    expect(blocked.status).toBe(429);
    expect(blocked.data.error.code).toBe('RATE_LIMITED');
  });

  it('Redis unavailable: requests still succeed (fail-open), not blocked', async () => {
    execSync('docker compose stop redis', { stdio: 'ignore' });
    let probeShowId: string | undefined;
    try {
      await sleep(500); // give ioredis a moment to notice the dropped connection
      const s = await setupShow('rlfailopen', 1); // exercises register (rate limiter) + GET seats (cache)
      probeShowId = s.showId;
      const h = await hold(s.user, s.showId, `rlfo-${rnd()}`, [s.seatIds[0]]); // rate limiter + admission gate
      expect(h.status).toBe(201);
    } finally {
      execSync('docker compose start redis', { stdio: 'ignore' });
      await waitForRedisHealthy();
      // Redis answering is not enough: the API's own client reconnects on its
      // retry schedule (slower in Docker, where a stopped container's hostname
      // stops resolving). Until it does, the gate fails open, which would make
      // the admission tests that follow see unrelated admissions.
      if (probeShowId) await waitForApiRedis(probeShowId);
    }
  }, 60_000);
});

describe('admission control', () => {
  it('requests beyond MAX_INFLIGHT_BOOKING_REQUESTS get 503 SERVICE_BUSY; the counter settles back to baseline after the burst', async () => {
    // The server's MAX_INFLIGHT_BOOKING_REQUESTS is fixed at process start, so
    // instead of overriding it, the shared in-flight set is seeded with
    // `baseline` members, `headroom` below the real configured limit —
    // equivalent to "the limit is low" from this burst's point of view, without
    // restarting the server.
    const headroom = 3;
    const overBy = 5;
    const total = headroom + overBy; // stays well under RATE_LIMIT_RESERVATION_USER_LIMIT too
    const baseline = env.MAX_INFLIGHT_BOOKING_REQUESTS - headroom;

    const s = await setupShow('rladmission', total);

    // Keep every admitted hold in flight until the whole burst has reached the
    // gate. Without this, an admitted hold (most return a fast 409: one user)
    // could finish and free its slot before a straggler arrives, letting that
    // straggler in too — seen as 4 admitted instead of 3 against the Docker
    // stack, where port forwarding spreads arrivals out. createReservation takes
    // FOR SHARE on the show row before any other lock, so a FOR UPDATE blocker
    // on it parks every admitted request there. They wait up to the API's
    // lock_timeout (DB_LOCK_TIMEOUT_MS) and then get 409 LOCK_TIMEOUT — still
    // "admitted" below — so the blocker outlasts lock_timeout to make that the
    // outcome for all of them. Rejected requests never touch the DB.
    const blockerSeconds = Math.ceil(env.DB_LOCK_TIMEOUT_MS / 1000) + 2;
    const blocker = holdRowLock(`SELECT id FROM shows WHERE id = '${s.showId}' FOR UPDATE`, blockerSeconds);
    // Start the burst only once the blocker is sleeping, i.e. its lock is held.
    const lockDeadline = Date.now() + 5_000;
    while (
      (await db(
        `SELECT 1 FROM pg_stat_activity WHERE wait_event = 'PgSleep' AND query LIKE '%' || $1 || '%FOR UPDATE%'`,
        [s.showId]
      )).length === 0
    ) {
      if (Date.now() > lockDeadline) throw new Error('row-lock blocker did not start in time');
      await sleep(25);
    }

    // Seeded last: members age out INFLIGHT_SAFETY_TTL_SECONDS after they are
    // added, so the clock starts only once everything else is in place.
    await seedInflight(baseline, 'baseline');

    const results = await Promise.all(
      Array.from({ length: total }, (_, i) =>
        hold(s.user, s.showId, `rladm-${i}-${rnd()}`, [s.seatIds[i]])
      )
    );
    await blocker.done;

    const admitted = results.filter((r) => r.status !== 503);
    const busy = results.filter((r) => r.status === 503);
    expect(admitted).toHaveLength(headroom);
    expect(busy).toHaveLength(overBy);
    for (const r of busy) {
      expect(r.data.error.code).toBe('SERVICE_BUSY');
      expect(Number(r.retryAfter)).toBeGreaterThan(0);
    }

    // The gate's release (ZREM) is fire-and-forget (sent on 'finish', not
    // awaited before the response goes out), so the client can see its
    // response before the server's ZREM reaches Redis. Poll briefly instead: a
    // real leak never settles and still fails here.
    const deadline = Date.now() + 2_000;
    let final = await redis.zcard(ADMISSION_KEY);
    while (final !== baseline && Date.now() < deadline) {
      await sleep(25);
      final = await redis.zcard(ADMISSION_KEY);
    }
    expect(final).toBe(baseline);

    await redis.del(ADMISSION_KEY);
  });

  it('a lost release (entry added, never removed) frees its slot after INFLIGHT_SAFETY_TTL_SECONDS, even while requests keep arriving', async () => {
    // Regression for the leak found in the Step 9 Docker battery. With the old
    // INCR/DECR counter, an increment whose release never ran (the request had
    // failed open) stayed counted for as long as traffic kept refreshing the
    // key's TTL, i.e. indefinitely under load. Here the gate is filled entirely
    // with members that are never released, and requests keep arriving about
    // once a second (well under RATE_LIMIT_RESERVATION_USER_LIMIT for the whole
    // test). Every one is turned away until the lost entries age out, then the
    // gate admits again on its own.
    const ttlMs = env.INFLIGHT_SAFETY_TTL_SECONDS * 1000;
    expect(Math.ceil(ttlMs / 1000) + 3).toBeLessThan(env.RATE_LIMIT_RESERVATION_USER_LIMIT); // precondition: traffic below stays under the per-user limit
    const s = await setupShow('rlleak', 1);
    const attempt = () => hold(s.user, s.showId, `rlleak-${rnd()}`, [s.seatIds[0]]);

    await seedInflight(env.MAX_INFLIGHT_BOOKING_REQUESTS, 'lost');
    const seededAt = Date.now();
    const elapsed = () => Date.now() - seededAt;

    // Well inside the TTL: the gate is full of lost entries, so every request is busy.
    while (elapsed() < ttlMs - 1_000) {
      const r = await attempt();
      expect(r.status, `request at +${elapsed()}ms`).toBe(503);
      expect(r.data.error.code).toBe('SERVICE_BUSY');
      await sleep(1_000);
    }
    // Keep traffic coming across the expiry point (outcome around it not asserted).
    while (elapsed() < ttlMs + 1_000) {
      await attempt();
      await sleep(1_000);
    }

    // Past the TTL: the lost entries are gone, so this one is admitted.
    const after = await attempt();
    expect(after.status).not.toBe(503);
    const leftovers = (await redis.zrange(ADMISSION_KEY, '0', '-1')).filter((m) => m.startsWith('lost-'));
    expect(leftovers).toEqual([]);

    await redis.del(ADMISSION_KEY);
  }, 60_000);
});

describe('seat map cache', () => {
  it('MISS, then HIT with identical data within the TTL, MISS again after expiry; a hold made in between is not reflected until the cache expires', async () => {
    const s = await setupShow('rlcache', 2);
    await redis.del(`seatmap:${s.showId}`); // setupShow's own GET may have just warmed it

    const miss1 = await api('GET', `/shows/${s.showId}/seats`);
    expect(miss1.xCache).toBe('MISS');

    const hit1 = await api('GET', `/shows/${s.showId}/seats`);
    expect(hit1.xCache).toBe('HIT');
    expect(hit1.data).toEqual(miss1.data);

    const h = await hold(s.user, s.showId, `rlcache-${rnd()}`, [s.seatIds[0]]);
    expect(h.status).toBe(201);

    const staleHit = await api('GET', `/shows/${s.showId}/seats`);
    expect(staleHit.xCache).toBe('HIT');
    expect(staleHit.data).toEqual(miss1.data); // documents the staleness window, not a bug

    await sleep(env.SEAT_MAP_CACHE_TTL_MS + 250);

    const miss2 = await api('GET', `/shows/${s.showId}/seats`);
    expect(miss2.xCache).toBe('MISS');
    const seats = miss2.data.sections.flatMap((x: any) => x.rows.flatMap((y: any) => y.seats));
    expect(seats.find((z: any) => z.id === s.seatIds[0]).status).toBe('HELD');
  });
});

/** Redis server time in ms: the gate scores members by it, so seeded members must be too. */
async function redisNowMs(): Promise<number> {
  const [sec, usec] = await redis.time();
  return Number(sec) * 1000 + Math.floor(Number(usec) / 1000);
}

/** Adds `n` members the gate counts as in flight and that nothing will ever release. */
async function seedInflight(n: number, tag: string): Promise<void> {
  const now = await redisNowMs();
  const args: (string | number)[] = [];
  for (let i = 0; i < n; i++) args.push(now, `${tag}-${i}`);
  await redis.zadd(ADMISSION_KEY, ...args);
}

/** Waits until this test process's own Redis client is connected. */
function redisReady(timeoutMs = 15_000): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('test Redis client did not become ready in time')), timeoutMs);
    redis.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Waits until the API's Redis client is connected again, observed from outside:
 * the seat map is only ever served from cache (X-Cache: HIT) if the API could
 * both write and read Redis.
 */
async function waitForApiRedis(showId: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await api('GET', `/shows/${showId}/seats`);
    const second = await api('GET', `/shows/${showId}/seats`);
    if (second.xCache === 'HIT') return;
    await sleep(300);
  }
  throw new Error("API's Redis connection did not come back in time");
}

function waitForRedisHealthy(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<void> => {
    try {
      execSync('docker compose exec -T redis redis-cli ping', { stdio: 'ignore' });
      return;
    } catch {
      if (Date.now() > deadline) throw new Error('Redis did not become healthy again in time');
      await sleep(300);
      return poll();
    }
  };
  return poll();
}
