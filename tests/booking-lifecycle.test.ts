/**
 * Booking lifecycle suite — ports scripts/verify-batch1.mjs scenarios A–E
 * (H-1, M-2, M-1, M-8, H-2). Asserts error.code, never message text.
 */
import { describe, expect, it } from 'vitest';
import {
  api, cancelEvent, checkout, confirmMock, createShowAt, db, expireReservation, hold,
  release, setupShow, sleep, startShowNow,
} from './helpers';
import { env } from '../src/config/env';

describe('H-1: confirm re-checks the show', () => {
  it('A: cancel -> confirm-mock => 409 SHOW_NOT_BOOKABLE; pipeline closed', async () => {
    const s = await setupShow('lifeA');
    const h = await hold(s.user, s.showId, `lifeA-${Date.now()}`, [s.seatIds[0], s.seatIds[1]]);
    expect(h.status).toBe(201);
    const resId = h.data.reservation.id;
    const co = await checkout(s.user, resId);
    expect(co.status).toBe(201);
    const bId = co.data.booking.id;

    expect((await cancelEvent(s.org, s.eventId)).status).toBe(200);

    const cf = await confirmMock(s.user, bId);
    expect(cf.status).toBe(409);
    expect(cf.data.error.code).toBe('SHOW_NOT_BOOKABLE');

    const b = await api('GET', `/bookings/${bId}`, { token: s.user.token });
    expect(b.data.booking.status).toBe('CANCELLED');
    const r = await api('GET', `/reservations/${resId}`, { token: s.user.token });
    expect(r.data.reservation.status).toBe('RELEASED');

    // ENABLE_SEAT_MAP_CACHE: the map's own GET during setupShow can still be
    // within its TTL here, so wait past it rather than racing the cache.
    await sleep(env.SEAT_MAP_CACHE_TTL_MS + 250);
    const seats = (await api('GET', `/shows/${s.showId}/seats`)).data.sections
      .flatMap((x: any) => x.rows.flatMap((y: any) => y.seats));
    for (const id of [s.seatIds[0], s.seatIds[1]]) {
      expect(seats.find((z: any) => z.id === id).status).toBe('AVAILABLE');
    }
  });

  it('confirm after the show has started => 409 SHOW_NOT_BOOKABLE (time-shifted)', async () => {
    const s = await setupShow('lifeStart');
    const h = await hold(s.user, s.showId, `lifeStart-${Date.now()}`, [s.seatIds[0]]);
    const co = await checkout(s.user, h.data.reservation.id);
    expect(co.status).toBe(201);

    await startShowNow(s.showId); // starts_at into the past — no real waiting

    const cf = await confirmMock(s.user, co.data.booking.id);
    expect(cf.status).toBe(409);
    expect(cf.data.error.code).toBe('SHOW_NOT_BOOKABLE');
  });
});

describe('M-2: event state machine and cancelEvent', () => {
  it('B: cancel closes holds/pending/confirmed correctly and blocks further actions', async () => {
    const s = await setupShow('lifeB', 2);
    // a CONFIRMED booking
    const h1 = await hold(s.user, s.showId, `lifeB1-${Date.now()}`, [s.seatIds[0]]);
    const co1 = await checkout(s.user, h1.data.reservation.id);
    expect((await confirmMock(s.user, co1.data.booking.id)).status).toBe(200);

    expect((await cancelEvent(s.org, s.eventId)).status).toBe(200);

    // confirmed => REFUND_PENDING, seats still BOOKED, tickets still live
    const b1 = await api('GET', `/bookings/${co1.data.booking.id}`, { token: s.user.token });
    expect(b1.data.booking.status).toBe('REFUND_PENDING');
    // ENABLE_SEAT_MAP_CACHE: wait past the documented staleness window instead
    // of racing a cache entry warmed by setupShow's own read.
    await sleep(env.SEAT_MAP_CACHE_TTL_MS + 250);
    const seats = (await api('GET', `/shows/${s.showId}/seats`)).data.sections
      .flatMap((x: any) => x.rows.flatMap((y: any) => y.seats));
    expect(seats.find((z: any) => z.id === s.seatIds[0]).status).toBe('BOOKED');
    const [{ count }] = await db<{ count: string }>(
      `SELECT count(*) AS count FROM booking_seats WHERE booking_id = $1 AND released_at IS NULL`,
      [co1.data.booking.id]
    );
    expect(count).toBe('1');

    // terminal + idempotent, and the event cannot come back
    expect((await cancelEvent(s.org, s.eventId)).status).toBe(200);
    expect((await api('POST', `/events/${s.eventId}/publish`, { token: s.org.token })).status).toBe(409);
    expect((await createShowAt(s.org, s.eventId, s.venueId, Date.now() + 6 * 86400_000)).status).toBe(409);
    expect((await api('PATCH', `/events/${s.eventId}`, { token: s.org.token, body: { title: 'Nope' } })).status).toBe(409);
  });

  it('cancel with an ACTIVE hold and a PENDING_PAYMENT booking releases both', async () => {
    const s = await setupShow('lifeB2', 2);
    const h = await hold(s.user, s.showId, `lifeB2-${Date.now()}`, [s.seatIds[0], s.seatIds[1]]);
    const resId = h.data.reservation.id;
    const co = await checkout(s.user, resId); // PENDING_PAYMENT
    expect(co.status).toBe(201);

    expect((await cancelEvent(s.org, s.eventId)).status).toBe(200);

    const b = await api('GET', `/bookings/${co.data.booking.id}`, { token: s.user.token });
    expect(b.data.booking.status).toBe('CANCELLED');
    const r = await api('GET', `/reservations/${resId}`, { token: s.user.token });
    expect(r.data.reservation.status).toBe('RELEASED');
  });
});

describe('M-1: idempotent replays only while the reservation is live', () => {
  it('C: replay of an expired hold => 409 RESERVATION_NOT_ACTIVE (EXPIRED)', async () => {
    const s = await setupShow('lifeC');
    const key = `lifeC-${Date.now()}`;
    const h = await hold(s.user, s.showId, key, [s.seatIds[0]]);
    expect(h.status).toBe(201);
    const resId = h.data.reservation.id;

    await expireReservation(resId); // expires_at into the past via DB

    const replay = await hold(s.user, s.showId, key, [s.seatIds[0]]);
    expect(replay.status).toBe(409);
    expect(replay.data.error.code).toBe('RESERVATION_NOT_ACTIVE');
    expect(replay.data.error.details.status).toBe('EXPIRED');

    const g = await api('GET', `/reservations/${resId}`, { token: s.user.token });
    expect(g.data.reservation.status).toBe('EXPIRED');
  });
});

describe('M-8: checkout replays only while the booking is live', () => {
  it('D: checkout replay after release => 409 BOOKING_NOT_PAYABLE (CANCELLED)', async () => {
    const s = await setupShow('lifeD');
    const h = await hold(s.user, s.showId, `lifeD-${Date.now()}`, [s.seatIds[0]]);
    const resId = h.data.reservation.id;
    const co = await checkout(s.user, resId);
    expect(co.status).toBe(201);

    expect((await release(s.user, resId)).status).toBe(204);

    const co2 = await checkout(s.user, resId);
    expect(co2.status).toBe(409);
    expect(co2.data.error.code).toBe('BOOKING_NOT_PAYABLE');
    expect(co2.data.error.details.status).toBe('CANCELLED');
  });

  it('D: booking reads report EXPIRED (no payBefore) once the hold is dead', async () => {
    const s = await setupShow('lifeD2');
    const h = await hold(s.user, s.showId, `lifeD2-${Date.now()}`, [s.seatIds[0]]);
    const co = await checkout(s.user, h.data.reservation.id);
    expect(co.status).toBe(201);
    const bId = co.data.booking.id;

    const pending = await api('GET', `/bookings/${bId}`, { token: s.user.token });
    expect(pending.data.booking.status).toBe('PENDING_PAYMENT');
    expect(typeof pending.data.booking.payBefore).toBe('string');

    await expireReservation(h.data.reservation.id);

    const dead = await api('GET', `/bookings/${bId}`, { token: s.user.token });
    expect(dead.data.booking.status).toBe('EXPIRED');
    expect(dead.data.booking.payBefore).toBeUndefined();
  });
});

describe('H-2: uuids are case-insensitive for clients', () => {
  it('E: uppercase/mixed-case seatIds replay to the same reservation; case-variant duplicate => 400', async () => {
    const s = await setupShow('lifeE', 2);
    const key = `lifeE-${Date.now()}`;
    const upper = [s.seatIds[0].toUpperCase(), s.seatIds[1].toUpperCase()];

    const h = await hold(s.user, s.showId, key, upper);
    expect(h.status).toBe(201);
    const resId = h.data.reservation.id;

    const replay = await hold(s.user, s.showId, key, upper);
    expect(replay.status).toBe(200);
    expect(replay.data.reservation.id).toBe(resId);

    const mixed = await hold(s.user, s.showId, key, [s.seatIds[0].toLowerCase(), s.seatIds[1].toUpperCase()]);
    expect(mixed.status).toBe(200);
    expect(mixed.data.reservation.id).toBe(resId);

    const dup = await hold(s.user, s.showId, `lifeE-dup-${Date.now()}`, [s.seatIds[0].toUpperCase(), s.seatIds[0].toLowerCase()]);
    expect(dup.status).toBe(400);
    expect(dup.data.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(dup.data)).toContain('Duplicate seat IDs are not allowed');
  });
});

describe('sales_open_at: holds and the seat map agree (DB clock)', () => {
  it('sales open in the future => map not bookable + salesOpenAt, hold 409 SHOW_NOT_BOOKABLE; once open => hold works', async () => {
    const s = await setupShow('salesOpen', 2);
    await db(`UPDATE shows SET sales_open_at = now() + interval '1 day' WHERE id = $1`, [s.showId]);
    const [{ sales_open_at }] = await db<{ sales_open_at: Date }>('SELECT sales_open_at FROM shows WHERE id = $1', [s.showId]);

    // setupShow's own read may still be cached; wait past the TTL.
    await sleep(env.SEAT_MAP_CACHE_TTL_MS + 250);
    const before = await api('GET', `/shows/${s.showId}/seats`);
    expect(before.data.show.bookable).toBe(false);
    expect(before.data.show.salesOpenAt).toBe(new Date(sales_open_at).toISOString());

    const early = await hold(s.user, s.showId, `salesOpen-1-${Date.now()}`, [s.seatIds[0]]);
    expect(early.status).toBe(409);
    expect(early.data.error.code).toBe('SHOW_NOT_BOOKABLE');
    const [seat] = await db<{ status: string }>('SELECT status FROM show_seats WHERE id = $1', [s.seatIds[0]]);
    expect(seat.status).toBe('AVAILABLE');

    await db(`UPDATE shows SET sales_open_at = now() - interval '1 minute' WHERE id = $1`, [s.showId]);
    await sleep(env.SEAT_MAP_CACHE_TTL_MS + 250);
    const after = await api('GET', `/shows/${s.showId}/seats`);
    expect(after.data.show.bookable).toBe(true);

    const open = await hold(s.user, s.showId, `salesOpen-2-${Date.now()}`, [s.seatIds[0]]);
    expect(open.status).toBe(201);
  });

  it('no sales_open_at => salesOpenAt null and bookable', async () => {
    const s = await setupShow('salesNull', 1);
    const map = await api('GET', `/shows/${s.showId}/seats`);
    expect(map.data.show.salesOpenAt).toBeNull();
    expect(map.data.show.bookable).toBe(true);
  });
});

describe('event context on seat map, reservation and booking responses', () => {
  it('seat map, hold (201 and 200 replay), GET reservation and bookings carry event title, start time and venue', async () => {
    const s = await setupShow('ctx', 2);
    const [ctx] = await db<{ title: string; starts_at: Date; name: string; city: string }>(
      `SELECT e.title, s.starts_at, v.name, v.city
         FROM shows s JOIN events e ON e.id = s.event_id JOIN venues v ON v.id = s.venue_id
        WHERE s.id = $1`,
      [s.showId]
    );
    const event = { id: s.eventId, title: ctx.title };
    const show = { id: s.showId, startsAt: new Date(ctx.starts_at).toISOString(), venue: { name: ctx.name, city: ctx.city } };

    const map = await api('GET', `/shows/${s.showId}/seats`);
    expect(map.data.event).toEqual(event);
    expect(map.data.show.venue).toEqual(show.venue);
    expect(map.data.show.startsAt).toBe(show.startsAt);

    const key = `ctx-${Date.now()}`;
    const h = await hold(s.user, s.showId, key, [s.seatIds[0]]);
    expect(h.status).toBe(201);
    expect(h.data.reservation.event).toEqual(event);
    expect(h.data.reservation.show).toEqual(show);
    expect(h.data.reservation.showId).toBe(s.showId); // existing field kept

    const replay = await hold(s.user, s.showId, key, [s.seatIds[0]]);
    expect(replay.status).toBe(200);
    expect(replay.data.reservation.event).toEqual(event);
    expect(replay.data.reservation.show).toEqual(show);

    const g = await api('GET', `/reservations/${h.data.reservation.id}`, { token: s.user.token });
    expect(g.data.reservation.event).toEqual(event);
    expect(g.data.reservation.show).toEqual(show);

    const co = await checkout(s.user, h.data.reservation.id);
    expect(co.status).toBe(201);
    expect(co.data.booking.reservationId).toBe(h.data.reservation.id);
    expect(co.data.booking.event).toEqual(event);
    expect(co.data.booking.show).toEqual(show);

    const cf = await confirmMock(s.user, co.data.booking.id);
    expect(cf.data.booking.reservationId).toBe(h.data.reservation.id);
    const mine = await api('GET', '/bookings/mine', { token: s.user.token });
    expect(mine.data.bookings[0].reservationId).toBe(h.data.reservation.id);
    expect(mine.data.bookings[0].show).toEqual(show);
  });
});
