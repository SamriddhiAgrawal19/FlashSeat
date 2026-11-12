/**
 * TRUST_PROXY and REFRESH_COOKIE_PATH (production behind Caddy, deploy/Caddyfile).
 *
 * The shared test API runs with the dev config, so these cases build their OWN copy
 * of the app in this process with a given environment (vi.resetModules + a dynamic
 * import, because src/config/env.ts parses process.env once at import time), listen
 * on an ephemeral port, and observe req.ip through the login-by-IP rate limiter's
 * Redis key `ratelimit:login-ip:<req.ip>`.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseTrustProxy } from '../src/config/trustProxy';
import { api, email } from './helpers';

const rnd = () => Math.random().toString(36).slice(2, 8);

interface LoadedApp {
  baseUrl: string;
  redis: typeof import('../src/redis/client').redis;
  close: () => Promise<void>;
}

const loaded: LoadedApp[] = [];

/** A fresh app (fresh env, pool, Redis client) with these env overrides, listening on 127.0.0.1:<random>. */
async function loadApp(overrides: Record<string, string>): Promise<LoadedApp> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  vi.resetModules();
  try {
    const { app } = await import('../src/app');
    const { pool } = await import('../src/db/pool');
    const { redis } = await import('../src/redis/client');
    // enableOfflineQueue=false: until 'ready', the limiter fails open and writes no key.
    if (redis.status !== 'ready') {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Redis not ready')), 5_000);
        redis.once('ready', () => { clearTimeout(t); resolve(); });
      });
    }
    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address() as AddressInfo;
    const handle: LoadedApp = {
      baseUrl: `http://127.0.0.1:${port}`,
      redis,
      close: async () => {
        await new Promise<void>((r) => server.close(() => r()));
        await pool.end();
        redis.disconnect();
      },
    };
    loaded.push(handle);
    return handle;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function failedLogin(baseUrl: string, xff?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (xff) headers['X-Forwarded-For'] = xff;
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: `xff_${Date.now()}_${rnd()}@test.flashseat`, password: 'wrong-password' }),
  });
  await res.text();
  return res.status;
}

// TEST-NET addresses (RFC 5737): never a real client.
const ipKey = (ip: string) => `ratelimit:login-ip:${ip}`;

let direct: LoadedApp; // dev/test default: TRUST_PROXY unset
let proxied: LoadedApp; // production behind Caddy

beforeAll(async () => {
  direct = await loadApp({ TRUST_PROXY: '', ENABLE_RATE_LIMITING: 'true' });
  proxied = await loadApp({
    NODE_ENV: 'production',
    ENABLE_MOCK_PAYMENT: 'false',
    TRUST_PROXY: '1',
    REFRESH_COOKIE_PATH: '/api/auth',
    ENABLE_RATE_LIMITING: 'true',
  });
});

afterAll(async () => {
  for (const h of loaded) {
    const keys = await h.redis.keys('ratelimit:login-*').catch(() => [] as string[]);
    // Only this file's keys: TEST-NET IPs, the loopback IP of these in-process servers, and our emails.
    const mine = keys.filter((k) => /198\.51\.100\.|203\.0\.113\.|127\.0\.0\.1|xff_/.test(k));
    if (mine.length) await h.redis.del(...mine).catch(() => {});
    await h.close();
  }
});

describe('parseTrustProxy', () => {
  it('maps TRUST_PROXY strings to Express trust-proxy values', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
    expect(parseTrustProxy('loopback, 172.16.0.0/12')).toBe('loopback, 172.16.0.0/12');
  });
});

describe('X-Forwarded-For and the IP rate limiter', () => {
  it('trust proxy OFF (default): a client-supplied X-Forwarded-For is ignored; the socket address is the key', async () => {
    const spoofed = '203.0.113.50';
    expect(await failedLogin(direct.baseUrl, spoofed)).toBe(401);
    expect(await direct.redis.exists(ipKey(spoofed))).toBe(0);
    expect(await direct.redis.exists(ipKey('127.0.0.1'))).toBe(1);
  });

  it('trust proxy = 1 (behind Caddy): the address the proxy appended is the key', async () => {
    const client = '198.51.100.23';
    expect(await failedLogin(proxied.baseUrl, client)).toBe(401);
    expect(await proxied.redis.exists(ipKey(client))).toBe(1);
  });

  it('trust proxy = 1: only the right-most hop counts, so a forged left-hand entry cannot pick the key', async () => {
    const forged = '203.0.113.99';
    const real = '198.51.100.24';
    expect(await failedLogin(proxied.baseUrl, `${forged}, ${real}`)).toBe(401);
    expect(await proxied.redis.exists(ipKey(real))).toBe(1);
    expect(await proxied.redis.exists(ipKey(forged))).toBe(0);
  });
});

describe('refresh cookie', () => {
  const cookieOf = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith('refreshToken=')) ?? '';

  it('production: Path=/api/auth, Secure, HttpOnly, SameSite=Strict', async () => {
    const res = await fetch(`${proxied.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.30' },
      body: JSON.stringify({ name: 'Cookie Prod', email: `xff_cookie_${Date.now()}_${rnd()}@test.flashseat`, password: 'password123' }),
    });
    expect(res.status).toBe(201);
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/;\s*Path=\/api\/auth(;|$)/);
    expect(cookie).toMatch(/;\s*Secure(;|$)/);
    expect(cookie).toMatch(/;\s*HttpOnly(;|$)/);
    expect(cookie).toMatch(/;\s*SameSite=Strict(;|$)/);
  });

  it('dev/test default (the shared API): Path=/auth and not Secure', async () => {
    const r = await api('POST', '/auth/register', {
      body: { name: 'Cookie Dev', email: email('cookie-dev'), password: 'password123' },
    });
    expect(r.status).toBe(201);
    const cookie = r.setCookies.find((c: string) => c.startsWith('refreshToken=')) ?? '';
    expect(cookie).toMatch(/;\s*Path=\/auth(;|$)/);
    expect(cookie).not.toMatch(/Secure/);
  });
});
