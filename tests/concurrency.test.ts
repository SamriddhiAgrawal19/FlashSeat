/**
 * Concurrency suite — ports scripts/verify-batch1.mjs scenario F (lock hierarchy:
 * cancel racing create/checkout/confirm/release) and the smoke scripts'
 * contention / idempotency / checkout-race / confirm-race / confirm-vs-release
 * scenarios. Asserts zero 5xx and zero invariant rows after every race round.
 */
import { describe, expect, it } from 'vitest';
import {
  api, cancelEvent, checkout, confirmMock, createShowAt, hold, invariantViolations,
  register, release, setupShow, type User,
} from './helpers';

const rnd = () => Math.random().toString(36).slice(2, 8);

function assertOkStatuses(results: Array<{ tag: string; status: number }>) {
  for (const r of results) {
    expect(r.status, `${r.tag} returned ${r.status}`).toBeLessThan(500);
    const ok = (r.status >= 200 && r.status < 300) || r.status === 409;
    expect(ok, `${r.tag} returned ${r.status}`).toBe(true);
  }
}

describe('V-1 lock hierarchy under cancellation', () => {
  it('F: 30 rounds of cancel racing create/checkout/confirm/release — only 2xx/409, zero invariant rows', async () => {
    const org = await register('conF_org', { role: 'ORGANIZER' });
    const userA = await register('conF_A');
    const userB = await register('conF_B');

    for (let round = 1; round <= 30; round++) {
      const venue = await api('POST', '/venues', {
        token: org.token,
        body: { name: `F ${rnd()}`, address: '1 Way', city: 'Ville' },
      });
      await api('POST', `/venues/${venue.data.id}/seats/bulk`, {
        token: org.token,
        body: { mode: 'GRID', section: 'MAIN', rows: ['A'], seatsPerRow: 2, category: 'REGULAR' },
      });
      const ev = await api('POST', '/events', { token: org.token, body: { title: `F${round}`, category: 'MUSIC' } });
      const show = await createShowAt(org, ev.data.id, venue.data.id, Date.now() + 5 * 86400_000);
      await api('POST', `/events/${ev.data.id}/publish`, { token: org.token });
      const showId: string = show.data.id;
      const map = await api('GET', `/shows/${showId}/seats`);
      const [s0, s1]: string[] = map.data.sections
        .flatMap((x: any) => x.rows.flatMap((y: any) => y.seats)).map((z: any) => z.id);

      const track = (tag: string, p: Promise<{ status: number; data: any }>) =>
        p.then((r) => ({ tag, ...r }));

      // wave 1: cancel vs create-reservation
      const w1 = await Promise.all([
        track('cancel1', cancelEvent(org, ev.data.id)),
        track('createA', hold(userA, showId, `F${round}A-${rnd()}`, [s0, s1])),
      ]);
      const createdA = w1.find((r) => r.tag === 'createA')!;
      const activeResId: string | undefined =
        createdA.status === 201 ? createdA.data.reservation.id : undefined;

      // wave 2: cancel vs checkout vs release vs second create
      const w2 = await Promise.all([
        track('cancel2', cancelEvent(org, ev.data.id)),
        ...(activeResId ? [track('checkout1', checkout(userA, activeResId)), track('release1', release(userA, activeResId))] : []),
        track('createB', hold(userB, showId, `F${round}B-${rnd()}`, [s0])),
      ]);
      const co1 = w2.find((r) => r.tag === 'checkout1');
      const bId: string | undefined =
        co1 && (co1.status === 200 || co1.status === 201) ? co1.data.booking.id : undefined;

      // wave 3: cancel vs confirm-mock vs release vs checkout
      const w3 = await Promise.all([
        track('cancel3', cancelEvent(org, ev.data.id)),
        ...(bId ? [track('confirm', confirmMock(userA, bId))] : []),
        ...(activeResId ? [track('release2', release(userA, activeResId)), track('checkout2', checkout(userA, activeResId))] : []),
      ]);

      assertOkStatuses([...w1, ...w2, ...w3]);
      expect(await invariantViolations(), `round ${round}`).toEqual([]);
    }
  });
});

describe('smoke: contention and idempotent replay', () => {
  it('20 users race for one seat => exactly one 201, nineteen 409 SEATS_UNAVAILABLE', async () => {
    const s = await setupShow('conOne', 3);
    const users: User[] = [];
    for (let i = 0; i < 20; i++) users.push(await register(`conOne${i}`));
    const results = await Promise.all(
      users.map((u) => hold(u, s.showId, `one-${rnd()}`, [s.seatIds[0]]))
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const losers = results.filter((r) => r.status === 409);
    expect(losers).toHaveLength(19);
    for (const r of losers) expect(r.data.error.code).toBe('SEATS_UNAVAILABLE');
  });

  it('[A,B,C] vs [C,B,A] seat sets (30 rounds): one winner, one 409, zero 5xx', async () => {
    const s = await setupShow('conOrder', 3);
    const u1 = await register('conOrder1');
    const u2 = await register('conOrder2');
    const [a, b, c] = s.seatIds;
    for (let round = 1; round <= 30; round++) {
      const [r1, r2] = await Promise.all([
        hold(u1, s.showId, `ord1-${round}-${rnd()}`, [a, b, c]),
        hold(u2, s.showId, `ord2-${round}-${rnd()}`, [c, b, a]),
      ]);
      assertOkStatuses([{ tag: 'forward', status: r1.status }, { tag: 'reverse', status: r2.status }]);
      const codes = [r1.status, r2.status].sort((x, y) => x - y);
      expect(codes, `round ${round}`).toEqual([201, 409]);
      const winner = r1.status === 201 ? r1 : r2;
      await release(r1.status === 201 ? u1 : u2, winner.data.reservation.id);
    }
  });

  it('10 identical parallel creates (one Idempotency-Key) => one reservation id, all 2xx', async () => {
    const s = await setupShow('conIdem', 2);
    const u = await register('conIdem1');
    const key = `idem-${rnd()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => hold(u, s.showId, key, [s.seatIds[0], s.seatIds[1]]))
    );
    for (const r of results) expect([200, 201]).toContain(r.status);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const ids = new Set(results.map((r) => r.data?.reservation?.id));
    expect(ids.size).toBe(1);
  });
});

describe('smoke: checkout and confirmation races', () => {
  it('10 parallel checkouts => one 201, nine 200 replays, one booking id', async () => {
    const s = await setupShow('conCo', 2);
    const h = await hold(s.user, s.showId, `co-${rnd()}`, [s.seatIds[0], s.seatIds[1]]);
    const resId = h.data.reservation.id;
    const results = await Promise.all(Array.from({ length: 10 }, () => checkout(s.user, resId)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(9);
    expect(new Set(results.map((r) => r.data.booking.id)).size).toBe(1);
  });

  it('10 parallel confirm-mock => all 200 CONFIRMED, seats BOOKED, tickets not duplicated', async () => {
    const s = await setupShow('conCf', 2);
    const h = await hold(s.user, s.showId, `cf-${rnd()}`, [s.seatIds[0], s.seatIds[1]]);
    const co = await checkout(s.user, h.data.reservation.id);
    const bId = co.data.booking.id;
    const results = await Promise.all(Array.from({ length: 10 }, () => confirmMock(s.user, bId)));
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.data.booking.status).toBe('CONFIRMED');
    }
    const seats = (await api('GET', `/shows/${s.showId}/seats`)).data.sections
      .flatMap((x: any) => x.rows.flatMap((y: any) => y.seats));
    for (const id of s.seatIds) expect(seats.find((z: any) => z.id === id).status).toBe('BOOKED');
    expect(await invariantViolations()).toEqual([]);
  });

  it('confirm-mock vs DELETE (20 rounds): always one winner; state stays consistent', async () => {
    for (let round = 1; round <= 20; round++) {
      const s = await setupShow(`conRace${round}`, 1);
      const h = await hold(s.user, s.showId, `race-${round}-${rnd()}`, [s.seatIds[0]]);
      const resId = h.data.reservation.id;
      const co = await checkout(s.user, resId);
      const bId = co.data.booking.id;

      const [cf, del] = await Promise.all([
        confirmMock(s.user, bId).then((r) => ({ tag: 'confirm', status: r.status, body: r.data })),
        release(s.user, resId).then((r) => ({ tag: 'delete', status: r.status })),
      ]);
      assertOkStatuses([cf, del]);

      const outcome1 = cf.status === 200 && del.status === 409;
      const outcome2 = cf.status === 409 && del.status === 204;
      expect(outcome1 || outcome2, `round ${round}: confirm=${cf.status} delete=${del.status}`).toBe(true);

      const b = await api('GET', `/bookings/${bId}`, { token: s.user.token });
      const seat = (await api('GET', `/shows/${s.showId}/seats`)).data.sections
        .flatMap((x: any) => x.rows.flatMap((y: any) => y.seats))
        .find((z: any) => z.id === s.seatIds[0]);
      if (outcome1) {
        expect(b.data.booking.status).toBe('CONFIRMED');
        expect(seat.status).toBe('BOOKED');
      } else {
        expect(b.data.booking.status).toBe('CANCELLED');
        expect(seat.status).toBe('AVAILABLE');
      }
      expect(await invariantViolations(), `round ${round}`).toEqual([]);
    }
  });
});
