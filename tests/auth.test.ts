/**
 * Auth suite — ports scripts/verify-batch3.mjs (H-4, M-3, L-1, L-3, L-4) plus
 * explicit strict-reuse containment tests. Asserts error.code, never message text.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  api, cookieHeader, db, deactivateUser, email, expireRefreshToken, hasErrorShape, liveRefreshTokens,
  makeToken, register, refreshCookie, tokenHash, validPayload,
} from './helpers';
import { redis } from '../src/redis/client';

describe('H-4: refresh rotation and theft containment (strict mode)', () => {
  it('A: 10 parallel refreshes with one cookie => exactly one 200, nine 401, zero 5xx', async () => {
    const u = await register('authA');
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) }))
    );
    const ok = responses.filter((r) => r.status === 200);
    const rejected = responses.filter((r) => r.status === 401);
    const others = responses.filter((r) => r.status !== 200 && r.status !== 401);

    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    for (const r of rejected) expect(r.data?.error?.code).toBe('INVALID_REFRESH_TOKEN');
    expect(others).toHaveLength(0);
  });

  it('A: strict reuse detection also revokes the winner\'s fresh token', async () => {
    const u = await register('authA2');
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) }))
    );
    const winner = responses.find((r) => r.status === 200)!;
    const newCookie = refreshCookie(winner.setCookies)!;
    expect(newCookie.value).not.toBe(u.cookie.value);

    // the nine losers saw a revoked token and revoked the user's whole set,
    // including this brand-new token
    const after = await api('POST', '/auth/refresh', { cookie: cookieHeader(newCookie) });
    expect(after.status).toBe(401);
    expect(after.data?.error?.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('B: stolen-cookie reuse kills old AND new tokens; zero live rows in DB', async () => {
    const u = await register('authB');
    const attacker = await api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) }); // C1 -> C2
    expect(attacker.status).toBe(200);
    const c2 = refreshCookie(attacker.setCookies)!;

    const victim = await api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) }); // C1 again = reuse
    expect(victim.status).toBe(401);
    expect(victim.data?.error?.code).toBe('INVALID_REFRESH_TOKEN');

    const after = await api('POST', '/auth/refresh', { cookie: cookieHeader(c2) });
    expect(after.status).toBe(401);
    expect(after.data?.error?.code).toBe('INVALID_REFRESH_TOKEN');

    expect(await liveRefreshTokens(u.id)).toEqual([{ count: '0' }]);
  });
});

describe('M-3: DB clock', () => {
  it('C1: expiring one token is NOT theft — the user\'s other token keeps working', async () => {
    const u = await register('authC1');
    const second = await api('POST', '/auth/login', { body: u.body });
    expect(second.status).toBe(200);
    const cookieB = refreshCookie(second.setCookies)!;

    await expireRefreshToken(u.cookie.value);

    const dead = await api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) });
    expect(dead.status).toBe(401);
    expect(dead.data?.error?.code).toBe('INVALID_REFRESH_TOKEN');

    const live = await api('POST', '/auth/refresh', { cookie: cookieHeader(cookieB) });
    expect(live.status).toBe(200);
  });

  it('C2: refresh expiry window is built by the DB clock (N days +/- 2s)', async () => {
    const u = await register('authC2');
    const [row] = await db<{ seconds: string }>(
      `SELECT extract(epoch FROM (expires_at - created_at)) AS seconds
         FROM refresh_tokens WHERE token_hash = $1`,
      [tokenHash(u.cookie.value)]
    );
    const days = Number(process.env.REFRESH_TOKEN_EXPIRY_DAYS || 7);
    expect(Math.abs(Number(row.seconds) - days * 86400)).toBeLessThanOrEqual(2);
  });

  it('C3: no JS-clock expiry/"is it still valid" decisions in auth/show-seats/bookings', () => {
    const root = join(__dirname, '..');
    const allowed = [/\.toISOString\(/, /maxAge/i, /logger\.|console\.|pino/i];
    const violations: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) {
          readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
            if (/Date\.now\(|new Date\(/.test(line) && !allowed.some((re) => re.test(line))) {
              violations.push(`${p}:${i + 1}: ${line.trim()}`);
            }
          });
        }
      }
    };
    ['src/modules/auth', 'src/modules/show-seats', 'src/modules/bookings'].forEach((d) => walk(join(root, d)));
    expect(violations).toEqual([]);
  });
});

describe('L-1: one error shape { error: { message, code } }', () => {
  const cases: Array<[string, () => Promise<any>, number, string]> = [
    ['missing Authorization header', () => api('GET', '/bookings/mine'), 401, 'UNAUTHORIZED'],
    ['garbage bearer token', () => api('GET', '/bookings/mine', { token: 'garbage' }), 401, 'INVALID_TOKEN'],
    ['expired access token', async () => api('GET', '/bookings/mine', {
      token: makeToken({ alg: 'HS256', typ: 'JWT' }, validPayload({ exp: Math.floor(Date.now() / 1000) - 60 })),
    }), 401, 'TOKEN_EXPIRED'],
    ['wrong password', async () => {
      const u = await register('authD1');
      return api('POST', '/auth/login', { body: { email: u.body.email, password: 'wrong' } });
    }, 401, 'INVALID_CREDENTIALS'],
    ['unknown email', () => api('POST', '/auth/login', { body: { email: email('ghost'), password: 'Passw0rd!123' } }), 401, 'INVALID_CREDENTIALS'],
    ['duplicate email', async () => {
      const u = await register('authD2');
      return api('POST', '/auth/register', { body: u.body });
    }, 409, 'EMAIL_TAKEN'],
    ['refresh without cookie', () => api('POST', '/auth/refresh'), 401, 'UNAUTHORIZED'],
    ['refresh with garbage cookie', () => api('POST', '/auth/refresh', { cookie: 'refreshToken=garbage' }), 401, 'INVALID_REFRESH_TOKEN'],
    ['register validation error', () => api('POST', '/auth/register', {
      body: { name: 'X', email: email('badpw'), password: 'short', role: 'ATTENDEE' },
    }), 400, 'VALIDATION_ERROR'],
    ['attendee on organizer route', async () => {
      const u = await register('authD3');
      return api('POST', '/venues', { token: u.token, body: { name: 'V', address: 'A', city: 'C' } });
    }, 403, 'FORBIDDEN'],
  ];

  for (const [label, run, status, code] of cases) {
    it(`${label} => ${status} ${code} with error shape`, async () => {
      const r = await run();
      expect(r.status).toBe(status);
      expect(hasErrorShape(r.data)).toBe(true);
      expect(r.data.error.code).toBe(code);
    });
  }
});

describe('L-3: login hardening', () => {
  it('E: failed logins do not leak email existence (timing; can be noisy)', async () => {
    // With ENABLE_RATE_LIMITING on, the login limits (per IP, per email) would
    // turn some of these ~53 attempts into 429s. The login rate-limit counters are
    // reset before every call, outside the timed window: the limiter still runs
    // on every request (same work in both groups), but no sample can become a
    // 429. This replaces pacing with 61 s sleeps per batch, which depended on the
    // host clock and the Redis container's clock agreeing within a second, and
    // once let a 429 through.
    const resetLoginLimits = async () => {
      const keys = await redis.keys('ratelimit:login-*');
      if (keys.length) await redis.del(...keys);
    };

    // Warm up argon2/JIT/connections once, off throwaway emails, before timing.
    for (let i = 0; i < 3; i++) {
      await resetLoginLimits();
      await api('POST', '/auth/login', { body: { email: email('warmup'), password: 'warmup' } });
    }

    const time = async (body: Record<string, unknown>) => {
      await resetLoginLimits();
      const t0 = process.hrtime.bigint();
      const r = await api('POST', '/auth/login', { body });
      expect(r.status).toBe(401);
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };

    // Both groups must be measured under the same conditions. Timing every
    // existing-email login right after that user's register, and all unknown-email
    // logins afterwards, made the existing group slower whether or not the email
    // existed (an unknown email timed right after a register was just as slow).
    // So: register every user first, then alternate existing/unknown samples,
    // swapping which goes first on each pair.
    const users: string[] = [];
    for (let i = 0; i < 25; i++) users.push((await register(`authE${i}`)).body.email as string);
    const existing: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 25; i++) {
      const sampleExisting = async () => existing.push(await time({ email: users[i], password: 'wrong' }));
      const sampleUnknown = async () => unknown.push(await time({ email: email('ghost2'), password: 'Passw0rd!123' }));
      if (i % 2 === 0) { await sampleExisting(); await sampleUnknown(); }
      else { await sampleUnknown(); await sampleExisting(); }
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    console.log(`L-3 E median existing-email: ${median(existing).toFixed(1)} ms | median unknown-email: ${median(unknown).toFixed(1)} ms`);
    const ratio = Math.min(median(existing), median(unknown)) / Math.max(median(existing), median(unknown));
    expect(ratio).toBeGreaterThanOrEqual(0.6);
  }, 120_000);

  it('F: deactivated user gets the same 401 as a wrong password; refresh dies', async () => {
    const u = await register('authF');
    const wrong = await api('POST', '/auth/login', { body: { email: u.body.email, password: 'nope' } });

    await deactivateUser(u.id);

    const login = await api('POST', '/auth/login', { body: u.body });
    expect(login.status).toBe(401);
    expect(login.data?.error?.code).toBe('INVALID_CREDENTIALS');
    expect(login.data).toEqual(wrong.data); // identical body: no oracle

    const refresh = await api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) });
    expect(refresh.status).toBe(401);
    expect(refresh.data?.error?.code).toBe('INVALID_REFRESH_TOKEN');

    // documented: requireAuth stays stateless, so the already-issued access
    // token remains valid until it expires (at most JWT_ACCESS_EXPIRY)
    const stillValid = await api('GET', '/bookings/mine', { token: u.token });
    expect(stillValid.status).toBe(200);
  });
});

describe('L-4: JWT hardening', () => {
  const forged: Array<[string, string]> = [
    ['alg:none', `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(validPayload())).toString('base64url')}.`],
    ['HS512', makeToken({ alg: 'HS512', typ: 'JWT' }, validPayload())],
    ['role SUPERUSER', makeToken({ alg: 'HS256', typ: 'JWT' }, validPayload({ role: 'SUPERUSER' }))],
    ['non-uuid userId', makeToken({ alg: 'HS256', typ: 'JWT' }, validPayload({ userId: 'not-a-uuid' }))],
  ];

  for (const [label, token] of forged) {
    it(`G: ${label} token => 401 INVALID_TOKEN`, async () => {
      const r = await api('GET', '/bookings/mine', { token });
      expect(r.status).toBe(401);
      expect(r.data?.error?.code).toBe('INVALID_TOKEN');
    });
  }
});

describe('H: happy path and cookie lifecycle', () => {
  it('register -> use -> rotate -> logout, cookie cleared with the same options', async () => {
    const u = await register('authH');
    expect(String(u.cookie.attrs.path ?? '').toLowerCase()).toBe('/auth');

    expect((await api('GET', '/bookings/mine', { token: u.token })).status).toBe(200);

    const rot = await api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) });
    expect(rot.status).toBe(200);
    const c2 = refreshCookie(rot.setCookies)!;
    expect(c2.value).not.toBe(u.cookie.value);

    const old = await api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) });
    expect(old.status).toBe(401);
    expect(old.data?.error?.code).toBe('INVALID_REFRESH_TOKEN');

    const expectCleared = (r: typeof rot) => {
      const cc = refreshCookie(r.setCookies);
      expect(cc?.value).toBe('');
      expect(String(cc?.attrs.path ?? '').toLowerCase()).toBe(String(u.cookie.attrs.path ?? '').toLowerCase());
      expect(Boolean(cc?.attrs.httponly)).toBe(Boolean(u.cookie.attrs.httponly));
      expect(String(cc?.attrs.samesite ?? '').toLowerCase()).toBe(String(u.cookie.attrs.samesite ?? '').toLowerCase());
    };

    const failed = await api('POST', '/auth/refresh', { cookie: cookieHeader(c2) });
    expect(failed.status).toBe(401);
    expectCleared(failed);

    const logout = await api('POST', '/auth/logout', { cookie: cookieHeader(c2) });
    expect(logout.status).toBe(200);
    expectCleared(logout);

    const after = await api('POST', '/auth/refresh', { cookie: cookieHeader(c2) });
    expect(after.status).toBe(401);
    expect(after.data?.error?.code).toBe('INVALID_REFRESH_TOKEN');
  });
});
