/**
 * GET /events: upcoming-show info on every event (next_show, upcoming_show_count,
 * min_price_paise) and case-insensitive city/category filters.
 *
 * Each test uses its own unique category (and city), so results never mix with other data.
 */
import { describe, expect, it } from 'vitest';
import { api, db, register, type User } from './helpers';

const DAY = 86400_000;
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

interface Venue {
  id: string;
  city: string;
}

/** A venue with two seat categories (REGULAR row A, VIP row B). */
async function venue(org: User, city: string): Promise<Venue> {
  const v = await api('POST', '/venues', { token: org.token, body: { name: `List Hall ${uniq()}`, address: '1 Test Way', city } });
  expect(v.status).toBe(201);
  for (const [row, category] of [['A', 'REGULAR'], ['B', 'VIP']]) {
    const bulk = await api('POST', `/venues/${v.data.id}/seats/bulk`, {
      token: org.token,
      body: { mode: 'GRID', section: 'MAIN', rows: [row], seatsPerRow: 2, category },
    });
    expect(bulk.status).toBe(201);
  }
  return { id: v.data.id, city };
}

async function show(org: User, eventId: string, venueId: string, startMs: number, regular: number, vip: number): Promise<string> {
  const res = await api('POST', `/events/${eventId}/shows`, {
    token: org.token,
    body: {
      venueId,
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(startMs + 2 * 3600_000).toISOString(),
      categoryPrices: [
        { category: 'REGULAR', pricePaise: regular },
        { category: 'VIP', pricePaise: vip },
      ],
    },
  });
  expect(res.status).toBe(201);
  return res.data.id;
}

async function event(org: User, category: string): Promise<string> {
  const ev = await api('POST', '/events', { token: org.token, body: { title: `List ${uniq()}`, category } });
  expect(ev.status).toBe(201);
  return ev.data.id;
}

async function publish(org: User, eventId: string) {
  const res = await api('POST', `/events/${eventId}/publish`, { token: org.token });
  expect(res.status).toBe(200);
}

/** Moves a show into the past using the DB clock (the API refuses to create past shows). */
const moveToPast = (showId: string, daysAgo: number) =>
  db(
    `UPDATE shows SET starts_at = now() - make_interval(days => $2), ends_at = now() - make_interval(days => $2) + interval '2 hours'
      WHERE id = $1`,
    [showId, daysAgo]
  );

async function listByCategory(category: string, extra = '') {
  const res = await api('GET', `/events?category=${encodeURIComponent(category)}&limit=50${extra}`);
  expect(res.status).toBe(200);
  return res.data;
}

describe('GET /events upcoming-show info', () => {
  it('two future shows: next_show is the earlier one, count 2, lowest price across both', async () => {
    const org = await register('lst_two', { role: 'ORGANIZER' });
    const v = await venue(org, 'Testville');
    const category = `LIST_${uniq()}`.toUpperCase();
    const id = await event(org, category);
    const later = await show(org, id, v.id, Date.now() + 9 * DAY, 50000, 120000);
    const earlier = await show(org, id, v.id, Date.now() + 4 * DAY, 30000, 90000);
    await publish(org, id);

    const { events, total } = await listByCategory(category);
    expect(total).toBe(1);
    const e = events[0];
    expect(e.id).toBe(id);
    expect(e.next_show.id).toBe(earlier);
    expect(e.next_show.id).not.toBe(later);
    expect(Object.keys(e.next_show).sort()).toEqual(['ends_at', 'id', 'starts_at', 'venue']);
    expect(e.next_show.venue).toEqual({ id: v.id, name: expect.any(String), city: 'Testville' });
    expect(new Date(e.next_show.starts_at).getTime()).toBeLessThan(new Date(e.next_show.ends_at).getTime());
    expect(e.upcoming_show_count).toBe(2);
    expect(e.min_price_paise).toBe(30000);
    // Existing event-row fields are still there, unchanged.
    for (const key of ['organizer_id', 'title', 'description', 'category', 'poster_url', 'status', 'cancelled_at', 'created_at', 'updated_at']) {
      expect(e).toHaveProperty(key);
    }
  });

  it('cancelled and past shows are ignored (for next_show, the count and the price)', async () => {
    const org = await register('lst_ign', { role: 'ORGANIZER' });
    const v = await venue(org, 'Testville');
    const category = `LIST_${uniq()}`.toUpperCase();
    const id = await event(org, category);
    const live = await show(org, id, v.id, Date.now() + 10 * DAY, 70000, 99000);
    const cancelled = await show(org, id, v.id, Date.now() + 3 * DAY, 100, 200);
    const past = await show(org, id, v.id, Date.now() + 6 * DAY, 50, 60);
    await publish(org, id);
    await db(`UPDATE shows SET status = 'CANCELLED' WHERE id = $1`, [cancelled]);
    await moveToPast(past, 3);

    const { events } = await listByCategory(category);
    expect(events).toHaveLength(1);
    expect(events[0].next_show.id).toBe(live);
    expect(events[0].upcoming_show_count).toBe(1);
    expect(events[0].min_price_paise).toBe(70000);
  });

  it('no upcoming shows: next_show null, count 0, min_price_paise null', async () => {
    const org = await register('lst_none', { role: 'ORGANIZER' });
    const v = await venue(org, 'Testville');
    const category = `LIST_${uniq()}`.toUpperCase();
    const id = await event(org, category);
    const s = await show(org, id, v.id, Date.now() + 2 * DAY, 40000, 80000);
    await publish(org, id);
    await moveToPast(s, 1);

    const { events } = await listByCategory(category);
    expect(events).toHaveLength(1);
    expect(events[0].next_show).toBeNull();
    expect(events[0].upcoming_show_count).toBe(0);
    expect(events[0].min_price_paise).toBeNull();
  });
});

describe('GET /events case-insensitive filters', () => {
  it('city filter ignores case ("pune" matches "Pune")', async () => {
    const org = await register('lst_city', { role: 'ORGANIZER' });
    const city = `Pune${uniq()}`; // stored with a capital P
    const v = await venue(org, city);
    const category = `LIST_${uniq()}`.toUpperCase();
    const id = await event(org, category);
    await show(org, id, v.id, Date.now() + 5 * DAY, 30000, 60000);
    await publish(org, id);

    for (const query of [city.toLowerCase(), city.toUpperCase(), city]) {
      const res = await api('GET', `/events?city=${encodeURIComponent(query)}&limit=50`);
      expect(res.status).toBe(200);
      expect(res.data.events.map((e: { id: string }) => e.id)).toEqual([id]);
      expect(res.data.total).toBe(1);
    }
  });

  it('category filter ignores case ("music" matches "MUSIC"-style values)', async () => {
    const org = await register('lst_cat', { role: 'ORGANIZER' });
    const v = await venue(org, 'Testville');
    const category = `LIST_${uniq()}`.toUpperCase(); // stored uppercase
    const id = await event(org, category);
    await show(org, id, v.id, Date.now() + 5 * DAY, 30000, 60000);
    await publish(org, id);

    const lower = await listByCategory(category.toLowerCase());
    expect(lower.events.map((e: { id: string }) => e.id)).toEqual([id]);
    expect(lower.total).toBe(1);
    // The stored value itself is unchanged.
    expect(lower.events[0].category).toBe(category);
  });
});
