/**
 * API consistency, plus the regressions for the former KNOWN BUGS L-9 and M-5
 * (docs/review/test-findings.md). Those two were tracked as it.fails until Batch 4
 * fixed them; they are now ordinary passing tests.
 */
import { describe, expect, it } from 'vitest';
import { api, cancelEvent, createShowAt, db, hasErrorShape, hold, register, setupShow, type User } from './helpers';

const rnd = () => Math.random().toString(36).slice(2, 8);

describe('error shape and codes', () => {
  it('someone else\'s resource => 404 NOT_FOUND (no existence leak)', async () => {
    const a = await setupShow('apiA', 1);
    const b = await register('apiB');
    const h = await hold(a.user, a.showId, `apiOwn-${Date.now()}`, [a.seatIds[0]]);
    expect(h.status).toBe(201);
    const r = await api('GET', `/reservations/${h.data.reservation.id}`, { token: b.token });
    expect(r.status).toBe(404);
    expect(hasErrorShape(r.data)).toBe(true);
    expect(r.data.error.code).toBe('NOT_FOUND');
  });

  it('malformed uuid path => 400 VALIDATION_ERROR', async () => {
    const r = await api('GET', '/events/not-a-uuid');
    expect(r.status).toBe(400);
    expect(r.data.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('L-9: GET /events/:eventId/shows/:showId respects :eventId', () => {
  it('L-9: GET /events/:eventId/shows/:showId must 404 when the show belongs to another event', async () => {
    const a = await setupShow('apiL9', 1);
    const other = await setupShow('apiL9b', 1);
    // other.showId exists, but under other.eventId — not under a.eventId
    const r = await api('GET', `/events/${a.eventId}/shows/${other.showId}`);
    expect(r.status).toBe(404);
    expect(r.data.error.code).toBe('NOT_FOUND');
  });

  it('L-9: the right event id => 200 with the show; a non-existent event id => 404', async () => {
    const a = await setupShow('apiL9c', 1);
    const ok = await api('GET', `/events/${a.eventId}/shows/${a.showId}`);
    expect(ok.status).toBe(200);
    expect(ok.data.id).toBe(a.showId);
    expect(ok.data.event_id).toBe(a.eventId);
    expect(ok.data).not.toHaveProperty('event_status');

    const missing = await api('GET', `/events/00000000-0000-4000-8000-000000000000/shows/${a.showId}`);
    expect(missing.status).toBe(404);
    expect(missing.data.error.code).toBe('NOT_FOUND');
  });

  it('L-9: visibility unchanged — DRAFT event => 404, CANCELLED event => 200', async () => {
    // DRAFT: show created but the event never published
    const org = await register('apiL9d_org', { role: 'ORGANIZER' });
    const venue = await api('POST', '/venues', { token: org.token, body: { name: `L9d ${rnd()}`, address: '1 Way', city: 'Ville' } });
    expect(
      (await api('POST', `/venues/${venue.data.id}/seats/bulk`, {
        token: org.token, body: { mode: 'GRID', section: 'MAIN', rows: ['A'], seatsPerRow: 1, category: 'REGULAR' },
      })).status
    ).toBe(201);
    const ev = await api('POST', '/events', { token: org.token, body: { title: 'L9 draft', category: 'MUSIC' } });
    const show = await createShowAt(org, ev.data.id, venue.data.id, Date.now() + 5 * 86400_000);
    expect(show.status).toBe(201);
    const draft = await api('GET', `/events/${ev.data.id}/shows/${show.data.id}`);
    expect(draft.status).toBe(404);

    // CANCELLED: still readable
    const c = await setupShow('apiL9e', 1);
    expect((await cancelEvent(c.org, c.eventId)).status).toBe(200);
    const cancelled = await api('GET', `/events/${c.eventId}/shows/${c.showId}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.data.status).toBe('CANCELLED');
  });
});

describe('M-5: bulk seat generation limits', () => {
  async function newVenue(org: User): Promise<string> {
    const v = await api('POST', '/venues', { token: org.token, body: { name: `M5 ${rnd()}`, address: '1 Way', city: 'Ville' } });
    expect(v.status).toBe(201);
    return v.data.id;
  }
  const bulk = (org: User, venueId: string, body: unknown) =>
    api('POST', `/venues/${venueId}/seats/bulk`, { token: org.token, body });
  const seatCount = async (venueId: string) =>
    Number((await db<{ n: string }>('SELECT count(*) AS n FROM venue_seats WHERE venue_id = $1', [venueId]))[0].n);
  const issueText = (r: { data: any }) => JSON.stringify(r.data?.error?.details ?? '');

  it('M-5: bulk seat creation must reject oversized layouts with 400 VALIDATION_ERROR', async () => {
    const org = await register('apiM5', { role: 'ORGANIZER' });
    const venueId = await newVenue(org);
    // 100 rows x 200 seats = 20k seats (would be 100k bind params > pg's 65535 limit)
    const rows = Array.from({ length: 100 }, (_, i) => `R${i}`);
    const r = await bulk(org, venueId, { mode: 'GRID', section: 'MAIN', rows, seatsPerRow: 200, category: 'REGULAR' });
    expect(r.status).toBe(400);
    expect(r.data.error.code).toBe('VALIDATION_ERROR');
    expect(await seatCount(venueId)).toBe(0);
  });

  it('M-5: 2001 seats in one call => 400 (GRID and GENERAL_ADMISSION); 2000 is accepted', async () => {
    const org = await register('apiM5a', { role: 'ORGANIZER' });
    const venueId = await newVenue(org);

    const grid = await bulk(org, venueId, { mode: 'GRID', rows: ['A', 'B', 'C'], seatsPerRow: 667 });
    expect(grid.status).toBe(400);
    expect(grid.data.error.code).toBe('VALIDATION_ERROR');
    expect(issueText(grid)).toContain('at most 2000 seats');

    const ga = await bulk(org, venueId, { mode: 'GENERAL_ADMISSION', section: 'GA', count: 2001 });
    expect(ga.status).toBe(400);
    expect(ga.data.error.code).toBe('VALIDATION_ERROR');

    const perRow = await bulk(org, venueId, { mode: 'GRID', rows: ['A'], seatsPerRow: 501 });
    expect(perRow.status).toBe(400);
    expect(await seatCount(venueId)).toBe(0);

    const max = await bulk(org, venueId, { mode: 'GRID', rows: ['A', 'B', 'C', 'D'], seatsPerRow: 500 });
    expect(max.status).toBe(201);
    expect(await seatCount(venueId)).toBe(2000);
  });

  it('M-5: duplicate row labels (exact or case-insensitive) => 400, nothing inserted', async () => {
    const org = await register('apiM5b', { role: 'ORGANIZER' });
    const venueId = await newVenue(org);

    for (const rows of [['A', 'B', 'A'], ['A', 'a'], ['row1', 'ROW1']]) {
      const r = await bulk(org, venueId, { mode: 'GRID', rows, seatsPerRow: 5 });
      expect(r.status, JSON.stringify(rows)).toBe(400);
      expect(r.data.error.code).toBe('VALIDATION_ERROR');
      expect(issueText(r)).toContain('Duplicate row labels');
    }
    expect(await seatCount(venueId)).toBe(0);
  });

  it('M-5: invalid row label, section or category => 400', async () => {
    const org = await register('apiM5c', { role: 'ORGANIZER' });
    const venueId = await newVenue(org);

    for (const label of ['A-1', 'ABCDE', '', ' A', 'Ä']) {
      const r = await bulk(org, venueId, { mode: 'GRID', rows: [label], seatsPerRow: 5 });
      expect(r.status, JSON.stringify(label)).toBe(400);
      expect(r.data.error.code).toBe('VALIDATION_ERROR');
    }
    for (const body of [
      { mode: 'GRID', rows: ['A'], seatsPerRow: 5, section: '   ' },
      { mode: 'GRID', rows: ['A'], seatsPerRow: 5, section: 'X'.repeat(31) },
      { mode: 'GRID', rows: ['A'], seatsPerRow: 5, category: '' },
      { mode: 'GENERAL_ADMISSION', count: 0 },
    ]) {
      const r = await bulk(org, venueId, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(await seatCount(venueId)).toBe(0);
  });

  it('M-5: row labels, section and category are trimmed/stored uppercase', async () => {
    const org = await register('apiM5d', { role: 'ORGANIZER' });
    const venueId = await newVenue(org);
    const r = await bulk(org, venueId, { mode: 'GRID', rows: ['a', 'b1'], seatsPerRow: 2, section: ' vip zone ', category: ' vip ' });
    expect(r.status).toBe(201);
    const rows = await db<{ section: string; row_label: string; category: string }>(
      'SELECT DISTINCT section, row_label, category FROM venue_seats WHERE venue_id = $1 ORDER BY row_label', [venueId]
    );
    expect(rows).toEqual([
      { section: 'VIP ZONE', row_label: 'A', category: 'VIP' },
      { section: 'VIP ZONE', row_label: 'B1', category: 'VIP' },
    ]);
  });

  it('M-5: same valid payload twice => 201 then 409 SEATS_ALREADY_EXIST, nothing extra inserted', async () => {
    const org = await register('apiM5e', { role: 'ORGANIZER' });
    const venueId = await newVenue(org);
    const body = { mode: 'GRID', section: 'MAIN', rows: ['A', 'B'], seatsPerRow: 10, category: 'REGULAR' };

    expect((await bulk(org, venueId, body)).status).toBe(201);
    const again = await bulk(org, venueId, body);
    expect(again.status).toBe(409);
    expect(again.data.error.code).toBe('SEATS_ALREADY_EXIST');
    expect(await seatCount(venueId)).toBe(20);

    // case-variant re-run of the same seats is the same seats (stored uppercase)
    const lower = await bulk(org, venueId, { ...body, section: 'main', rows: ['a', 'b'] });
    expect(lower.status).toBe(409);
    expect(lower.data.error.code).toBe('SEATS_ALREADY_EXIST');
    expect(await seatCount(venueId)).toBe(20);
  });

  it('M-5: filling a venue to MAX_SEATS_PER_VENUE => 409 VENUE_SEAT_LIMIT past the cap', async () => {
    const org = await register('apiM5f', { role: 'ORGANIZER' });
    const venueId = await newVenue(org);

    // 9 x 2000 + 1900 = 19,900 seats (cap 20,000)
    for (let i = 0; i < 10; i++) {
      const r = await bulk(org, venueId, {
        mode: 'GRID', section: `S${i}`, rows: ['A', 'B', 'C', 'D'], seatsPerRow: i < 9 ? 500 : 475,
      });
      expect(r.status, `fill call ${i}`).toBe(201);
    }
    expect(await seatCount(venueId)).toBe(19_900);

    const over = await bulk(org, venueId, { mode: 'GRID', section: 'X', rows: ['A'], seatsPerRow: 200 });
    expect(over.status).toBe(409);
    expect(over.data.error.code).toBe('VENUE_SEAT_LIMIT');
    expect(over.data.error.details).toEqual({ existing: 19_900, requested: 200, max: 20_000 });
    expect(await seatCount(venueId)).toBe(19_900);

    // exactly up to the cap is allowed, one more is not
    expect((await bulk(org, venueId, { mode: 'GRID', section: 'X', rows: ['A'], seatsPerRow: 100 })).status).toBe(201);
    expect(await seatCount(venueId)).toBe(20_000);
    const one = await bulk(org, venueId, { mode: 'GENERAL_ADMISSION', section: 'GA', count: 1 });
    expect(one.status).toBe(409);
    expect(one.data.error.code).toBe('VENUE_SEAT_LIMIT');
  });

  it('M-5: 10 parallel identical bulk calls on a fresh venue => one 201, nine 409, zero 5xx', async () => {
    const org = await register('apiM5g', { role: 'ORGANIZER' });
    const venueId = await newVenue(org);
    const body = { mode: 'GRID', section: 'MAIN', rows: ['A', 'B'], seatsPerRow: 25, category: 'REGULAR' };

    const results = await Promise.all(Array.from({ length: 10 }, () => bulk(org, venueId, body)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    const conflicts = results.filter((r) => r.status === 409);
    expect(conflicts).toHaveLength(9);
    for (const c of conflicts) expect(c.data.error.code).toBe('SEATS_ALREADY_EXIST');

    // the payload size, not 10x it
    expect(await seatCount(venueId)).toBe(50);
  });

  it('M-5: parallel bulk calls adding DIFFERENT seats cannot race past MAX_SEATS_PER_VENUE', async () => {
    // The unique constraint stops identical payloads by itself; only the venue
    // row lock stops distinct payloads from all passing the count check at once.
    const org = await register('apiM5h', { role: 'ORGANIZER' });
    const venueId = await newVenue(org);
    for (let i = 0; i < 10; i++) {
      const r = await bulk(org, venueId, {
        mode: 'GRID', section: `S${i}`, rows: ['A', 'B', 'C', 'D'], seatsPerRow: i < 9 ? 500 : 250,
      });
      expect(r.status, `fill call ${i}`).toBe(201);
    }
    expect(await seatCount(venueId)).toBe(19_000);

    // 10 x 200 distinct seats = 2,000 more requested; only 1,000 fit
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        bulk(org, venueId, { mode: 'GRID', section: `P${i}`, rows: ['A'], seatsPerRow: 200 })
      )
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    const rejected = results.filter((r) => r.status === 409);
    expect(rejected).toHaveLength(5);
    for (const r of rejected) expect(r.data.error.code).toBe('VENUE_SEAT_LIMIT');
    expect(await seatCount(venueId)).toBe(20_000);
  });
});
