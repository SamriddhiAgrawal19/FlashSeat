/**
 * Robustness suite — ports scripts/verify-batch2.mjs (H-3, M-7, L-8, M-9, L-5
 * plus response hygiene). Row locks are held via background pg transactions and
 * time is shifted via SQL — no real long sleeps.
 */
import { describe, expect, it } from 'vitest';
import {
  api, checkout, email, hold, holdRowLock, hasErrorShape, invariantViolations,
  register, setupShow, sleep, terminateApiBackends, createShowAt,
} from './helpers';

const LOCK_TIMEOUT_MS = Number(process.env.DB_LOCK_TIMEOUT_MS || 1000);
const RESPONSE_BUDGET_MS = LOCK_TIMEOUT_MS + 3000;

// non-2xx booking-path responses collected by A and C for the hygiene checks
type Sample = Awaited<ReturnType<typeof api>> & { tag?: string };
const hygieneSamples: Sample[] = [];

describe('H-3 / M-7 / L-8: pool and connection resilience', () => {
  it('A: a held row lock cannot wedge the pool (fast 409 LOCK_TIMEOUT, /health alive)', async () => {
    const s = await setupShow('robA');
    const h = await hold(s.user, s.showId, `robA-${Date.now()}`, [s.seatIds[0]]);
    expect(h.status).toBe(201);
    const resId = h.data.reservation.id;

    const blocker = holdRowLock(`SELECT id FROM reservations WHERE id = '${resId}' FOR UPDATE`);
    await sleep(700); // let the blocker take the lock

    const healthP = api('GET', '/health');
    const loginP = api('POST', '/auth/login', { body: { email: email('nx'), password: 'x' } });
    const t0 = Date.now();
    const checkouts = await Promise.all([
      ...Array.from({ length: 15 }, () => checkout(s.user, resId)),
      healthP.then((r) => ({ health: r })),
      loginP.then((r) => ({ login: r })),
    ] as any[]);
    const wallMs = Date.now() - t0;

    const checkoutResults = checkouts.filter((r: any) => !r.health && !r.login) as any[];
    const health = (checkouts.find((r: any) => r.health) as any).health;
    const login = (checkouts.find((r: any) => r.login) as any).login;

    // every response must arrive within the lock-timeout budget — no pool wedge
    expect(wallMs).toBeLessThanOrEqual(RESPONSE_BUDGET_MS);

    for (const r of checkoutResults) hygieneSamples.push(r);

    expect(health.status).toBe(200);
    expect(login.status).toBe(401);
    for (const r of checkoutResults) {
      expect(r.status).toBe(409);
      expect(r.data?.error?.code).toBe('LOCK_TIMEOUT');
    }

    await blocker.done;
    const after = await checkout(s.user, resId);
    expect(after.status).toBe(201);
  });

  it('B: killing idle backends logs but keeps the process alive', async () => {
    const s = await setupShow('robB', 2);
    await Promise.all(Array.from({ length: 10 }, () => api('GET', '/bookings/mine', { token: s.user.token })));

    await terminateApiBackends();
    await sleep(1000);

    expect((await api('GET', '/health')).status).toBe(200);
    expect((await api('GET', '/bookings/mine', { token: s.user.token })).status).toBe(200);
  });

  it('C: backend killed mid-checkout => mapped 503/409 (never plain 500), pool recovers', async () => {
    const s = await setupShow('robC');
    const h = await hold(s.user, s.showId, `robC-${Date.now()}`, [s.seatIds[0]]);
    const resId = h.data.reservation.id;

    const blocker = holdRowLock(`SELECT id FROM reservations WHERE id = '${resId}' FOR UPDATE`);
    await sleep(700);

    const checkoutP = checkout(s.user, resId);
    await sleep(300);
    await terminateApiBackends();

    const r = await checkoutP;
    hygieneSamples.push(r);
    expect(r.status).not.toBe(500);
    const ok =
      (r.status === 503 && r.data?.error?.code === 'DB_UNAVAILABLE') ||
      (r.status === 409 && r.data?.error?.code === 'LOCK_TIMEOUT');
    expect(ok).toBe(true);

    await sleep(200);
    expect((await api('GET', '/health')).status).toBe(200);
    expect((await api('GET', '/bookings/mine', { token: s.user.token })).status).toBe(200);

    await blocker.done;
  });

  it('D: error responses carry error.code, Retry-After on retries, and leak nothing', () => {
    const non2xx = hygieneSamples.filter((r) => r.status >= 300);
    expect(non2xx.length).toBeGreaterThan(0);
    const RETRYABLE = new Set(['RETRYABLE_CONFLICT', 'LOCK_TIMEOUT']);
    for (const r of non2xx) {
      expect(hasErrorShape(r.data)).toBe(true);
      expect(typeof r.data.error.code).toBe('string');
      if (r.status === 503 || (r.status === 409 && RETRYABLE.has(r.data.error.code))) {
        expect(r.retryAfter).toBe('1');
      }
      const body = r.bodyText.toLowerCase();
      for (const leak of ['pg_', 'relation', 'constraint', 'users_email_key', 'no_venue_overlap']) {
        expect(body).not.toContain(leak);
      }
    }
  });
});

describe('M-9: register race maps to the pre-check error', () => {
  it('E: 10 parallel registers with one email => 1x201 + 9x409 EMAIL_TAKEN, zero 5xx', async () => {
    for (let round = 1; round <= 3; round++) {
      const mail = email(`robE${round}`);
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          api('POST', '/auth/register', {
            body: { name: 'Race', email: mail, password: 'Passw0rd!123', role: 'ATTENDEE' },
          })
        )
      );
      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      const conflicts = responses.filter((r) => r.status === 409);
      expect(conflicts).toHaveLength(9);
      for (const r of conflicts) expect(r.data?.error?.code).toBe('EMAIL_TAKEN');
      expect(responses.filter((r) => r.status !== 201 && r.status !== 409)).toHaveLength(0);
    }
  });
});

describe('L-5: overlapping createShow cannot deadlock', () => {
  it('F: 50 rounds of 2 parallel overlapping createShow => 1x201 + 1x409, zero 5xx', async () => {
    const org = await register('robF_org', { role: 'ORGANIZER' });
    const venue = await api('POST', '/venues', {
      token: org.token,
      body: { name: 'RobF Arena', address: '1 Way', city: 'Ville' },
    });
    await api('POST', `/venues/${venue.data.id}/seats/bulk`, {
      token: org.token,
      body: { mode: 'GRID', section: 'MAIN', rows: ['A'], seatsPerRow: 3, category: 'REGULAR' },
    });
    const ev = await api('POST', '/events', { token: org.token, body: { title: 'RobF', category: 'MUSIC' } });

    for (let round = 1; round <= 50; round++) {
      const base = Date.now() + round * 86400_000;
      const [r1, r2] = await Promise.all([
        createShowAt(org, ev.data.id, venue.data.id, base + 10 * 3600_000),
        createShowAt(org, ev.data.id, venue.data.id, base + 11 * 3600_000), // overlaps
      ]);
      const codes = [r1.status, r2.status].sort((a, b) => a - b);
      expect(codes, `round ${round}: ${r1.status}/${r2.status}`).toEqual([201, 409]);
      expect(r1.status).toBeLessThan(500);
      expect(r2.status).toBeLessThan(500);
    }
  });
});

describe('invariants', () => {
  it('the whole database satisfies the 9 invariants at rest', async () => {
    expect(await invariantViolations()).toEqual([]);
  });
});
