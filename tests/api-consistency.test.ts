/**
 * API consistency + KNOWN BUGS. Tests marked it.fails encode the DESIRED
 * behaviour and are expected to fail against the current code; each one is
 * listed in docs/review/test-findings.md. When the bug is fixed the test starts
 * passing — vitest will flag it so the it.fails marker can be removed.
 */
import { describe, expect, it } from 'vitest';
import { api, hasErrorShape, hold, register, setupShow } from './helpers';

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

describe('KNOWN BUGS (expected to fail — see docs/review/test-findings.md)', () => {
  it.fails('L-9: GET /events/:eventId/shows/:showId must 404 when the show belongs to another event', async () => {
    const a = await setupShow('apiL9', 1);
    const other = await setupShow('apiL9b', 1);
    // other.showId is NOT part of a.eventId — must be 404, currently 200
    const r = await api('GET', `/events/${a.eventId}/shows/${other.showId}`);
    expect(r.status).toBe(404);
  });

  it.fails('M-5: bulk seat creation must reject oversized layouts with 400 VALIDATION_ERROR', async () => {
    const org = await register('apiM5', { role: 'ORGANIZER' });
    const venue = await api('POST', '/venues', {
      token: org.token,
      body: { name: 'Huge Arena', address: '1 Way', city: 'Ville' },
    });
    // 100 rows x 200 seats = 20k seats = 100k bind params > pg\'s 65535 limit
    const rows = Array.from({ length: 100 }, (_, i) => `R${i}`);
    const r = await api('POST', `/venues/${venue.data.id}/seats/bulk`, {
      token: org.token,
      body: { mode: 'GRID', section: 'MAIN', rows, seatsPerRow: 200, category: 'REGULAR' },
    });
    expect(r.status).toBe(400);
    expect(r.data.error.code).toBe('VALIDATION_ERROR');
  });
});
