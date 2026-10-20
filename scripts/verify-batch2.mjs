#!/usr/bin/env node
/**
 * FlashSeat — Batch 2 regression script (robustness).
 *
 * Reproduces / verifies: H-3 (pool wedge), M-7 (idle client errors), L-8 (rollback
 * failure), L-2 (shutdown/health), M-9 (register race + central pg error mapping),
 * L-5 (exclusion-constraint deadlock probe). See docs/review/phase2-review.md.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 node scripts/verify-batch2.mjs [scenarioIds...]
 *   e.g. node scripts/verify-batch2.mjs E F
 *
 * DB access goes through psql in the compose container like the other project
 * scripts; DOCKER_BIN overrides the docker binary if it is not on PATH.
 * Requires a running API with ENABLE_MOCK_PAYMENT=true and the Batch 2 env
 * settings (DB_LOCK_TIMEOUT_MS etc.) applied to it.
 *
 * Note: scenario D only inspects the booking-path responses collected by A and C.
 * The /auth error shape is Batch 3 scope and is asserted only by status code.
 */

import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';
const PSQL_ARGS = ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'flashseat', '-d', 'flashseat'];
const LOCK_TIMEOUT_MS = Number(process.env.DB_LOCK_TIMEOUT_MS || 1000);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rnd = () => Math.random().toString(36).slice(2, 8);

function psql(sql) {
  return execFileSync(DOCKER_BIN, [...PSQL_ARGS, '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
}

/** Starts psql in the background; returns a promise that resolves when it exits. */
function spawnPsql(sql) {
  return new Promise((resolve) => {
    const child = spawn(DOCKER_BIN, [...PSQL_ARGS, '-c', sql], { stdio: 'ignore' });
    child.on('exit', (code) => resolve(code));
    child.on('error', () => resolve(-1));
  });
}

function deadlockCount() {
  const out = execFileSync(DOCKER_BIN, ['compose', 'logs', '--no-color', 'postgres'], { encoding: 'utf8', cwd: ROOT });
  return (out.match(/deadlock detected/g) || []).length;
}

async function timedApi(method, path, { token, body, key } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (key) headers['Idempotency-Key'] = key;
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const bodyText = await res.text();
    let data = null;
    try { data = JSON.parse(bodyText); } catch { /* non-JSON */ }
    return {
      ok: true, status: res.status, data, bodyText, ms: Date.now() - t0,
      retryAfter: res.headers.get('retry-after'),
    };
  } catch (err) {
    return { ok: false, error: err, ms: Date.now() - t0 };
  }
}

const email = (tag) => `${tag}_${Date.now()}_${rnd()}@verify.test`;

async function register(tag, role) {
  const body = { name: tag, email: email(tag), password: 'Passw0rd!123', role };
  if (role === 'ORGANIZER') body.organization_name = `${tag} Org`;
  const res = await timedApi('POST', '/auth/register', { body });
  if (res.status !== 201) throw new Error(`register ${tag} failed: ${res.status} ${res.bodyText}`);
  return { id: res.data.user.id, token: res.data.accessToken };
}

async function createVenue(org, seatCount) {
  const res = await timedApi('POST', '/venues', {
    token: org.token,
    body: { name: `B2 Arena ${rnd()}`, address: '1 Robust Way', city: 'Testville' },
  });
  if (res.status !== 201) throw new Error(`createVenue failed: ${res.status}`);
  const seats = await timedApi('POST', `/venues/${res.data.id}/seats/bulk`, {
    token: org.token,
    body: { mode: 'GRID', section: 'MAIN', rows: ['A'], seatsPerRow: seatCount, category: 'REGULAR' },
  });
  if (seats.status !== 201) throw new Error(`bulk seats failed: ${seats.status}`);
  return res.data.id;
}

async function createShowAt(org, eventId, venueId, startMs) {
  return timedApi('POST', `/events/${eventId}/shows`, {
    token: org.token,
    body: {
      venueId,
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(startMs + 2 * 3600_000).toISOString(),
      categoryPrices: [{ category: 'REGULAR', pricePaise: 50000 }],
    },
  });
}

async function setupWithHold(tag, seatCount) {
  const org = await register(`${tag}_org`, 'ORGANIZER');
  const user = await register(`${tag}_usr`, 'ATTENDEE');
  const venueId = await createVenue(org, seatCount);
  const ev = await timedApi('POST', '/events', { token: org.token, body: { title: `${tag} Event`, category: 'MUSIC' } });
  const eventId = ev.data.id;
  const showRes = await createShowAt(org, eventId, venueId, Date.now() + 5 * 86400_000);
  const showId = showRes.data.id;
  const pub = await timedApi('POST', `/events/${eventId}/publish`, { token: org.token });
  if (pub.status !== 200) throw new Error(`publish failed: ${pub.status}`);
  const map = await timedApi('GET', `/shows/${showId}/seats`);
  const seatIds = map.data.sections.flatMap((s) => s.rows.flatMap((r) => r.seats)).map((s) => s.id);
  return { org, user, eventId, venueId, showId, seatIds };
}

const checkout = (u, resId) => timedApi('POST', `/reservations/${resId}/checkout`, { token: u.token });
const hold = (u, showId, key, seatIds) =>
  timedApi('POST', `/shows/${showId}/reservations`, { token: u.token, key, body: { seatIds } });

const TERMINATE_SQL =
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'flashseat-api' AND pid <> pg_backend_pid();";

// Booking-path responses collected by A and C for scenario D's hygiene checks.
const hygieneSamples = [];

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

// A (H-3): a single held row lock must not wedge the pool.
const scenA = {
  id: 'A',
  title: `H-3: 15 parallel checkouts blocked on a row lock fail fast (<= ${LOCK_TIMEOUT_MS + 3000} ms, 409 LOCK_TIMEOUT); /health and /auth stay responsive`,
  fn: async (c) => {
    const s = await setupWithHold('A', 2);
    const h = await hold(s.user, s.showId, `A-hold-${rnd()}`, [s.seatIds[0]]);
    c.expect('setup hold 201', h.status === 201, `got ${h.status}`);
    const resId = h.data?.reservation?.id;

    const blockerDone = spawnPsql(
      `BEGIN; SELECT id FROM reservations WHERE id='${resId}' FOR UPDATE; SELECT pg_sleep(8); COMMIT;`
    );
    await sleep(700);

    const threshold = LOCK_TIMEOUT_MS + 3000;
    // dispatch the availability probes first so they get pool clients immediately,
    // while the checkouts below are the ones meant to be stuck
    const healthP = timedApi('GET', '/health');
    const loginP = timedApi('POST', '/auth/login', { body: { email: 'nope@verify.test', password: 'wrong' } });
    const checkoutPs = Array.from({ length: 15 }, () => checkout(s.user, resId));
    const [health, login, ...checkouts] = await Promise.all([healthP, loginP, ...checkoutPs]);

    for (const r of checkouts) hygieneSamples.push({ from: 'A', ...r });

    c.expect('health 200 while lock storm in flight', health.ok && health.status === 200 && health.ms < 3000,
      `status=${health.status} ms=${health.ms}`);
    c.expect('auth 401 while lock storm in flight', login.ok && login.status === 401 && login.ms < 3000,
      `status=${login.status} ms=${login.ms}`);

    let timingOk = true;
    let codesOk = true;
    for (const r of checkouts) {
      if (!r.ok || r.ms > threshold) timingOk = false;
      const isLockTimeout = r.status === 409 && r.data?.error?.code === 'LOCK_TIMEOUT';
      const isDbTimeout = r.status === 503 && r.data?.error?.code === 'DB_TIMEOUT';
      if (!isLockTimeout && !isDbTimeout) codesOk = false;
    }
    c.expect(`all 15 checkouts answered within ${threshold} ms`, timingOk,
      `durations=${checkouts.map((r) => r.ms).join(',')}`);
    c.expect('all 15 checkouts are 409 LOCK_TIMEOUT / 503 DB_TIMEOUT', codesOk,
      checkouts.map((r) => `${r.status}:${r.data?.error?.code ?? r.error?.message}`).join(' '));

    await blockerDone;
    await sleep(200);

    const final = await checkout(s.user, resId);
    c.expect('normal checkout after blocker succeeds', final.ok && final.status >= 200 && final.status < 300,
      `got ${final.status} ${final.bodyText}`);
  },
};

// B (M-7): killing idle backends must not crash the API process.
const scenB = {
  id: 'B',
  title: 'M-7: pg_terminate_backend on idle clients logs but keeps the process alive',
  fn: async (c) => {
    const s = await setupWithHold('B', 2);
    // warm the pool so idle clients exist
    const warm = await Promise.all(
      Array.from({ length: 10 }, () => timedApi('GET', '/bookings/mine', { token: s.user.token }))
    );
    c.expect('warm-up requests 200', warm.every((r) => r.ok && r.status === 200));

    psql(TERMINATE_SQL);
    await sleep(1000);

    const health = await timedApi('GET', '/health');
    const authed = await timedApi('GET', '/bookings/mine', { token: s.user.token });
    c.expect('process alive: /health 200', health.ok && health.status === 200,
      `status=${health.status} err=${health.error?.message ?? ''}`);
    c.expect('process alive: authenticated request 200', authed.ok && authed.status === 200,
      `status=${authed.status} err=${authed.error?.message ?? ''}`);
  },
};

// C (L-8, best effort): connection death mid-transaction -> mapped 5xx/409, pool recovers.
const scenC = {
  id: 'C',
  title: 'L-8: backend killed mid-checkout => 503 DB_UNAVAILABLE or 409 LOCK_TIMEOUT (never plain 500), pool recovers',
  fn: async (c) => {
    const s = await setupWithHold('C', 2);
    const h = await hold(s.user, s.showId, `C-hold-${rnd()}`, [s.seatIds[0]]);
    const resId = h.data?.reservation?.id;

    const blockerDone = spawnPsql(
      `BEGIN; SELECT id FROM reservations WHERE id='${resId}' FOR UPDATE; SELECT pg_sleep(8); COMMIT;`
    );
    await sleep(700);

    const checkoutP = checkout(s.user, resId);
    await sleep(300);
    psql(TERMINATE_SQL);

    const r = await checkoutP;
    if (r.ok) hygieneSamples.push({ from: 'C', ...r });

    c.expect('checkout produced a response (no connection drop on the client side)', r.ok,
      `fetch error=${r.error?.message ?? ''}`);
    if (r.ok) {
      const code = r.data?.error?.code;
      c.expect('503 DB_UNAVAILABLE or 409 LOCK_TIMEOUT', (r.status === 503 && code === 'DB_UNAVAILABLE') || (r.status === 409 && code === 'LOCK_TIMEOUT'),
        `got ${r.status} ${r.bodyText}`);
      c.expect('never a plain 500', r.status !== 500, `got ${r.status} ${r.bodyText}`);
    }

    await sleep(200);
    const health = await timedApi('GET', '/health');
    const authed = await timedApi('GET', '/bookings/mine', { token: s.user.token });
    c.expect('pool recovered: /health 200', health.ok && health.status === 200,
      `status=${health.status} err=${health.error?.message ?? ''}`);
    c.expect('pool recovered: authenticated request 200', authed.ok && authed.status === 200,
      `status=${authed.status} err=${authed.error?.message ?? ''}`);

    await blockerDone;
  },
};

// D: response hygiene of every non-2xx booking-path response observed in A and C.
const scenD = {
  id: 'D',
  title: 'response hygiene: error.code present, Retry-After on 503/retryable 409, no SQL/constraint leaks',
  fn: async (c) => {
    const non2xx = hygieneSamples.filter((r) => r.ok && r.status >= 300);
    c.expect('hygiene samples collected from A and C', hygieneSamples.length > 0 && non2xx.length > 0,
      `samples=${hygieneSamples.length} non2xx=${non2xx.length}`);

    const RETRYABLE_409 = new Set(['RETRYABLE_CONFLICT', 'LOCK_TIMEOUT']);
    const CONSTRAINT_NAMES = [
      'users_email_key', 'no_venue_overlap', 'uq_one_active_reservation',
      'uq_one_live_ticket_per_seat', 'chk_show_seat', 'show_category_prices_pkey',
    ];

    for (const r of non2xx) {
      const code = r.data?.error?.code;
      c.expect(`[${r.from} ${r.status}] has error.code`, code !== undefined && code !== null, r.bodyText);

      const retryable = r.status === 503 || (r.status === 409 && RETRYABLE_409.has(code));
      if (retryable) {
        c.expect(`[${r.from} ${r.status} ${code}] has Retry-After`, r.retryAfter !== null && r.retryAfter !== '', '');
      }

      const body = r.bodyText.toLowerCase();
      const leaks = [];
      if (/\bpg\b/.test(body) || body.includes('pg_')) leaks.push('pg');
      if (body.includes('relation')) leaks.push('relation');
      if (body.includes('constraint')) leaks.push('constraint');
      if (body.includes('select ') || body.includes('insert ') || body.includes('update ')) leaks.push('sql text');
      for (const name of CONSTRAINT_NAMES) if (body.includes(name)) leaks.push(name);
      c.expect(`[${r.from} ${r.status}] no SQL/constraint leaks`, leaks.length === 0,
        `leaked ${leaks.join(', ')} in ${r.bodyText}`);
    }
  },
};

// E (M-9): 10 parallel registers with one email => exactly one 201, nine identical 409s.
const scenE = {
  id: 'E',
  title: 'M-9: register race => 1x201 + 9x409 (same shape as the pre-check), zero 5xx',
  fn: async (c) => {
    for (let round = 1; round <= 3; round++) {
      const mail = email(`E_r${round}`);
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          timedApi('POST', '/auth/register', {
            body: { name: 'Race', email: mail, password: 'Passw0rd!123', role: 'ATTENDEE' },
          })
        )
      );
      const created = responses.filter((r) => r.status === 201).length;
      const conflicts = responses.filter((r) => r.status === 409);
      const others = responses.filter((r) => r.status !== 201 && r.status !== 409);
      c.expect(`round ${round}: exactly one 201`, created === 1, `got ${created}`);
      c.expect(`round ${round}: exactly nine 409`, conflicts.length === 9, `got ${conflicts.length}`);
      c.expect(`round ${round}: zero other statuses`, others.length === 0,
        others.map((r) => `${r.status}:${r.bodyText}`).join(' '));
      c.expect(`round ${round}: 409s use the pre-check error (EMAIL_TAKEN)`,
        conflicts.every((r) => r.data?.error?.code === 'EMAIL_TAKEN' && r.data?.error?.message === 'Email already in use'),
        conflicts.map((r) => r.bodyText).join(' '));
    }
  },
};

// F (L-5): concurrent overlapping createShow on one venue; counts deadlocks to decide
// on the per-venue advisory lock.
const scenF = {
  id: 'F',
  title: 'L-5: 50 rounds of 2 parallel overlapping createShow => 1x201 + 1x409, zero 5xx; print deadlock count',
  fn: async (c) => {
    const org = await register('F_org', 'ORGANIZER');
    const venueId = await createVenue(org, 3);
    const ev = await timedApi('POST', '/events', { token: org.token, body: { title: 'F Event', category: 'MUSIC' } });
    const eventId = ev.data.id;

    const deadlocksBefore = deadlockCount();
    const ROUNDS = 50;
    let roundsOk = true;
    const bad = [];

    for (let round = 1; round <= ROUNDS; round++) {
      const base = Date.now() + round * 86400_000;
      const [r1, r2] = await Promise.all([
        createShowAt(org, eventId, venueId, base + 10 * 3600_000),
        createShowAt(org, eventId, venueId, base + 11 * 3600_000), // overlaps r1
      ]);
      const codes = [r1.status, r2.status].sort((a, b) => a - b);
      const ok = codes[0] === 201 && codes[1] === 409;
      if (!ok) {
        roundsOk = false;
        if (bad.length < 5) bad.push(`round ${round}: ${r1.status}/${r2.status} ${r1.bodyText} ${r2.bodyText}`);
      }
    }
    for (const b of bad) console.log(`   ! ${b}`);
    c.expect(`all ${ROUNDS} rounds: exactly one 201 and one 409, zero 5xx`, roundsOk);

    const deadlocksAfter = deadlockCount();
    console.log(`   deadlock detected count: ${deadlocksAfter - deadlocksBefore} during run (${deadlocksAfter} total in postgres logs)`);
    // The count gates the advisory-lock decision (see task); it is informational
    // for pass/fail because 40P01 already maps to a retryable 409.
  },
};

// ---------------------------------------------------------------------------

async function main() {
  const all = [scenA, scenB, scenC, scenD, scenE, scenF];
  const wanted = process.argv.slice(2).map((s) => s.toUpperCase());
  const selected = wanted.length > 0 ? all.filter((s) => wanted.includes(s.id)) : all;

  console.log(`verify-batch2 against ${BASE_URL} (lock timeout budget: ${LOCK_TIMEOUT_MS} ms)`);
  for (const s of selected) await runScenario(s);

  console.log('\n========================================');
  for (const r of results) console.log(`Scenario ${r.id}: ${r.ok ? 'PASS' : 'FAIL'}`);
  console.log('========================================');
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error during verify-batch2:', err);
  process.exit(1);
});
