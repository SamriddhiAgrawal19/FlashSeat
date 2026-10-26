#!/usr/bin/env node
/**
 * FlashSeat — Batch 1 regression script (booking lifecycle correctness).
 *
 * Reproduces / verifies: H-1, M-2, M-1, M-8, H-2, V-1 (see docs/review/phase2-review.md).
 * Each scenario prints PASS/FAIL; exit code 0 only if everything passes.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 node scripts/verify-batch1.mjs
 *
 * DB tweaks / invariant checks run through psql in the compose container, like the
 * other project scripts: `docker compose exec -T postgres psql ...`. If your `docker`
 * binary is not on PATH (e.g. WSL without docker integration but Docker Desktop
 * reachable), point DOCKER_BIN at it:  DOCKER_BIN=/path/to/docker.exe node scripts/...
 *
 * Requires a running API with ENABLE_MOCK_PAYMENT=true.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';
const PSQL_ARGS = ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'flashseat', '-d', 'flashseat'];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function psql(sql, { tuplesOnly = true } = {}) {
  const args = tuplesOnly ? [...PSQL_ARGS, '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'] : [...PSQL_ARGS, '-f', '-'];
  return execFileSync(DOCKER_BIN, args, { input: sql, encoding: 'utf8' });
}

function checkInvariants() {
  const sql = readFileSync(join(ROOT, 'scripts', 'check-invariants.sql'), 'utf8');
  const out = psql(sql);
  // psql -A -t prints only data rows and the \echo banners (which start with '---').
  return out.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('---'));
}

function deadlockCount() {
  const out = execFileSync(DOCKER_BIN, ['compose', 'logs', '--no-color', 'postgres'], {
    encoding: 'utf8',
    cwd: ROOT,
    // the full container log outgrows execFileSync's 1 MB default (ENOBUFS)
    maxBuffer: 256 * 1024 * 1024,
  });
  return (out.match(/deadlock detected/g) || []).length;
}

async function api(method, path, { token, body, key } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (key) headers['Idempotency-Key'] = key;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

const rnd = () => Math.random().toString(36).slice(2, 8);
const email = (tag) => `${tag}_${Date.now()}_${rnd()}@verify.test`;

async function register(tag, role) {
  const body = { name: tag, email: email(tag), password: 'Passw0rd!123', role };
  if (role === 'ORGANIZER') body.organization_name = `${tag} Org`;
  const res = await api('POST', '/auth/register', { body });
  if (res.status !== 201) throw new Error(`register ${tag} failed: ${res.status} ${JSON.stringify(res.data)}`);
  return { id: res.data.user.id, token: res.data.accessToken };
}

async function createVenue(org, seatCount) {
  const res = await api('POST', '/venues', {
    token: org.token,
    body: { name: `Verify Arena ${rnd()}`, address: '1 Test Way', city: 'Testville' },
  });
  if (res.status !== 201) throw new Error(`createVenue failed: ${res.status}`);
  const seats = await api('POST', `/venues/${res.data.id}/seats/bulk`, {
    token: org.token,
    body: { mode: 'GRID', section: 'MAIN', rows: ['A'], seatsPerRow: seatCount, category: 'REGULAR' },
  });
  if (seats.status !== 201) throw new Error(`bulk seats failed: ${seats.status}`);
  return res.data.id;
}

async function createShow(org, eventId, venueId) {
  const start = Date.now() + 5 * 86400_000;
  const res = await api('POST', `/events/${eventId}/shows`, {
    token: org.token,
    body: {
      venueId,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 2 * 3600_000).toISOString(),
      categoryPrices: [{ category: 'REGULAR', pricePaise: 50000 }],
    },
  });
  if (res.status !== 201) throw new Error(`createShow failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.id;
}

async function seatIds(showId) {
  const map = await api('GET', `/shows/${showId}/seats`);
  return map.data.sections.flatMap((s) => s.rows.flatMap((r) => r.seats)).map((s) => s.id);
}

/** Fresh organizer + attendee + venue + published event + show. */
async function setup(tag, seatCount) {
  const org = await register(`${tag}_org`, 'ORGANIZER');
  const user = await register(`${tag}_usr`, 'ATTENDEE');
  const venueId = await createVenue(org, seatCount);
  const ev = await api('POST', '/events', {
    token: org.token,
    body: { title: `${tag} Event`, category: 'MUSIC' },
  });
  if (ev.status !== 201) throw new Error(`createEvent failed: ${ev.status}`);
  const eventId = ev.data.id;
  const showId = await createShow(org, eventId, venueId);
  const pub = await api('POST', `/events/${eventId}/publish`, { token: org.token });
  if (pub.status !== 200) throw new Error(`publish failed: ${pub.status} ${JSON.stringify(pub.data)}`);
  return { org, user, eventId, venueId, showId, seats: await seatIds(showId) };
}

const hold = (u, showId, key, seatIdsArr) =>
  api('POST', `/shows/${showId}/reservations`, { token: u.token, key, body: { seatIds: seatIdsArr } });
const checkout = (u, resId) => api('POST', `/reservations/${resId}/checkout`, { token: u.token });
const release = (u, resId) => api('DELETE', `/reservations/${resId}`, { token: u.token });
const confirmMock = (u, bId) => api('POST', `/bookings/${bId}/confirm-mock`, { token: u.token });
const cancelEvent = (org, eventId) => api('POST', `/events/${eventId}/cancel`, { token: org.token });

// ---------------------------------------------------------------------------
// scenario assertion plumbing
// ---------------------------------------------------------------------------

const results = [];
function scenario(id, title, fn) {
  return { id, title, fn };
}

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

// A (H-1): confirm must re-check the show. cancelEvent must close the pipeline.
const scenA = scenario('A', 'H-1: confirm-mock on a cancelled show => 409 SHOW_NOT_BOOKABLE; pipeline closed', async (c) => {
  const s = await setup('A', 4);
  const h = await hold(s.user, s.showId, `A-hold-${rnd()}`, [s.seats[0], s.seats[1]]);
  c.expect('hold 201', h.status === 201, `got ${h.status}`);
  const resId = h.data?.reservation?.id;

  const co = await checkout(s.user, resId);
  c.expect('checkout 201', co.status === 201, `got ${co.status}`);
  const bId = co.data?.booking?.id;

  const cx = await cancelEvent(s.org, s.eventId);
  c.expect('cancel 200', cx.status === 200, `got ${cx.status}`);

  const cf = await confirmMock(s.user, bId);
  c.expect('confirm-mock 409', cf.status === 409, `got ${cf.status} ${JSON.stringify(cf.data)}`);
  c.expect('error.code SHOW_NOT_BOOKABLE', cf.data?.error?.code === 'SHOW_NOT_BOOKABLE', JSON.stringify(cf.data));

  const b = await api('GET', `/bookings/${bId}`, { token: s.user.token });
  c.expect('booking CANCELLED', b.data?.booking?.status === 'CANCELLED', `got ${b.data?.booking?.status}`);

  const r = await api('GET', `/reservations/${resId}`, { token: s.user.token });
  c.expect('reservation RELEASED', r.data?.reservation?.status === 'RELEASED', `got ${r.data?.reservation?.status}`);

  const seatsNow = await api('GET', `/shows/${s.showId}/seats`);
  const st = [s.seats[0], s.seats[1]].map((id) => seatsNow.data.sections.flatMap((x) => x.rows.flatMap((y) => y.seats)).find((z) => z.id === id)?.status);
  c.expect('seats AVAILABLE', st.every((x) => x === 'AVAILABLE'), `got ${JSON.stringify(st)}`);
});

// B (M-2): event state machine + real cancelEvent.
const scenB = scenario('B', 'M-2: publish/cancel guards, idempotent cancel, CONFIRMED => REFUND_PENDING', async (c) => {
  const s = await setup('B', 2);
  const h = await hold(s.user, s.showId, `B-hold-${rnd()}`, [s.seats[0]]);
  const resId = h.data?.reservation?.id;
  const co = await checkout(s.user, resId);
  const bId = co.data?.booking?.id;
  const cf = await confirmMock(s.user, bId);
  c.expect('setup: confirm 200', cf.status === 200 && cf.data?.booking?.status === 'CONFIRMED', `got ${cf.status}`);

  const c1 = await cancelEvent(s.org, s.eventId);
  c.expect('cancel #1 200', c1.status === 200, `got ${c1.status}`);

  const b = await api('GET', `/bookings/${bId}`, { token: s.user.token });
  c.expect('booking REFUND_PENDING', b.data?.booking?.status === 'REFUND_PENDING', `got ${b.data?.booking?.status}`);

  const seatsNow = await api('GET', `/shows/${s.showId}/seats`);
  const seat0 = seatsNow.data.sections.flatMap((x) => x.rows.flatMap((y) => y.seats)).find((z) => z.id === s.seats[0]);
  c.expect('seat still BOOKED', seat0?.status === 'BOOKED', `got ${seat0?.status}`);

  const live = psql(`SELECT count(*) FROM booking_seats WHERE booking_id = '${bId}' AND released_at IS NULL;`).trim();
  c.expect('ticket still live', live === '1', `live tickets: ${live}`);

  const pub = await api('POST', `/events/${s.eventId}/publish`, { token: s.org.token });
  c.expect('publish of cancelled event 409', pub.status === 409, `got ${pub.status}`);

  const c2 = await cancelEvent(s.org, s.eventId);
  c.expect('cancel #2 200 (idempotent)', c2.status === 200, `got ${c2.status}`);

  const cs = await api('POST', `/events/${s.eventId}/shows`, {
    token: s.org.token,
    body: {
      venueId: s.venueId,
      startsAt: new Date(Date.now() + 6 * 86400_000).toISOString(),
      endsAt: new Date(Date.now() + 6 * 86400_000 + 7200_000).toISOString(),
      categoryPrices: [{ category: 'REGULAR', pricePaise: 50000 }],
    },
  });
  c.expect('createShow on cancelled event 409', cs.status === 409, `got ${cs.status}`);

  const patch = await api('PATCH', `/events/${s.eventId}`, { token: s.org.token, body: { title: 'Nope' } });
  c.expect('PATCH on cancelled event 409', patch.status === 409, `got ${patch.status}`);

  const b2 = await api('GET', `/bookings/${bId}`, { token: s.user.token });
  c.expect('2nd cancel changed nothing', b2.data?.booking?.status === 'REFUND_PENDING', `got ${b2.data?.booking?.status}`);
});

// C (M-1): replays only while the reservation is live.
const scenC = scenario('C', 'M-1: replay of an expired reservation => 409 RESERVATION_NOT_ACTIVE (EXPIRED)', async (c) => {
  const s = await setup('C', 2);
  const key = `C-hold-${rnd()}`;
  const body = { seatIds: [s.seats[0]] };
  const h = await hold(s.user, s.showId, key, body.seatIds);
  c.expect('hold 201', h.status === 201, `got ${h.status}`);
  const resId = h.data?.reservation?.id;

  psql(`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE id = '${resId}';`);

  const replay = await hold(s.user, s.showId, key, body.seatIds);
  c.expect('replay 409', replay.status === 409, `got ${replay.status} ${JSON.stringify(replay.data)}`);
  c.expect('code RESERVATION_NOT_ACTIVE', replay.data?.error?.code === 'RESERVATION_NOT_ACTIVE', JSON.stringify(replay.data));
  c.expect('details.status EXPIRED', replay.data?.error?.details?.status === 'EXPIRED', JSON.stringify(replay.data));

  const g = await api('GET', `/reservations/${resId}`, { token: s.user.token });
  c.expect('GET shows EXPIRED', g.data?.reservation?.status === 'EXPIRED', `got ${g.data?.reservation?.status}`);
});

// D (M-8): checkout replay only while the booking is payable/live.
const scenD = scenario('D', 'M-8: checkout replay after release => 409 BOOKING_NOT_PAYABLE (CANCELLED)', async (c) => {
  const s = await setup('D', 2);
  const h = await hold(s.user, s.showId, `D-hold-${rnd()}`, [s.seats[0]]);
  const resId = h.data?.reservation?.id;
  const co = await checkout(s.user, resId);
  c.expect('checkout 201', co.status === 201, `got ${co.status}`);
  const bId = co.data?.booking?.id;

  const del = await release(s.user, resId);
  c.expect('release 204', del.status === 204, `got ${del.status}`);

  const co2 = await checkout(s.user, resId);
  c.expect('checkout replay 409', co2.status === 409, `got ${co2.status} ${JSON.stringify(co2.data)}`);
  c.expect('code BOOKING_NOT_PAYABLE', co2.data?.error?.code === 'BOOKING_NOT_PAYABLE', JSON.stringify(co2.data));
  c.expect('details.status CANCELLED', co2.data?.error?.details?.status === 'CANCELLED', JSON.stringify(co2.data));

  const b = await api('GET', `/bookings/${bId}`, { token: s.user.token });
  c.expect('booking reported CANCELLED', b.data?.booking?.status === 'CANCELLED', `got ${b.data?.booking?.status}`);

  // M-8 read side: PENDING_PAYMENT with a dead reservation reports EXPIRED and
  // drops payBefore; while truly pending it reports PENDING_PAYMENT with payBefore.
  const h2 = await hold(s.user, s.showId, `D-hold2-${rnd()}`, [s.seats[1]]);
  const resId2 = h2.data?.reservation?.id;
  const co3 = await checkout(s.user, resId2);
  c.expect('second checkout 201', co3.status === 201, `got ${co3.status}`);
  const bId2 = co3.data?.booking?.id;

  const pending = await api('GET', `/bookings/${bId2}`, { token: s.user.token });
  c.expect('pending read has payBefore', pending.data?.booking?.status === 'PENDING_PAYMENT'
    && typeof pending.data?.booking?.payBefore === 'string',
    JSON.stringify(pending.data?.booking));

  psql(`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE id = '${resId2}';`);

  const dead = await api('GET', `/bookings/${bId2}`, { token: s.user.token });
  c.expect('dead-hold read reports EXPIRED', dead.data?.booking?.status === 'EXPIRED', `got ${dead.data?.booking?.status}`);
  c.expect('dead-hold read has no payBefore', dead.data?.booking?.payBefore === undefined, JSON.stringify(dead.data?.booking));
});

// E (H-2): uuid case handling.
const scenE = scenario('E', 'H-2: uppercase uuid replay => 200 same reservation; mixed-case duplicate seat => 400', async (c) => {
  const s = await setup('E', 2);
  const key = `E-hold-${rnd()}`;
  const upper = [s.seats[0].toUpperCase(), s.seats[1].toUpperCase()];

  const h = await hold(s.user, s.showId, key, upper);
  c.expect('hold with UPPERCASE seatIds 201', h.status === 201, `got ${h.status} ${JSON.stringify(h.data)}`);
  const resId = h.data?.reservation?.id;

  const replay = await hold(s.user, s.showId, key, upper);
  c.expect('uppercase replay 200', replay.status === 200, `got ${replay.status} ${JSON.stringify(replay.data)}`);
  c.expect('same reservation id', replay.data?.reservation?.id === resId, `${replay.data?.reservation?.id} vs ${resId}`);

  const mixed = [s.seats[0].toUpperCase(), s.seats[1].toLowerCase()];
  const replay2 = await hold(s.user, s.showId, key, mixed);
  c.expect('mixed-case replay 200', replay2.status === 200 && replay2.data?.reservation?.id === resId,
    `got ${replay2.status} ${JSON.stringify(replay2.data)}`);

  const dup = await hold(s.user, s.showId, `E-dup-${rnd()}`, [s.seats[0].toUpperCase(), s.seats[0].toLowerCase()]);
  c.expect('case-variant duplicate seat 400', dup.status === 400, `got ${dup.status}`);
  c.expect('duplicate-seat validation message', JSON.stringify(dup.data).includes('Duplicate seat IDs are not allowed'),
    JSON.stringify(dup.data));
});

// F (V-1): cancel in parallel with create/checkout/confirm/release — no 5xx, no deadlocks, invariants hold.
const scenF = scenario('F', 'V-1: cancel racing create/checkout/confirm/release — only 2xx/409, invariants zero, no deadlocks', async (c) => {
  const org = await register('F_org', 'ORGANIZER');
  const userA = await register('F_usrA', 'ATTENDEE');
  const userB = await register('F_usrB', 'ATTENDEE');
  const ROUNDS = 30;
  const deadlocksBefore = deadlockCount();
  const bad = [];

  for (let round = 1; round <= ROUNDS; round++) {
    const venueId = await createVenue(org, 2);
    const ev = await api('POST', '/events', { token: org.token, body: { title: `F${round}`, category: 'MUSIC' } });
    const eventId = ev.data.id;
    const showId = await createShow(org, eventId, venueId);
    await api('POST', `/events/${eventId}/publish`, { token: org.token });
    const [s0, s1] = await seatIds(showId);

    const track = (tag, p) => p.then((r) => ({ tag, status: r.status, data: r.data }));

    // wave 1: cancel vs create-reservation
    const w1 = await Promise.all([
      track('cancel1', cancelEvent(org, eventId)),
      track('createA', hold(userA, showId, `F${round}-A-${rnd()}`, [s0, s1])),
    ]);
    const created = w1.find((r) => r.tag === 'createA' && (r.status === 201 || r.status === 200));
    const resId = created?.data?.reservation?.id;

    // wave 2: cancel vs checkout vs release vs second create
    const w2 = await Promise.all([
      track('cancel2', cancelEvent(org, eventId)),
      ...(resId ? [track('checkout1', checkout(userA, resId)), track('release1', release(userA, resId))] : []),
      track('createB', hold(userB, showId, `F${round}-B-${rnd()}`, [s0])),
    ]);
    const checked = w2.find((r) => r.tag === 'checkout1' && (r.status === 201 || r.status === 200));
    const bId = checked?.data?.booking?.id;

    // wave 3: cancel vs confirm-mock vs release vs checkout
    const w3 = await Promise.all([
      track('cancel3', cancelEvent(org, eventId)),
      ...(bId ? [track('confirm', confirmMock(userA, bId))] : []),
      ...(resId ? [track('release2', release(userA, resId)), track('checkout2', checkout(userA, resId))] : []),
    ]);

    for (const r of [...w1, ...w2, ...w3]) {
      const okStatus = (r.status >= 200 && r.status < 300) || r.status === 409;
      if (!okStatus) bad.push(`round ${round} ${r.tag} => ${r.status} ${JSON.stringify(r.data)}`);
    }

    const violations = checkInvariants();
    if (violations.length > 0) bad.push(`round ${round} invariants: ${violations.join(' | ')}`);
  }

  for (const b of bad.slice(0, 20)) console.log(`   ! ${b}`);
  if (bad.length > 20) console.log(`   ! … ${bad.length - 20} more`);
  c.expect(`all ${ROUNDS} rounds only 2xx/409 + zero invariant rows`, bad.length === 0, `${bad.length} problems`);

  const deadlocksAfter = deadlockCount();
  c.expect('no "deadlock detected" in postgres logs', deadlocksAfter === deadlocksBefore,
    `before=${deadlocksBefore} after=${deadlocksAfter}`);
});

// ---------------------------------------------------------------------------

async function main() {
  console.log(`verify-batch1 against ${BASE_URL}`);
  await runScenario(scenA);
  await runScenario(scenB);
  await runScenario(scenC);
  await runScenario(scenD);
  await runScenario(scenE);
  await runScenario(scenF);

  console.log('\n========================================');
  for (const r of results) console.log(`Scenario ${r.id}: ${r.ok ? 'PASS' : 'FAIL'}`);
  console.log('========================================');
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error during verify-batch1:', err);
  process.exit(1);
});
