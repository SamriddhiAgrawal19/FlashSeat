/**
 * Hold-creation idempotency under a same-key race.
 *
 * Bug: two concurrent requests with the same Idempotency-Key could both pass the
 * key lookup; the loser's INSERT ... ON CONFLICT (user_id, idempotency_key) DO
 * NOTHING only absorbs a conflict on that arbiter index, so it could instead
 * collide with the winner's row on uq_one_active_reservation (one ACTIVE hold per
 * user per show) and surface as 409 ACTIVE_RESERVATION_EXISTS instead of a replay.
 * Observed as ~2.5% of same-key retries (smoke-concurrency Scenario 3).
 */
import { describe, expect, it } from 'vitest';
import { db, hold, register, setupShow } from './helpers';

const rnd = () => Math.random().toString(36).slice(2, 8);

describe('hold idempotency under concurrency', () => {
  it('20 concurrent identical holds => one 201 + nineteen 200 replays of the same reservation (10 runs)', async () => {
    const RUNS = 10;
    const CONCURRENT = 20;
    const s = await setupShow('idemRace', RUNS);

    for (let run = 0; run < RUNS; run++) {
      const u = await register(`idemRace_u${run}`);
      const key = `idemRace-${run}-${rnd()}`;
      const seat = [s.seatIds[run]];

      const results = await Promise.all(Array.from({ length: CONCURRENT }, () => hold(u, s.showId, key, seat)));
      const summary = JSON.stringify(results.map((r) => (r.status >= 400 ? `${r.status} ${r.data?.error?.code}` : r.status)));

      expect(results.filter((r) => r.status === 201), `run ${run}: ${summary}`).toHaveLength(1);
      expect(results.filter((r) => r.status === 200), `run ${run}: ${summary}`).toHaveLength(CONCURRENT - 1);
      const ids = new Set(results.map((r) => r.data?.reservation?.id));
      expect([...ids], `run ${run}`).toHaveLength(1);

      // exactly one reservation row for this user/show, holding the seat
      const rows = await db<{ id: string; status: string }>(
        'SELECT id, status FROM reservations WHERE user_id = $1 AND show_id = $2', [u.id, s.showId]
      );
      expect(rows).toEqual([{ id: [...ids][0], status: 'ACTIVE' }]);
      const [seatRow] = await db<{ status: string; reservation_id: string }>(
        'SELECT status, reservation_id FROM show_seats WHERE id = $1', [seat[0]]
      );
      expect(seatRow).toEqual({ status: 'HELD', reservation_id: rows[0].id });
    }
  });

  it('a DIFFERENT key while the user already holds seats for the show => 409 ACTIVE_RESERVATION_EXISTS', async () => {
    const s = await setupShow('idemOther', 2);
    const first = await hold(s.user, s.showId, `idemOther-1-${rnd()}`, [s.seatIds[0]]);
    expect(first.status).toBe(201);

    const second = await hold(s.user, s.showId, `idemOther-2-${rnd()}`, [s.seatIds[1]]);
    expect(second.status).toBe(409);
    expect(second.data.error.code).toBe('ACTIVE_RESERVATION_EXISTS');

    const [seat] = await db<{ status: string }>('SELECT status FROM show_seats WHERE id = $1', [s.seatIds[1]]);
    expect(seat.status).toBe('AVAILABLE');
  });
});
