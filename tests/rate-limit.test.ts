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
import { api, email, hold, register, setupShow, sleep } from './helpers';
import { env } from '../src/config/env';
import { redis } from '../src/redis/client';

const rnd = () => Math.random().toString(36).slice(2, 8);
const ADMISSION_KEY = 'admission:inflight:booking';

beforeEach(async () => {
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
    try {
      await sleep(500); // give ioredis a moment to notice the dropped connection
      const s = await setupShow('rlfailopen', 1); // exercises register (rate limiter) + GET seats (cache)
      const h = await hold(s.user, s.showId, `rlfo-${rnd()}`, [s.seatIds[0]]); // rate limiter + admission gate
      expect(h.status).toBe(201);
    } finally {
      execSync('docker compose start redis', { stdio: 'ignore' });
      await waitForRedisHealthy();
    }
  }, 60_000);
});

describe('admission control', () => {
  it('requests beyond MAX_INFLIGHT_BOOKING_REQUESTS get 503 SERVICE_BUSY; the counter settles back to baseline after the burst', async () => {
    // The server's MAX_INFLIGHT_BOOKING_REQUESTS is fixed at process start, so
    // instead of overriding it, the shared Redis counter is seeded to sit just
    // `headroom` below the real configured limit — equivalent to "the limit is
    // low" from this burst's point of view, without restarting the server.
    const headroom = 3;
    const overBy = 5;
    const total = headroom + overBy; // stays well under RATE_LIMIT_RESERVATION_USER_LIMIT too
    const baseline = env.MAX_INFLIGHT_BOOKING_REQUESTS - headroom;
    await redis.set(ADMISSION_KEY, baseline);

    const s = await setupShow('rladmission', total);
    const results = await Promise.all(
      Array.from({ length: total }, (_, i) =>
        hold(s.user, s.showId, `rladm-${i}-${rnd()}`, [s.seatIds[i]])
      )
    );

    const admitted = results.filter((r) => r.status !== 503);
    const busy = results.filter((r) => r.status === 503);
    expect(admitted).toHaveLength(headroom);
    expect(busy).toHaveLength(overBy);
    for (const r of busy) {
      expect(r.data.error.code).toBe('SERVICE_BUSY');
      expect(Number(r.retryAfter)).toBeGreaterThan(0);
    }

    // The gate's DECR is fire-and-forget (sent on 'finish' / on rejection, not
    // awaited before the response goes out), so the client can see its
    // response before the server's DECR reaches Redis — a single immediate
    // read was observed at baseline + 1 (1 of 3 full-battery runs). Poll
    // briefly instead: a real leak never settles and still fails here.
    const deadline = Date.now() + 2_000;
    let final = Number(await redis.get(ADMISSION_KEY));
    while (final !== baseline && Date.now() < deadline) {
      await sleep(25);
      final = Number(await redis.get(ADMISSION_KEY));
    }
    expect(final).toBe(baseline);

    await redis.del(ADMISSION_KEY);
  });
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
