/**
 * Sweeper tests — calls the sweeper directly against a running API + DB.
 * Time is shifted via SQL (expireReservation helper), never by mocking Date.
 *
 * Exact global counts: beforeEach moves every live hold left by earlier tests or
 * runs into the past and drains it, and files run serially, so a sweep only sees
 * the current test's data. (Without the first step, a hold from a run ~10 min
 * earlier reaching its real HOLD_DURATION_SECONDS expiry mid-test is swept too:
 * observed as reservationsExpired 29 instead of 25 in E on back-to-back runs.)
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  cancelEvent,
  checkout,
  confirmMock,
  db,
  drainSweeper,
  expireAllLiveHolds,
  expireReservation,
  hold,
  holdRowLock,
  invariantViolations,
  register,
  release,
  setupShow,
  sleep,
} from './helpers';

import { runSweepOnce, sweepOnceInternal, type SweepResult } from '../src/modules/sweeper/sweeper.service';

const rnd = () => Math.random().toString(36).slice(2, 8);

// Sweeper invariant queries (match scripts/check-sweeper-invariants.sql)
const SWEEPER_INVARIANT_QUERIES: string[] = [
  `SELECT id FROM reservations WHERE status = 'ACTIVE' AND expires_at < now() - interval '1 minute'`,
  `SELECT id FROM show_seats WHERE status = 'HELD' AND held_until < now() - interval '1 minute'`,
  `SELECT b.id FROM bookings b JOIN reservations r ON r.id = b.reservation_id
    WHERE b.status = 'PENDING_PAYMENT' AND r.status IN ('EXPIRED', 'RELEASED')`,
];

async function sweeperInvariantViolations(): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < SWEEPER_INVARIANT_QUERIES.length; i++) {
    const rows = await db(SWEEPER_INVARIANT_QUERIES[i]);
    if (rows.length > 0) out.push(`sweeper query #${i + 1}: ${rows.length} row(s)`);
  }
  return out;
}

/** Number of "deadlock detected" lines in the postgres container log so far. */
function deadlockLogCount(): number {
  const out = execFileSync(process.env.DOCKER_BIN || 'docker', ['compose', 'logs', '--no-color', 'postgres'], {
    encoding: 'utf8',
    cwd: join(__dirname, '..'),
    maxBuffer: 256 * 1024 * 1024,
  });
  return out.split('\n').filter((l) => l.includes('deadlock detected')).length;
}

const sortedSeats = (ids: string[]) => [...ids].sort();

type Counts = Omit<SweepResult, 'skippedBecauseRunning'>;
const counts = (r: SweepResult): Counts => ({
  shows: r.shows,
  reservationsExpired: r.reservationsExpired,
  bookingsExpired: r.bookingsExpired,
  seatsFreed: r.seatsFreed,
  skippedShows: r.skippedShows,
  errors: r.errors,
});

describe('sweeper', () => {
  // Expire and drain all state left by earlier test files/runs so each test
  // starts from a clean baseline (no live holds anywhere) and can assert exact counts.
  beforeEach(async () => {
    await expireAllLiveHolds();
    await drainSweeper();
  });

  it('A: expired reservation+booking -> EXPIRED, seats AVAILABLE', async () => {
    const s = await setupShow('swA', 2);
    const h = await hold(s.user, s.showId, `swA-${rnd()}`, [s.seatIds[0], s.seatIds[1]]);
    expect(h.status).toBe(201);
    const resId = h.data.reservation.id;

    // Checkout to create a booking
    const co = await checkout(s.user, resId);
    expect(co.status).toBe(201);

    // Expire via SQL
    await expireReservation(resId);

    const result = await runSweepOnce();
    expect(counts(result)).toEqual({
      shows: 1, reservationsExpired: 1, bookingsExpired: 1, seatsFreed: 2, skippedShows: 0, errors: 0,
    });

    // Verify DB state
    const [res] = await db<{ status: string }>('SELECT status FROM reservations WHERE id = $1', [resId]);
    expect(res.status).toBe('EXPIRED');

    const [bk] = await db<{ status: string }>('SELECT status FROM bookings WHERE reservation_id = $1', [resId]);
    expect(bk.status).toBe('EXPIRED');

    const seats = await db<{ status: string; reservation_id: string | null; held_until: Date | null }>(
      'SELECT status, reservation_id, held_until FROM show_seats WHERE id = ANY($1::uuid[])',
      [[s.seatIds[0], s.seatIds[1]]]
    );
    for (const seat of seats) {
      expect(seat.status).toBe('AVAILABLE');
      expect(seat.reservation_id).toBeNull();
      expect(seat.held_until).toBeNull();
    }
  });

  it('B: takeover — B\'s live hold and pending booking untouched, A\'s leftovers cleaned', async () => {
    // seat ids sorted the way the sweeper orders them (ORDER BY id)
    const s = await setupShow('swB', 3);
    const [lo1, lo2, hi] = sortedSeats(s.seatIds);
    const userB = await register('swB_b');

    // A holds all three seats, then A's hold expires
    const hA = await hold(s.user, s.showId, `swB-A-${rnd()}`, [lo1, lo2, hi]);
    expect(hA.status).toBe(201);
    const resAId = hA.data.reservation.id;
    await expireReservation(resAId);

    // B takes over the two lowest seats (lazy expiry lets B grab them) and checks
    // out. A takeover by ANOTHER user does not touch A's reservation row, and
    // A's third seat stays HELD with an expired held_until.
    const hB = await hold(userB, s.showId, `swB-B-${rnd()}`, [lo1, lo2]);
    expect(hB.status).toBe(201);
    const resBId = hB.data.reservation.id;
    const coB = await checkout(userB, resBId);
    expect(coB.status).toBe(201);

    // batchSize 2 = number of ACTIVE reservations in the show = number of B's
    // live HELD seats that sort before A's expired one. If the expiry filters
    // were dropped from the lock queries, the batch would be filled with B's
    // live rows: B's pending booking would be expired and `hi` never freed.
    const result = await runSweepOnce({ batchSize: 2, maxRunMs: 3000 });
    expect(counts(result)).toEqual({
      shows: 1, reservationsExpired: 1, bookingsExpired: 0, seatsFreed: 1, skippedShows: 0, errors: 0,
    });

    const [resA] = await db<{ status: string }>('SELECT status FROM reservations WHERE id = $1', [resAId]);
    expect(resA.status).toBe('EXPIRED');

    // B's reservation, booking and seats must be untouched
    const [resB] = await db<{ status: string }>('SELECT status FROM reservations WHERE id = $1', [resBId]);
    expect(resB.status).toBe('ACTIVE');
    const [bkB] = await db<{ status: string }>('SELECT status FROM bookings WHERE id = $1', [coB.data.booking.id]);
    expect(bkB.status).toBe('PENDING_PAYMENT');
    const seatsB = await db<{ status: string; reservation_id: string }>(
      'SELECT status, reservation_id FROM show_seats WHERE id = ANY($1::uuid[])', [[lo1, lo2]]
    );
    for (const seat of seatsB) {
      expect(seat.status).toBe('HELD');
      expect(seat.reservation_id).toBe(resBId);
    }

    // A's leftover seat freed
    const [seatHi] = await db<{ status: string; reservation_id: string | null }>(
      'SELECT status, reservation_id FROM show_seats WHERE id = $1', [hi]
    );
    expect(seatHi.status).toBe('AVAILABLE');
    expect(seatHi.reservation_id).toBeNull();
  });

  it('C: lazy leftovers — old seats still HELD after API expired the reservation -> sweep frees them', async () => {
    const s = await setupShow('swC', 2);

    // Hold seat 0
    const hOld = await hold(s.user, s.showId, `swC-old-${rnd()}`, [s.seatIds[0]]);
    expect(hOld.status).toBe(201);
    const oldResId = hOld.data.reservation.id;

    // Expire the reservation (and its seats' held_until)
    await expireReservation(oldResId);

    // Create a NEW hold on a different seat — this triggers lazy expiry on the
    // reservation (API marks it EXPIRED), but does NOT free old seats
    const hNew = await hold(s.user, s.showId, `swC-new-${rnd()}`, [s.seatIds[1]]);
    expect(hNew.status).toBe(201);

    // Verify old reservation is EXPIRED (by the API lazily)
    const [oldRes] = await db<{ status: string }>('SELECT status FROM reservations WHERE id = $1', [oldResId]);
    expect(oldRes.status).toBe('EXPIRED');

    // But old seat is still HELD with expired held_until
    const [oldSeat] = await db<{ status: string }>('SELECT status FROM show_seats WHERE id = $1', [s.seatIds[0]]);
    expect(oldSeat.status).toBe('HELD');

    // Sweep frees exactly the old seat; the reservation was already EXPIRED
    const result = await runSweepOnce();
    expect(counts(result)).toEqual({
      shows: 1, reservationsExpired: 0, bookingsExpired: 0, seatsFreed: 1, skippedShows: 0, errors: 0,
    });

    const [freedSeat] = await db<{ status: string; reservation_id: string | null; held_until: Date | null }>(
      'SELECT status, reservation_id, held_until FROM show_seats WHERE id = $1', [s.seatIds[0]]
    );
    expect(freedSeat.status).toBe('AVAILABLE');
    expect(freedSeat.reservation_id).toBeNull();
    expect(freedSeat.held_until).toBeNull();

    // The new hold is untouched
    const [newSeat] = await db<{ status: string }>('SELECT status FROM show_seats WHERE id = $1', [s.seatIds[1]]);
    expect(newSeat.status).toBe('HELD');
  });

  it('D: live holds, pending bookings, CONFIRMED bookings and BOOKED seats are never touched', async () => {
    // seat ids sorted the way the sweeper orders them (ORDER BY id)
    const s = await setupShow('swD', 6);
    const [s0, s1, s2, s3, s4, s5] = sortedSeats(s.seatIds);

    // Live hold on s0, s1
    const hLive = await hold(s.user, s.showId, `swD-live-${rnd()}`, [s0, s1]);
    expect(hLive.status).toBe(201);
    const liveResId = hLive.data.reservation.id;

    // Live pending booking on s2
    const userP = await register('swD_p');
    const hPend = await hold(userP, s.showId, `swD-pend-${rnd()}`, [s2]);
    expect(hPend.status).toBe(201);
    const coP = await checkout(userP, hPend.data.reservation.id);
    expect(coP.status).toBe(201);

    // Confirmed booking on s3, s4
    const userC = await register('swD_c');
    const hConf = await hold(userC, s.showId, `swD-conf-${rnd()}`, [s3, s4]);
    expect(hConf.status).toBe(201);
    const co = await checkout(userC, hConf.data.reservation.id);
    expect(co.status).toBe(201);
    const cf = await confirmMock(userC, co.data.booking.id);
    expect(cf.status).toBe(200);

    // One expired hold on the highest seat, so the show is a sweep candidate
    const userX = await register('swD_x');
    const hExp = await hold(userX, s.showId, `swD-exp-${rnd()}`, [s5]);
    expect(hExp.status).toBe(201);
    const expResId = hExp.data.reservation.id;
    await expireReservation(expResId);

    // batchSize 3 = ACTIVE reservations in the show = live HELD seats sorting
    // before s5: without the expiry filters the batch fills with live rows.
    const result = await runSweepOnce({ batchSize: 3, maxRunMs: 3000 });
    expect(counts(result)).toEqual({
      shows: 1, reservationsExpired: 1, bookingsExpired: 0, seatsFreed: 1, skippedShows: 0, errors: 0,
    });

    // Live hold untouched
    const [liveRes] = await db<{ status: string }>('SELECT status FROM reservations WHERE id = $1', [liveResId]);
    expect(liveRes.status).toBe('ACTIVE');
    const liveSeats = await db<{ status: string }>(
      'SELECT status FROM show_seats WHERE id = ANY($1::uuid[])', [[s0, s1]]
    );
    expect(liveSeats.map((r) => r.status)).toEqual(['HELD', 'HELD']);

    // Pending booking untouched
    const [pend] = await db<{ status: string }>('SELECT status FROM bookings WHERE id = $1', [coP.data.booking.id]);
    expect(pend.status).toBe('PENDING_PAYMENT');
    const [pendSeat] = await db<{ status: string }>('SELECT status FROM show_seats WHERE id = $1', [s2]);
    expect(pendSeat.status).toBe('HELD');

    // Confirmed booking untouched
    const [bk] = await db<{ status: string }>('SELECT status FROM bookings WHERE id = $1', [co.data.booking.id]);
    expect(bk.status).toBe('CONFIRMED');
    const bookedSeats = await db<{ status: string }>(
      'SELECT status FROM show_seats WHERE id = ANY($1::uuid[])', [[s3, s4]]
    );
    expect(bookedSeats.map((r) => r.status)).toEqual(['BOOKED', 'BOOKED']);

    // Only the expired hold was cleaned
    const [expRes] = await db<{ status: string }>('SELECT status FROM reservations WHERE id = $1', [expResId]);
    expect(expRes.status).toBe('EXPIRED');
    const [expSeat] = await db<{ status: string }>('SELECT status FROM show_seats WHERE id = $1', [s5]);
    expect(expSeat.status).toBe('AVAILABLE');
  });

  it('E: batching — 25 expired reservations with batch=10, one runSweepOnce drains all', async () => {
    const org = await register('swE_org', { role: 'ORGANIZER' });
    const venue = await api('POST', '/venues', {
      token: org.token,
      body: { name: `swE Arena ${rnd()}`, address: '1 Way', city: 'Ville' },
    });
    await api('POST', `/venues/${venue.data.id}/seats/bulk`, {
      token: org.token,
      body: { mode: 'GENERAL_ADMISSION', section: 'GA', count: 25, category: 'REGULAR' },
    });
    const ev = await api('POST', '/events', { token: org.token, body: { title: 'swE Event', category: 'MUSIC' } });
    const show = await api('POST', `/events/${ev.data.id}/shows`, {
      token: org.token,
      body: {
        venueId: venue.data.id,
        startsAt: new Date(Date.now() + 5 * 86400_000).toISOString(),
        endsAt: new Date(Date.now() + 5 * 86400_000 + 7200_000).toISOString(),
        categoryPrices: [{ category: 'REGULAR', pricePaise: 10000 }],
      },
    });
    await api('POST', `/events/${ev.data.id}/publish`, { token: org.token });

    const map = await api('GET', `/shows/${show.data.id}/seats`);
    const allSeatIds: string[] = map.data.sections
      .flatMap((s: any) => s.rows.flatMap((r: any) => r.seats))
      .map((s: any) => s.id);

    // Create 25 holds, each with 1 seat, then expire them all
    const resIds: string[] = [];
    for (let i = 0; i < 25; i++) {
      const u = await register(`swE_u${i}`);
      const h = await hold(u, show.data.id, `swE-${i}-${rnd()}`, [allSeatIds[i]]);
      expect(h.status).toBe(201);
      resIds.push(h.data.reservation.id);
    }

    for (const resId of resIds) {
      await expireReservation(resId);
    }

    // batchSize=10 means each show-transaction handles at most 10 rows, but
    // the outer loop re-discovers the show and keeps going until drained.
    const result = await runSweepOnce({ batchSize: 10 });
    expect(result.reservationsExpired).toBe(25);
    expect(result.seatsFreed).toBe(25);

    // Verify nothing expired remains
    const remaining = await db<{ id: string }>(
      `SELECT id FROM reservations WHERE show_id = $1 AND status = 'ACTIVE'`, [show.data.id]
    );
    expect(remaining).toHaveLength(0);
    const heldSeats = await db<{ id: string }>(
      `SELECT id FROM show_seats WHERE show_id = $1 AND status = 'HELD'`, [show.data.id]
    );
    expect(heldSeats).toHaveLength(0);
  });

  it('F: two truly concurrent sweeps on the same data — no errors, no deadlock, no double counting', async () => {
    // 3 shows x 4 one-seat holds, 2 of each show's holds checked out
    const SHOWS = 3;
    const HOLDS = 4;
    const resIds: string[] = [];
    for (let k = 0; k < SHOWS; k++) {
      const s = await setupShow(`swF${k}`, HOLDS);
      for (let i = 0; i < HOLDS; i++) {
        const u = await register(`swF${k}_u${i}`);
        const h = await hold(u, s.showId, `swF-${k}-${i}-${rnd()}`, [s.seatIds[i]]);
        expect(h.status).toBe(201);
        resIds.push(h.data.reservation.id);
        if (i < 2) expect((await checkout(u, h.data.reservation.id)).status).toBe(201);
      }
    }
    for (const resId of resIds) {
      await expireReservation(resId);
    }

    // sweepOnceInternal bypasses the in-process guard, so these really are two
    // sweeps racing on the same rows (what two sweeper processes would do).
    // batchSize 2 splits each show into several short transactions so the two
    // sweeps interleave instead of one finishing before the other starts.
    const [r1, r2] = await Promise.all([sweepOnceInternal({ batchSize: 2 }), sweepOnceInternal({ batchSize: 2 })]);

    // No errors (a deadlock would surface as a caught 40P01 and count here)
    expect(r1.errors).toBe(0);
    expect(r2.errors).toBe(0);
    // FOR SHARE on the show does not conflict with the other sweep's FOR SHARE
    expect(r1.skippedShows + r2.skippedShows).toBe(0);

    // Combined counts equal the real amount: nothing double counted, and nothing
    // skipped by one sweep without being taken by the other
    expect(r1.reservationsExpired + r2.reservationsExpired).toBe(SHOWS * HOLDS);
    expect(r1.bookingsExpired + r2.bookingsExpired).toBe(SHOWS * 2);
    expect(r1.seatsFreed + r2.seatsFreed).toBe(SHOWS * HOLDS);

    const left = await db<{ status: string; n: string }>(
      `SELECT status, count(*) AS n FROM reservations WHERE id = ANY($1::uuid[]) GROUP BY status`, [resIds]
    );
    expect(left).toEqual([{ status: 'EXPIRED', n: String(SHOWS * HOLDS) }]);

    // Invariants hold
    expect(await invariantViolations()).toEqual([]);
    expect(await sweeperInvariantViolations()).toEqual([]);
  });

  it('G: race — sweep vs API operations, 30 rounds', async () => {
    const deadlocksBefore = deadlockLogCount();
    const allSweeps: { tag: string; status: number; data: any }[] = [];

    for (let round = 1; round <= 30; round++) {
      const s = await setupShow(`swG${round}`, 4);
      const userB = await register(`swG${round}_b`);

      // Create some expired state
      const hExpired = await hold(s.user, s.showId, `swG-exp-${round}-${rnd()}`, [s.seatIds[0]]);
      if (hExpired.status === 201) {
        await expireReservation(hExpired.data.reservation.id);
      }

      // Fire sweep + various API operations in parallel
      const track = (tag: string, p: Promise<any>) =>
        p.then((r: any) => ({ tag, status: r?.status ?? 0, data: r?.data })).catch((e: any) => ({ tag, status: -1, data: e }));
      const sweep = (tag: string) => track(tag, runSweepOnce().then((r) => ({ status: 0, data: r })));

      const results = await Promise.all([
        sweep(`sweep r${round}`),
        track('hold', hold(userB, s.showId, `swG-h-${round}-${rnd()}`, [s.seatIds[1]])),
        track('holdSame', hold(s.user, s.showId, `swG-hs-${round}-${rnd()}`, [s.seatIds[2], s.seatIds[3]])),
      ]);
      allSweeps.push(...results.filter((r) => r.tag.startsWith('sweep')));

      // Collect API results
      const apiResults = results.filter((r) => !r.tag.startsWith('sweep'));
      for (const r of apiResults) {
        if (r.status === -1) throw new Error(`${r.tag} threw: ${r.data}`);
        expect(r.status, `${r.tag} round ${round}: ${r.status}`).toBeLessThan(500);
      }

      // Now do checkout/confirm/release on the new holds
      const wave2: Promise<any>[] = [sweep(`sweep2 r${round}`)];
      const holdResult = results.find((r) => r.tag === 'hold');
      const holdSameResult = results.find((r) => r.tag === 'holdSame');

      if (holdResult && holdResult.status === 201) {
        wave2.push(track('co', checkout(userB, holdResult.data.reservation.id)));
      }
      if (holdSameResult && holdSameResult.status === 201) {
        wave2.push(track('rel', release(s.user, holdSameResult.data.reservation.id)));
      }

      const w2 = await Promise.all(wave2);
      allSweeps.push(...w2.filter((r) => r.tag.startsWith('sweep')));
      for (const r of w2.filter((r) => !r.tag.startsWith('sweep'))) {
        if (r.status === -1) throw new Error(`${r.tag} w2 threw: ${r.data}`);
        expect(r.status, `${r.tag} w2 round ${round}: ${r.status}`).toBeLessThan(500);
      }

      // Confirm if checkout succeeded
      const coResult = w2.find((r) => r.tag === 'co');
      if (coResult && (coResult.status === 201 || coResult.status === 200) && coResult.data?.booking?.id) {
        const wave3 = await Promise.all([
          sweep(`sweep3 r${round}`),
          track('confirm', confirmMock(userB, coResult.data.booking.id)),
          track('cancel', cancelEvent(s.org, s.eventId)),
        ]);
        allSweeps.push(...wave3.filter((r) => r.tag.startsWith('sweep')));
        for (const r of wave3.filter((r) => !r.tag.startsWith('sweep'))) {
          if (r.status === -1) throw new Error(`${r.tag} w3 threw: ${r.data}`);
          expect(r.status, `${r.tag} w3 round ${round}: ${r.status}`).toBeLessThan(500);
        }
      }

      // Invariants must hold after each round
      const inv = await invariantViolations();
      expect(inv, `invariants round ${round}`).toEqual([]);
      const sinv = await sweeperInvariantViolations();
      expect(sinv, `sweeper invariants round ${round}`).toEqual([]);
    }

    // EVERY sweep across all rounds and waves resolved (status 0 = did not throw)
    // and reported no per-show errors (a deadlock would be a caught 40P01).
    expect(allSweeps.length).toBeGreaterThanOrEqual(60);
    for (const sr of allSweeps) {
      expect(sr.status, `${sr.tag} threw`).toBe(0);
      expect(sr.data.errors, `${sr.tag} errors`).toBe(0);
    }

    // No deadlock anywhere in the DB (API or sweeper) during these rounds
    expect(deadlockLogCount() - deadlocksBefore).toBe(0);
  });

  it('H: cancelled show with expired holds is cleaned', async () => {
    const s = await setupShow('swH', 2);
    const userH2 = await register('swH_u2');

    // User A holds seat 0
    const hA = await hold(s.user, s.showId, `swH-a-${rnd()}`, [s.seatIds[0]]);
    expect(hA.status).toBe(201);
    const resAId = hA.data.reservation.id;

    // User B holds seat 1 + checks out
    const hB = await hold(userH2, s.showId, `swH-b-${rnd()}`, [s.seatIds[1]]);
    expect(hB.status).toBe(201);
    const resBId = hB.data.reservation.id;
    const co = await checkout(userH2, resBId);
    expect(co.status).toBe(201);

    // Expire both reservations via SQL (shifts time)
    await expireReservation(resAId);
    await expireReservation(resBId);

    // Simulate a cancelled show with stale expired rows: flip ONLY shows.status
    // to CANCELLED. The sweeper must not skip shows because of their status.
    await db(`UPDATE shows SET status = 'CANCELLED' WHERE id = $1`, [s.showId]);

    const result = await runSweepOnce();
    expect(counts(result)).toEqual({
      shows: 1, reservationsExpired: 2, bookingsExpired: 1, seatsFreed: 2, skippedShows: 0, errors: 0,
    });

    // All seats AVAILABLE
    const seats = await db<{ status: string; reservation_id: string | null; held_until: Date | null }>(
      'SELECT status, reservation_id, held_until FROM show_seats WHERE id = ANY($1::uuid[])',
      [[s.seatIds[0], s.seatIds[1]]]
    );
    for (const seat of seats) {
      expect(seat.status).toBe('AVAILABLE');
      expect(seat.reservation_id).toBeNull();
      expect(seat.held_until).toBeNull();
    }

    // Reservation + booking states
    const [resA] = await db<{ status: string }>('SELECT status FROM reservations WHERE id = $1', [resAId]);
    expect(resA.status).toBe('EXPIRED');
    const [resB] = await db<{ status: string }>('SELECT status FROM reservations WHERE id = $1', [resBId]);
    expect(resB.status).toBe('EXPIRED');
    const [bk] = await db<{ status: string }>('SELECT status FROM bookings WHERE reservation_id = $1', [resBId]);
    expect(bk.status).toBe('EXPIRED');

    // The cancelled-show invariants (no HELD seat / ACTIVE reservation /
    // PENDING_PAYMENT booking on a CANCELLED show) hold again after the sweep
    expect(await invariantViolations()).toEqual([]);
  });

  it('H2: cancelEvent API leaves no stale state (no sweep needed)', async () => {
    const s = await setupShow('swH2', 4);
    const u2 = await register('swH2_u2');

    // Active hold
    const hA = await hold(s.user, s.showId, `swH2-a-${rnd()}`, [s.seatIds[0], s.seatIds[1]]);
    expect(hA.status).toBe(201);

    // Checked-out booking
    const hB = await hold(u2, s.showId, `swH2-b-${rnd()}`, [s.seatIds[2]]);
    expect(hB.status).toBe(201);
    const co = await checkout(u2, hB.data.reservation.id);
    expect(co.status).toBe(201);

    // Cancel via API
    const cancel = await cancelEvent(s.org, s.eventId);
    expect(cancel.status).toBe(200);

    // Assert directly: no ACTIVE reservation, HELD seat or PENDING_PAYMENT booking
    const activeRes = await db(
      `SELECT id FROM reservations WHERE show_id = $1 AND status = 'ACTIVE'`, [s.showId]
    );
    expect(activeRes).toHaveLength(0);

    const heldSeats = await db(
      `SELECT id FROM show_seats WHERE show_id = $1 AND status = 'HELD'`, [s.showId]
    );
    expect(heldSeats).toHaveLength(0);

    const pendingBookings = await db(
      `SELECT id FROM bookings WHERE show_id = $1 AND status = 'PENDING_PAYMENT'`, [s.showId]
    );
    expect(pendingBookings).toHaveLength(0);
  });

  it('I: a show locked by someone else is skipped once, not spun on; other shows still cleaned', async () => {
    const sA = await setupShow('swIa', 1);
    const sB = await setupShow('swIb', 1);
    const hA = await hold(sA.user, sA.showId, `swIa-${rnd()}`, [sA.seatIds[0]]);
    expect(hA.status).toBe(201);
    const hB = await hold(sB.user, sB.showId, `swIb-${rnd()}`, [sB.seatIds[0]]);
    expect(hB.status).toBe(201);
    await expireReservation(hA.data.reservation.id);
    await expireReservation(hB.data.reservation.id);

    // Hold show A's row FOR UPDATE (what cancelEvent takes) for longer than the
    // whole sweep budget, and wait until the lock is really held.
    const MAX_RUN_MS = 4000;
    const blocker = holdRowLock(`SELECT id FROM shows WHERE id = '${sA.showId}' FOR UPDATE`, 7);
    for (let i = 0; ; i++) {
      const rows = await db(
        `SELECT 1 FROM pg_stat_activity WHERE state = 'active' AND query LIKE '%pg_sleep%' AND query LIKE $1`,
        [`%${sA.showId}%`]
      );
      if (rows.length > 0) break;
      if (i > 100) throw new Error('row-lock blocker never started');
      await sleep(50);
    }

    try {
      const t0 = Date.now();
      const result = await runSweepOnce({ maxRunMs: MAX_RUN_MS });
      const elapsed = Date.now() - t0;

      // Before the fix the locked show was rediscovered and skipped in a loop
      // until maxRunMs ran out (~4000ms). Now it is skipped exactly once.
      expect(elapsed).toBeLessThan(MAX_RUN_MS / 2);
      expect(counts(result)).toEqual({
        shows: 1, reservationsExpired: 1, bookingsExpired: 0, seatsFreed: 1, skippedShows: 1, errors: 0,
      });

      // Show B cleaned
      const [resB] = await db<{ status: string }>('SELECT status FROM reservations WHERE id = $1', [hB.data.reservation.id]);
      expect(resB.status).toBe('EXPIRED');
      const [seatB] = await db<{ status: string }>('SELECT status FROM show_seats WHERE id = $1', [sB.seatIds[0]]);
      expect(seatB.status).toBe('AVAILABLE');

      // Show A left dirty for a later cycle
      const [resA] = await db<{ status: string }>('SELECT status FROM reservations WHERE id = $1', [hA.data.reservation.id]);
      expect(resA.status).toBe('ACTIVE');
      const [seatA] = await db<{ status: string }>('SELECT status FROM show_seats WHERE id = $1', [sA.seatIds[0]]);
      expect(seatA.status).toBe('HELD');
    } finally {
      await blocker.done;
    }
  });

  it('J: stranded PENDING_PAYMENT booking of a lazily EXPIRED reservation -> booking EXPIRED', async () => {
    const s = await setupShow('swJ', 2);
    const userV = await register('swJ_v');

    // U holds seat 0, checks out, and the hold expires
    const h1 = await hold(s.user, s.showId, `swJ-1-${rnd()}`, [s.seatIds[0]]);
    expect(h1.status).toBe(201);
    const res1Id = h1.data.reservation.id;
    const co = await checkout(s.user, res1Id);
    expect(co.status).toBe(201);
    await expireReservation(res1Id);

    // U holds again on the same show: the API lazily marks res1 EXPIRED
    // (expireStaleActiveReservations) but leaves its booking PENDING_PAYMENT
    const h2 = await hold(s.user, s.showId, `swJ-2-${rnd()}`, [s.seatIds[1]]);
    expect(h2.status).toBe(201);
    // V takes over seat 0, so no expired HELD seat or ACTIVE-but-expired
    // reservation is left: only the stranded booking makes this show dirty
    const hV = await hold(userV, s.showId, `swJ-v-${rnd()}`, [s.seatIds[0]]);
    expect(hV.status).toBe(201);

    const [before] = await db<{ booking: string; reservation: string }>(
      `SELECT b.status AS booking, r.status AS reservation
         FROM bookings b JOIN reservations r ON r.id = b.reservation_id WHERE b.id = $1`,
      [co.data.booking.id]
    );
    expect(before).toEqual({ booking: 'PENDING_PAYMENT', reservation: 'EXPIRED' });
    expect(await sweeperInvariantViolations()).toEqual(['sweeper query #3: 1 row(s)']);

    const result = await runSweepOnce();
    expect(counts(result)).toEqual({
      shows: 1, reservationsExpired: 0, bookingsExpired: 1, seatsFreed: 0, skippedShows: 0, errors: 0,
    });

    const [bk] = await db<{ status: string }>('SELECT status FROM bookings WHERE id = $1', [co.data.booking.id]);
    expect(bk.status).toBe('EXPIRED');

    // Live holds untouched
    const live = await db<{ id: string; status: string }>(
      `SELECT id, status FROM reservations WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[h2.data.reservation.id, hV.data.reservation.id]]
    );
    expect(live.map((r) => r.status)).toEqual(['ACTIVE', 'ACTIVE']);

    expect(await sweeperInvariantViolations()).toEqual([]);
    expect(await invariantViolations()).toEqual([]);
  });
});
