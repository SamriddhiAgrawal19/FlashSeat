/**
 * Seat counts and venue/organizer details on the public event reads:
 *   - GET /events/:eventId: organization_name, and per show venue { name, city, address },
 *     seats_total and seats_available.
 *   - GET /events: seats_total and seats_available on next_show only.
 *
 * "Available" follows the seat map's rule: AVAILABLE, plus HELD seats whose held_until has
 * passed (a lapsed hold the sweeper has not released yet). BOOKED and live HELD seats are not.
 *
 * Each event gets its own unique category, so the list query never mixes with other data, and
 * every event is cancelled afterwards so none of them stays listed on GET /events.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { api, cancelEvent, checkout, confirmMock, createShowAt, expireSeatHold, hold, register, setupShow, sleep, type User } from './helpers';

const DAY = 86400_000;
const created: Array<{ org: User; eventId: string }> = [];
afterAll(async () => {
  for (const { org, eventId } of created) await cancelEvent(org, eventId);
});

const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * One show with 6 seats in this state: 2 BOOKED (confirmed booking), 1 HELD by a live hold,
 * 1 HELD by a lapsed hold, 2 AVAILABLE. Expected: seats_total 6, seats_available 3.
 * Plus a later show of the same event with all 6 seats free.
 */
async function eventWithMixedSeats(tag: string) {
  const setup = await setupShow(tag, 6);
  created.push({ org: setup.org, eventId: setup.eventId });
  const [s0, s1, s2, s3] = setup.seatIds;

  // 2 BOOKED
  const held = await hold(setup.user, setup.showId, `cnt-book-${uniq()}`, [s0!, s1!]);
  expect(held.status).toBe(201);
  const booking = await checkout(setup.user, held.data.reservation.id);
  expect(booking.status).toBe(201);
  const confirmed = await confirmMock(setup.user, booking.data.booking.id);
  expect(confirmed.status).toBe(200);

  // 1 HELD, live
  const live = await register(`${tag}_live`);
  expect((await hold(live, setup.showId, `cnt-live-${uniq()}`, [s2!])).status).toBe(201);

  // 1 HELD, lapsed (held_until in the past, not swept)
  const lapsed = await register(`${tag}_lapsed`);
  expect((await hold(lapsed, setup.showId, `cnt-lapse-${uniq()}`, [s3!])).status).toBe(201);
  await expireSeatHold(s3!);

  const later = await createShowAt(setup.org, setup.eventId, setup.venueId, Date.now() + 10 * DAY);
  expect(later.status).toBe(201);

  // A category of its own, so GET /events?category= returns exactly this event.
  const category = `COUNTS_${uniq()}`.toUpperCase();
  const patched = await api('PATCH', `/events/${setup.eventId}`, { token: setup.org.token, body: { category } });
  expect(patched.status).toBe(200);

  return { ...setup, laterShowId: later.data.id as string, category };
}

describe('Seat counts on public event reads', () => {
  it('GET /events/:eventId: per-show seats_total / seats_available, venue address, organization_name', async () => {
    const e = await eventWithMixedSeats('cnt_detail');
    const res = await api('GET', `/events/${e.eventId}`);
    expect(res.status).toBe(200);

    expect(res.data.organization_name).toBe('cnt_detail_org Org');
    expect(res.data.shows).toHaveLength(2);

    const [first, second] = res.data.shows;
    expect(first.id).toBe(e.showId);
    expect(first.seats_total).toBe(6);
    expect(first.seats_available).toBe(3); // 2 free + 1 lapsed hold; not the 2 booked or the live hold
    expect(second.id).toBe(e.laterShowId);
    expect(second.seats_total).toBe(6);
    expect(second.seats_available).toBe(6);

    for (const show of res.data.shows) {
      expect(show.venue).toEqual({ name: show.venue_name, city: 'Testville', address: '1 Test Way' });
      // The flat fields existing clients read are still there.
      expect(typeof show.venue_name).toBe('string');
      expect(show.venue_city).toBe('Testville');
    }

    // Same rule as the public seat map (its cache lives 2 s, so read it after that).
    await sleep(2100);
    const map = await api('GET', `/shows/${e.showId}/seats`);
    expect(map.status).toBe(200);
    expect(map.data.summary.total).toBe(first.seats_total);
    expect(map.data.summary.available).toBe(first.seats_available);
    expect(map.data.summary.booked).toBe(2);
    expect(map.data.summary.held).toBe(1);
  });

  it('GET /events: next_show carries the next show’s seat counts only', async () => {
    const e = await eventWithMixedSeats('cnt_list');
    const res = await api('GET', `/events?category=${e.category}`);
    expect(res.status).toBe(200);
    expect(res.data.total).toBe(1);

    const [row] = res.data.events;
    expect(row.id).toBe(e.eventId);
    expect(row.upcoming_show_count).toBe(2);
    expect(row.next_show.id).toBe(e.showId);
    expect(row.next_show.seats_total).toBe(6);
    expect(row.next_show.seats_available).toBe(3);
  });

  it('a sold-out next show reads 0 available; a lapsed hold makes a seat available again', async () => {
    const setup = await setupShow('cnt_sold', 2);
    created.push({ org: setup.org, eventId: setup.eventId });
    const category = `COUNTS_${uniq()}`.toUpperCase();
    expect((await api('PATCH', `/events/${setup.eventId}`, { token: setup.org.token, body: { category } })).status).toBe(200);

    const [a, b] = setup.seatIds;
    const booked = await hold(setup.user, setup.showId, `cnt-sold-${uniq()}`, [a!]);
    const bk = await checkout(setup.user, booked.data.reservation.id);
    expect((await confirmMock(setup.user, bk.data.booking.id)).status).toBe(200);
    const other = await register('cnt_sold_other');
    expect((await hold(other, setup.showId, `cnt-sold2-${uniq()}`, [b!])).status).toBe(201);

    let list = await api('GET', `/events?category=${category}`);
    expect(list.data.events[0].next_show).toMatchObject({ seats_total: 2, seats_available: 0 });
    let detail = await api('GET', `/events/${setup.eventId}`);
    expect(detail.data.shows[0]).toMatchObject({ seats_total: 2, seats_available: 0 });

    await expireSeatHold(b!);
    list = await api('GET', `/events?category=${category}`);
    expect(list.data.events[0].next_show).toMatchObject({ seats_total: 2, seats_available: 1 });
    detail = await api('GET', `/events/${setup.eventId}`);
    expect(detail.data.shows[0]).toMatchObject({ seats_total: 2, seats_available: 1 });
  });
});
