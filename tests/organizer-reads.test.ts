/**
 * Organizer dashboard reads:
 *  - GET /venues/mine carries `categories` (sorted, distinct) next to `seat_count`
 *  - GET /venues/:venueId/seats returns the owner's layout grouped by section and row
 *  - GET /events/mine carries every show of each event (DRAFT events included) with seat counts
 */
import { describe, expect, it } from 'vitest';
import { api, checkout, confirmMock, hold, register, type User } from './helpers';

const DAY = 86400_000;
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function newVenue(org: User): Promise<string> {
  const v = await api('POST', '/venues', { token: org.token, body: { name: `Org Reads ${uniq()}`, address: '1 Test Way', city: 'Testville' } });
  expect(v.status).toBe(201);
  return v.data.id;
}

async function bulk(org: User, venueId: string, body: Record<string, unknown>) {
  const res = await api('POST', `/venues/${venueId}/seats/bulk`, { token: org.token, body });
  expect(res.status).toBe(201);
}

describe('GET /venues/mine categories', () => {
  it('lists distinct categories sorted, and [] for a venue without seats', async () => {
    const org = await register('orgr_cat', { role: 'ORGANIZER' });
    const empty = await newVenue(org);
    const full = await newVenue(org);
    await bulk(org, full, { mode: 'GRID', rows: ['C', 'D'], seatsPerRow: 3, category: 'regular' });
    await bulk(org, full, { mode: 'GRID', rows: ['A'], seatsPerRow: 2, category: 'VIP' });
    await bulk(org, full, { mode: 'GRID', rows: ['B'], seatsPerRow: 2, category: 'VIP' });

    const res = await api('GET', '/venues/mine', { token: org.token });
    expect(res.status).toBe(200);
    const byId = new Map<string, any>(res.data.map((v: any) => [v.id, v]));
    expect(byId.get(full)).toMatchObject({ seat_count: 10, categories: ['REGULAR', 'VIP'] });
    expect(byId.get(empty)).toMatchObject({ seat_count: 0, categories: [] });
  });
});

describe('GET /venues/:venueId/seats', () => {
  it('groups seats by section and row, rows in natural order, seats by number', async () => {
    const org = await register('orgr_lay', { role: 'ORGANIZER' });
    const venueId = await newVenue(org);
    await bulk(org, venueId, { mode: 'GRID', rows: ['B', 'AA'], seatsPerRow: 2, category: 'REGULAR' });
    await bulk(org, venueId, { mode: 'GRID', rows: ['A'], seatsPerRow: 3, category: 'VIP' });
    await bulk(org, venueId, { mode: 'GENERAL_ADMISSION', section: 'lawn', count: 2, category: 'GA' });

    const res = await api('GET', `/venues/${venueId}/seats`, { token: org.token });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      venue_id: venueId,
      seat_count: 9,
      categories: ['GA', 'REGULAR', 'VIP'],
      sections: [
        {
          section: 'LAWN',
          rows: [{ row: 'G', seats: [{ number: 1, category: 'GA' }, { number: 2, category: 'GA' }] }],
        },
        {
          section: 'MAIN',
          rows: [
            { row: 'A', seats: [1, 2, 3].map((number) => ({ number, category: 'VIP' })) },
            { row: 'B', seats: [1, 2].map((number) => ({ number, category: 'REGULAR' })) },
            { row: 'AA', seats: [1, 2].map((number) => ({ number, category: 'REGULAR' })) },
          ],
        },
      ],
    });
  });

  it('returns an empty layout for a venue without seats', async () => {
    const org = await register('orgr_lay0', { role: 'ORGANIZER' });
    const venueId = await newVenue(org);
    const res = await api('GET', `/venues/${venueId}/seats`, { token: org.token });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ venue_id: venueId, seat_count: 0, categories: [], sections: [] });
  });

  it('is owner only: 404 for another organizer, 403 for an attendee, 400 for a bad id, 401 without a token', async () => {
    const owner = await register('orgr_own', { role: 'ORGANIZER' });
    const other = await register('orgr_oth', { role: 'ORGANIZER' });
    const attendee = await register('orgr_att');
    const venueId = await newVenue(owner);

    expect((await api('GET', `/venues/${venueId}/seats`, { token: other.token })).status).toBe(404);
    expect((await api('GET', `/venues/${venueId}/seats`, { token: attendee.token })).status).toBe(403);
    expect((await api('GET', '/venues/not-a-uuid/seats', { token: owner.token })).status).toBe(400);
    expect((await api('GET', `/venues/${venueId}/seats`)).status).toBe(401);
  });
});

describe('GET /events/mine shows', () => {
  it('includes every show (DRAFT events too) with seat totals and booked counts', async () => {
    const org = await register('orgr_evt', { role: 'ORGANIZER' });
    const user = await register('orgr_evu');
    const venueId = await newVenue(org);
    await bulk(org, venueId, { mode: 'GRID', rows: ['A'], seatsPerRow: 4, category: 'REGULAR' });

    const createEvent = async () => {
      const ev = await api('POST', '/events', { token: org.token, body: { title: `Reads ${uniq()}`, category: 'MUSIC' } });
      expect(ev.status).toBe(201);
      return ev.data.id as string;
    };
    const createShow = async (eventId: string, startMs: number, salesOpenAt?: string) => {
      const res = await api('POST', `/events/${eventId}/shows`, {
        token: org.token,
        body: {
          venueId,
          startsAt: new Date(startMs).toISOString(),
          endsAt: new Date(startMs + 2 * 3600_000).toISOString(),
          ...(salesOpenAt ? { salesOpenAt } : {}),
          categoryPrices: [{ category: 'REGULAR', pricePaise: 50000 }],
        },
      });
      expect(res.status).toBe(201);
      return res.data.id as string;
    };

    const empty = await createEvent();
    const draft = await createEvent();
    const salesOpenAt = new Date(Date.now() + DAY).toISOString();
    const draftLater = await createShow(draft, Date.now() + 12 * DAY);
    const draftEarlier = await createShow(draft, Date.now() + 10 * DAY, salesOpenAt);

    const published = await createEvent();
    const showId = await createShow(published, Date.now() + 14 * DAY);
    expect((await api('POST', `/events/${published}/publish`, { token: org.token })).status).toBe(200);
    const map = await api('GET', `/shows/${showId}/seats`);
    const seatIds: string[] = map.data.sections[0].rows[0].seats.slice(0, 2).map((s: any) => s.id);
    const r = await hold(user, showId, `orgr-${uniq()}`, seatIds);
    expect(r.status).toBe(201);
    const b = await checkout(user, r.data.reservation.id);
    expect((await confirmMock(user, b.data.booking.id)).status).toBe(200);

    const res = await api('GET', '/events/mine', { token: org.token });
    expect(res.status).toBe(200);
    const byId = new Map<string, any>(res.data.map((e: any) => [e.id, e]));

    expect(byId.get(empty).shows).toEqual([]);

    const draftShows = byId.get(draft).shows;
    expect(byId.get(draft).status).toBe('DRAFT');
    expect(draftShows.map((s: any) => s.id)).toEqual([draftEarlier, draftLater]); // by start time
    expect(draftShows[0]).toMatchObject({
      venue_id: venueId,
      status: 'SCHEDULED',
      sales_open_at: salesOpenAt,
      seats_total: 4,
      seats_booked: 0,
    });
    expect(typeof draftShows[0].venue_name).toBe('string');
    expect(draftShows[0].venue_city).toBe('Testville');
    expect(draftShows[0]).not.toHaveProperty('event_id');

    expect(byId.get(published).shows).toEqual([
      expect.objectContaining({ id: showId, seats_total: 4, seats_booked: 2, sales_open_at: null }),
    ]);
  });

  it("never lists another organizer's shows", async () => {
    const a = await register('orgr_isoa', { role: 'ORGANIZER' });
    const b = await register('orgr_isob', { role: 'ORGANIZER' });
    const ev = await api('POST', '/events', { token: a.token, body: { title: `Iso ${uniq()}`, category: 'MUSIC' } });
    const res = await api('GET', '/events/mine', { token: b.token });
    expect(res.status).toBe(200);
    expect(res.data.find((e: any) => e.id === ev.data.id)).toBeUndefined();
  });
});
