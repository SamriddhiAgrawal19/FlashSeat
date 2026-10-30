#!/usr/bin/env node
/**
 * FlashSeat — Batch 3 regression script (auth hardening).
 *
 * Reproduces / verifies: H-4 (rotation race / theft containment), M-3 (DB clock),
 * L-1 (one error shape), L-3 (timing oracle + is_active), L-4 (JWT hardening).
 * See docs/review/phase2-review.md.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 node scripts/verify-batch3.mjs [scenarioIds...]
 *
 * DB access goes through psql in the compose container (DOCKER_BIN overrides the
 * docker binary). The refresh cookie is read from the Set-Cookie response header
 * and sent back with a Cookie header.
 */

import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';
const PSQL_ARGS = ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'flashseat', '-d', 'flashseat'];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const envFile = readFileSync(join(ROOT, '.env'), 'utf8');
const JWT_ACCESS_SECRET = envFile.match(/^JWT_ACCESS_SECRET=(.*)$/m)?.[1]?.trim() ?? '';
const REFRESH_TOKEN_EXPIRY_DAYS = Number(envFile.match(/^REFRESH_TOKEN_EXPIRY_DAYS=(.*)$/m)?.[1]?.trim() ?? '7');
const RATE_LIMIT_LOGIN_IP_LIMIT = Number(envFile.match(/^RATE_LIMIT_LOGIN_IP_LIMIT=(.*)$/m)?.[1]?.trim() ?? '10');
const RATE_LIMIT_LOGIN_IP_WINDOW_SECONDS = Number(
  envFile.match(/^RATE_LIMIT_LOGIN_IP_WINDOW_SECONDS=(.*)$/m)?.[1]?.trim() ?? '60'
);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rnd = () => Math.random().toString(36).slice(2, 8);
const email = (tag) => `${tag}_${Date.now()}_${rnd()}@verify.test`;

function psql(sql) {
  return execFileSync(DOCKER_BIN, [...PSQL_ARGS, '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
}

function redisDelPattern(pattern) {
  const keys = execFileSync(
    DOCKER_BIN, ['compose', 'exec', '-T', 'redis', 'redis-cli', 'KEYS', pattern], { encoding: 'utf8' }
  ).split('\n').map((l) => l.trim()).filter(Boolean);
  for (const k of keys) execFileSync(DOCKER_BIN, ['compose', 'exec', '-T', 'redis', 'redis-cli', 'DEL', k]);
}

async function api(method, path, { token, body, cookie, key } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (cookie) headers['Cookie'] = cookie;
  if (key) headers['Idempotency-Key'] = key;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const bodyText = await res.text();
  let data = null;
  try { data = JSON.parse(bodyText); } catch { /* non-JSON */ }
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return { status: res.status, data, bodyText, setCookies };
}

/** Parses a Set-Cookie line into {name, value, attrs} (attrs are the raw pairs). */
function parseSetCookie(line) {
  const parts = line.split(';').map((p) => p.trim());
  const eq = parts[0].indexOf('=');
  const attrs = {};
  for (const p of parts.slice(1)) {
    const i = p.indexOf('=');
    if (i === -1) attrs[p.toLowerCase()] = true;
    else attrs[p.slice(0, i).toLowerCase()] = p.slice(i + 1);
  }
  return { name: parts[0].slice(0, eq), value: parts[0].slice(eq + 1), attrs };
}

/** The refresh cookie, taken from whatever Set-Cookie the server sent. */
function refreshCookie(setCookies) {
  for (const line of setCookies) {
    const c = parseSetCookie(line);
    if (/refresh/i.test(c.name)) return c;
  }
  return null;
}

const cookieHeader = (c) => `${c.name}=${c.value}`;
const tokenHash = (raw) => createHash('sha256').update(raw).digest('hex');

const b64url = (s) => Buffer.from(s).toString('base64url');

/** Hand-rolled JWT so tests do not depend on the library under test. */
function makeToken(header, payload, secret = JWT_ACCESS_SECRET) {
  const head = b64url(JSON.stringify(header));
  const pay = b64url(JSON.stringify(payload));
  const sig = createHmac(`sha${header.alg === 'HS512' ? '512' : '256'}`, secret)
    .update(`${head}.${pay}`)
    .digest('base64url');
  return `${head}.${pay}.${sig}`;
}

const validPayload = (over = {}) => ({
  userId: '11111111-2222-4333-8444-555555555555',
  role: 'ATTENDEE',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 900,
  ...over,
});

async function register(tag, { role = 'ATTENDEE', password = 'Passw0rd!123' } = {}) {
  const body = { name: tag, email: email(tag), password, role };
  if (role === 'ORGANIZER') body.organization_name = `${tag} Org`;
  const res = await api('POST', '/auth/register', { body });
  if (res.status !== 201) throw new Error(`register ${tag} failed: ${res.status} ${res.bodyText}`);
  return { id: res.data.user.id, token: res.data.accessToken, cookie: refreshCookie(res.setCookies), body };
}

// shape check used by scenario D: { error: { message: string, code: string, details? } }
function hasErrorShape(data) {
  return (
    data !== null &&
    typeof data.error === 'object' &&
    typeof data.error.message === 'string' &&
    typeof data.error.code === 'string'
  );
}

// ---------------------------------------------------------------------------
// scenario plumbing
// ---------------------------------------------------------------------------

const results = [];

function makeChecks(failures) {
  return {
    expect(label, cond, detail = '') {
      if (!cond) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
      return !!cond;
    },
  };
}

async function runScenario({ id, title, fn }) {
  const failures = [];
  const c = makeChecks(failures);
  try {
    await fn(c);
  } catch (err) {
    failures.push(`scenario threw: ${err.message}`);
  }
  const ok = failures.length === 0;
  console.log(`\n=== Scenario ${id}: ${title} ===`);
  console.log(ok ? `PASS (${id})` : `FAIL (${id})`);
  for (const f of failures) console.log(`   ✗ ${f}`);
  results.push({ id, ok });
  return ok;
}

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------

// A (H-4a): 10 parallel refreshes with one cookie => exactly one 200, strict
// reuse detection kills the winner's token too.
const scenA = {
  id: 'A',
  title: 'H-4a: 10 parallel refreshes, same cookie => 1x200 + 9x401, zero 5xx; strict reuse revokes the winner too',
  fn: async (c) => {
    const u = await register('A');
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) }))
    );
    const ok200 = responses.filter((r) => r.status === 200);
    const err401 = responses.filter((r) => r.status === 401);
    const others = responses.filter((r) => r.status !== 200 && r.status !== 401);

    c.expect('exactly one 200 (never two)', ok200.length === 1, `got ${ok200.length}`);
    c.expect('nine 401 INVALID_REFRESH_TOKEN', err401.length === 9
      && err401.every((r) => r.data?.error?.code === 'INVALID_REFRESH_TOKEN'),
      err401.map((r) => `${r.status}:${r.data?.error?.code}`).join(' '));
    c.expect('zero 5xx', others.length === 0, others.map((r) => r.status).join(' '));

    // Strict reuse detection: the nine losers all saw a revoked token and revoked
    // the user's entire token set — including the winner's freshly issued one.
    const winnerCookie = ok200[0] ? refreshCookie(ok200[0].setCookies) : null;
    c.expect('winner received a new cookie', winnerCookie !== null && winnerCookie.value !== u.cookie.value);
    const after = await api('POST', '/auth/refresh', { cookie: cookieHeader(winnerCookie ?? u.cookie) });
    c.expect('winner cookie is ALSO dead (strict reuse revokes all)', after.status === 401
      && after.data?.error?.code === 'INVALID_REFRESH_TOKEN', `${after.status} ${after.bodyText}`);
    console.log('   note: strict reuse detection means the nine losers also revoked the winner\'s new token — verified dead above.');
  },
};

// B (H-4b): theft containment — a reused (stolen) cookie kills every session.
const scenB = {
  id: 'B',
  title: 'H-4b: stolen-cookie reuse revokes ALL of the user\'s tokens (old + new dead, zero live rows)',
  fn: async (c) => {
    const u = await register('B');
    const attacker = await api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) });
    c.expect('attacker refresh 200 (gets C2)', attacker.status === 200, `${attacker.status}`);
    const c2 = refreshCookie(attacker.setCookies);

    const victim = await api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) });
    c.expect('victim presents C1 => 401 INVALID_REFRESH_TOKEN', victim.status === 401
      && victim.data?.error?.code === 'INVALID_REFRESH_TOKEN', victim.bodyText);

    const after = await api('POST', '/auth/refresh', { cookie: cookieHeader(c2) });
    c.expect('C2 also dead (containment)', after.status === 401 && after.data?.error?.code === 'INVALID_REFRESH_TOKEN',
      `${after.status} ${after.bodyText}`);

    const live = psql(`SELECT count(*) FROM refresh_tokens WHERE user_id = '${u.id}' AND revoked_at IS NULL;`);
    c.expect('zero unrevoked refresh_tokens in DB', live === '0', `count=${live}`);
  },
};

// C (M-3): expiry decisions use the DB clock; expiry is not theft.
const scenC = {
  id: 'C',
  title: 'M-3: DB-clock expiry (expired token is not theft), DB-built expiry window, no JS-clock expiry decisions',
  fn: async (c) => {
    // (1) two live tokens; expire one via psql; only that one dies, the other lives
    const u = await register('C');
    const second = await api('POST', '/auth/login', { body: u.body });
    c.expect('second login yields a token', second.status === 200, `${second.status}`);
    const cookieB = refreshCookie(second.setCookies);

    psql(`UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = '${tokenHash(u.cookie.value)}';`);

    const dead = await api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) });
    c.expect('expired token => 401 INVALID_REFRESH_TOKEN', dead.status === 401
      && dead.data?.error?.code === 'INVALID_REFRESH_TOKEN', dead.bodyText);

    const live = await api('POST', '/auth/refresh', { cookie: cookieHeader(cookieB) });
    c.expect('expiry is NOT theft: other live token still refreshes (200)', live.status === 200,
      `${live.status} ${live.bodyText}`);

    // (2) expiry window is built by the DB clock: expires_at - created_at == N days +/- 2s
    const cookieC = refreshCookie(live.setCookies);
    const window = Number(psql(
      `SELECT extract(epoch FROM (expires_at - created_at)) FROM refresh_tokens WHERE token_hash = '${tokenHash(cookieC.value)}';`
    ));
    const expected = REFRESH_TOKEN_EXPIRY_DAYS * 86400;
    c.expect(`expiry window == ${REFRESH_TOKEN_EXPIRY_DAYS}d +/- 2s (DB clock)`, Math.abs(window - expected) <= 2,
      `got ${window}s, expected ${expected}s`);

    // (3) static check: no JS-clock expiry/"is it still valid" decisions in the modules
    const dirs = ['src/modules/auth', 'src/modules/show-seats', 'src/modules/bookings'].map((d) => join(ROOT, d));
    const files = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    dirs.forEach(walk);
    const allowed = [
      { re: /\.toISOString\(/, why: 'response formatting' },
      { re: /maxAge/i, why: 'cookie maxAge duration' },
      { re: /logger\.|console\.|pino/i, why: 'log timestamp' },
    ];
    let violations = 0;
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/Date\.now\(|new Date\(/.test(line)) return;
        const hit = `${f.replace(ROOT + '/', '')}:${i + 1}: ${line.trim()}`;
        const ok = allowed.find((a) => a.re.test(line));
        if (ok) console.log(`   allowed (${ok.why}): ${hit}`);
        else {
          console.log(`   VIOLATION: ${hit}`);
          violations++;
        }
      });
    }
    console.log('   allowed categories: response formatting (.toISOString), cookie maxAge, log timestamps.');
    c.expect('no JS-clock expiry/validity decisions', violations === 0, `${violations} violation(s)`);
  },
};

// D (L-1): one error shape { error: { message, code } } with stable codes.
const scenD = {
  id: 'D',
  title: 'L-1: every error has shape {error:{message,code}} with UNAUTHORIZED/INVALID_TOKEN/TOKEN_EXPIRED/INVALID_CREDENTIALS/EMAIL_TAKEN/INVALID_REFRESH_TOKEN/FORBIDDEN/VALIDATION_ERROR',
  fn: async (c) => {
    const u = await register('D');
    const expired = makeToken({ alg: 'HS256', typ: 'JWT' }, validPayload({ exp: Math.floor(Date.now() / 1000) - 60 }));

    const cases = [
      { label: 'missing Authorization header', p: () => api('GET', '/bookings/mine'), status: 401, code: 'UNAUTHORIZED' },
      { label: 'garbage bearer token', p: () => api('GET', '/bookings/mine', { token: 'garbage' }), status: 401, code: 'INVALID_TOKEN' },
      { label: 'expired access token', p: () => api('GET', '/bookings/mine', { token: expired }), status: 401, code: 'TOKEN_EXPIRED' },
      { label: 'wrong password', p: () => api('POST', '/auth/login', { body: { email: u.body.email, password: 'wrong-password' } }), status: 401, code: 'INVALID_CREDENTIALS' },
      { label: 'unknown email', p: () => api('POST', '/auth/login', { body: { email: email('nobody'), password: 'Passw0rd!123' } }), status: 401, code: 'INVALID_CREDENTIALS' },
      { label: 'duplicate email', p: () => api('POST', '/auth/register', { body: u.body }), status: 409, code: 'EMAIL_TAKEN' },
      { label: 'refresh without cookie', p: () => api('POST', '/auth/refresh'), status: 401, code: 'UNAUTHORIZED' },
      { label: 'refresh with garbage cookie', p: () => api('POST', '/auth/refresh', { cookie: 'refreshToken=garbage' }), status: 401, code: 'INVALID_REFRESH_TOKEN' },
      { label: 'register validation error', p: () => api('POST', '/auth/register', { body: { name: 'X', email: email('bad'), password: 'short', role: 'ATTENDEE' } }), status: 400, code: 'VALIDATION_ERROR' },
      { label: 'attendee on organizer route', p: () => api('POST', '/venues', { token: u.token, body: { name: 'V', address: 'A', city: 'C' } }), status: 403, code: 'FORBIDDEN' },
    ];

    for (const t of cases) {
      const r = await t.p();
      c.expect(`${t.label}: ${t.status} + error shape`, r.status === t.status && hasErrorShape(r.data),
        `${r.status} ${r.bodyText}`);
      c.expect(`${t.label}: code ${t.code}`, r.data?.error?.code === t.code, r.bodyText);
    }
  },
};

// E (L-3a): failed logins must not leak whether the email exists (timing).
const scenE = {
  id: 'E',
  title: 'L-3a: timing oracle — medians of 25 failed logins (existing vs unknown email) within 60%',
  fn: async (c) => {
    console.log('   note: timing tests can be noisy on shared machines.');

    // With ENABLE_RATE_LIMITING on, RATE_LIMIT_LOGIN_IP_LIMIT binds across every
    // call below (same source IP) — paced in batches of that size with a full
    // window's wait in between. The per-email limit is sidestepped by measuring
    // each "existing account" sample against its own freshly-registered user
    // (one attempt each) instead of one email repeated 25x — same "real
    // password hash to compare against" code path, just not re-hitting one key.
    redisDelPattern('ratelimit:login-ip:*');
    const ipWindowMs = RATE_LIMIT_LOGIN_IP_WINDOW_SECONDS * 1000 + 1000;
    let sinceWait = 0;
    // Waits out the login-ip window when a batch is full. Called BEFORE the timer
    // starts, so a pacing sleep is never part of a sample.
    const pace = async () => {
      if (sinceWait >= RATE_LIMIT_LOGIN_IP_LIMIT) {
        await sleep(ipWindowMs);
        sinceWait = 0;
      }
      sinceWait++;
    };

    // Warm up argon2/JIT/connections once, off throwaway emails, before timing.
    for (let i = 0; i < 3; i++) {
      await pace();
      await api('POST', '/auth/login', { body: { email: email('warmup'), password: 'warmup' } });
    }

    const timeIt = async (body) => {
      await pace();
      const t0 = process.hrtime.bigint();
      const r = await api('POST', '/auth/login', { body });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`);
      return ms;
    };

    // Both groups must be measured under the same conditions. Timing every
    // existing-email login right after that user's register, and all unknown-email
    // logins afterwards, made the existing group ~45 ms slower whether or not the
    // email existed (an unknown email timed right after a register was just as
    // slow). So: register every user first, then alternate existing/unknown
    // samples, swapping which goes first on each pair.
    const users = [];
    for (let i = 0; i < 25; i++) users.push((await register(`E${i}`)).body.email);
    const existing = [];
    const unknown = [];
    for (let i = 0; i < 25; i++) {
      const sampleExisting = async () => existing.push(await timeIt({ email: users[i], password: 'wrong-password' }));
      const sampleUnknown = async () => unknown.push(await timeIt({ email: email('ghost'), password: 'Passw0rd!123' }));
      if (i % 2 === 0) { await sampleExisting(); await sampleUnknown(); }
      else { await sampleUnknown(); await sampleExisting(); }
    }

    const median = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    const medExisting = median(existing);
    const medUnknown = median(unknown);
    console.log(`   median existing-email: ${medExisting.toFixed(1)} ms | median unknown-email: ${medUnknown.toFixed(1)} ms`);
    const ratio = Math.min(medExisting, medUnknown) / Math.max(medExisting, medUnknown);
    c.expect('smaller median >= 60% of larger', ratio >= 0.6, `ratio=${ratio.toFixed(3)}`);
  },
};

// F (L-3b): deactivated users cannot login or refresh; body identical to wrong password.
const scenF = {
  id: 'F',
  title: 'L-3b: is_active=false => login 401 identical to wrong password, refresh 401 INVALID_REFRESH_TOKEN',
  fn: async (c) => {
    const u = await register('F');
    const wrong = await api('POST', '/auth/login', { body: { email: u.body.email, password: 'nope' } });

    psql(`UPDATE users SET is_active = false WHERE id = '${u.id}';`);

    const login = await api('POST', '/auth/login', { body: u.body });
    c.expect('deactivated login 401', login.status === 401, `${login.status} ${login.bodyText}`);
    c.expect('same body as a wrong password', JSON.stringify(login.data) === JSON.stringify(wrong.data),
      `${login.bodyText} vs ${wrong.bodyText}`);

    const refresh = await api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) });
    c.expect('refresh 401 INVALID_REFRESH_TOKEN', refresh.status === 401
      && refresh.data?.error?.code === 'INVALID_REFRESH_TOKEN', refresh.bodyText);

    // Documented behaviour: requireAuth stays stateless, so an already issued
    // access token keeps working until it expires (at most JWT_ACCESS_EXPIRY).
    const stillValid = await api('GET', '/bookings/mine', { token: u.token });
    c.expect('already-issued access token still valid until expiry (documented)', stillValid.status === 200,
      `${stillValid.status}`);
    console.log('   note: deactivation takes effect at the next refresh or login, at most JWT_ACCESS_EXPIRY later.');
  },
};

// G (L-4): hand-built JWTs must all be rejected with 401 INVALID_TOKEN.
const scenG = {
  id: 'G',
  title: 'L-4: alg:none, HS512, SUPERUSER role and non-uuid userId tokens all => 401 INVALID_TOKEN',
  fn: async (c) => {
    const none = `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(validPayload()))}.`;
    const hs512 = makeToken({ alg: 'HS512', typ: 'JWT' }, validPayload());
    const superuser = makeToken({ alg: 'HS256', typ: 'JWT' }, validPayload({ role: 'SUPERUSER' }));
    const badUserId = makeToken({ alg: 'HS256', typ: 'JWT' }, validPayload({ userId: 'not-a-uuid' }));

    for (const [label, token] of [['alg:none', none], ['HS512', hs512], ['role SUPERUSER', superuser], ['non-uuid userId', badUserId]]) {
      const r = await api('GET', '/bookings/mine', { token });
      c.expect(`${label} => 401 INVALID_TOKEN`, r.status === 401 && r.data?.error?.code === 'INVALID_TOKEN',
        `${r.status} ${r.bodyText}`);
    }
  },
};

// H: happy path + cookie lifecycle.
const scenH = {
  id: 'H',
  title: 'happy path: register -> use -> rotate -> logout; failed refresh and logout clear the cookie with the same options',
  fn: async (c) => {
    const u = await register('H');
    c.expect('set cookie has Path=/auth', String(u.cookie.attrs.path ?? '').toLowerCase() === '/auth',
      JSON.stringify(u.cookie.attrs));

    const mine = await api('GET', '/bookings/mine', { token: u.token });
    c.expect('access token works', mine.status === 200, `${mine.status}`);

    const rot = await api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) });
    c.expect('refresh 200 + new cookie', rot.status === 200, `${rot.status} ${rot.bodyText}`);
    const c2 = refreshCookie(rot.setCookies);
    c.expect('cookie rotated to a new value', c2 !== null && c2.value !== u.cookie.value);

    const old = await api('POST', '/auth/refresh', { cookie: cookieHeader(u.cookie) });
    c.expect('old cookie dead (401)', old.status === 401 && old.data?.error?.code === 'INVALID_REFRESH_TOKEN', old.bodyText);
    console.log("   note: by strict reuse detection the rotation check above also revoked C2's family — logout below still must behave correctly.");

    const clearShape = (r, label) => {
      const cc = refreshCookie(r.setCookies);
      c.expect(`${label}: clears the cookie`, cc !== null && cc.value === '', JSON.stringify(r.setCookies));
      if (!cc) return;
      const sameOpts = String(cc.attrs.path ?? '').toLowerCase() === String(u.cookie.attrs.path ?? '').toLowerCase()
        && Boolean(cc.attrs.httponly) === Boolean(u.cookie.attrs.httponly)
        && String(cc.attrs.samesite ?? '').toLowerCase() === String(u.cookie.attrs.samesite ?? '').toLowerCase();
      c.expect(`${label}: same path/options as when set`, sameOpts,
        `set=${JSON.stringify(u.cookie.attrs)} clear=${JSON.stringify(cc.attrs)}`);
    };

    const failed = await api('POST', '/auth/refresh', { cookie: cookieHeader(c2 ?? u.cookie) });
    c.expect('failed refresh is 401', failed.status === 401, `${failed.status}`);
    clearShape(failed, 'failed refresh');

    const logout = await api('POST', '/auth/logout', { cookie: cookieHeader(c2 ?? u.cookie) });
    c.expect('logout 200', logout.status === 200, `${logout.status}`);
    clearShape(logout, 'logout');

    const afterLogout = await api('POST', '/auth/refresh', { cookie: cookieHeader(c2 ?? u.cookie) });
    c.expect('refresh after logout 401 INVALID_REFRESH_TOKEN', afterLogout.status === 401
      && afterLogout.data?.error?.code === 'INVALID_REFRESH_TOKEN', afterLogout.bodyText);
  },
};

// ---------------------------------------------------------------------------

async function main() {
  const all = [scenA, scenB, scenC, scenD, scenE, scenF, scenG, scenH];
  const wanted = process.argv.slice(2).map((s) => s.toUpperCase());
  const selected = wanted.length > 0 ? all.filter((s) => wanted.includes(s.id)) : all;

  console.log(`verify-batch3 against ${BASE_URL}`);
  for (const s of selected) await runScenario(s);

  console.log('\n========================================');
  for (const r of results) console.log(`Scenario ${r.id}: ${r.ok ? 'PASS' : 'FAIL'}`);
  console.log('========================================');
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error during verify-batch3:', err);
  process.exit(1);
});
