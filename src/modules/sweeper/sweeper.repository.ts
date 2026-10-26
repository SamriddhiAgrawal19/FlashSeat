/**
 * Sweeper repository — raw SQL for discovering and cleaning expired state.
 * Every function takes a PoolClient so calls run inside the caller's transaction.
 */
import { PoolClient } from 'pg';

export async function findShowsWithExpiredState(
  client: PoolClient,
  limit: number,
  excludedShowIds: string[]
): Promise<string[]> {
  // Plain read, no locks — just discovers candidate shows.
  const result = await client.query<{ show_id: string }>(
    `SELECT show_id FROM (
       SELECT show_id FROM reservations WHERE status = 'ACTIVE' AND expires_at <= now()
       UNION
       SELECT show_id FROM show_seats WHERE status = 'HELD' AND held_until <= now()
       UNION
       SELECT b.show_id FROM bookings b JOIN reservations r ON r.id = b.reservation_id
        WHERE b.status = 'PENDING_PAYMENT' AND r.status = 'EXPIRED'
     ) sub
     WHERE show_id != ALL($1::uuid[])
     ORDER BY show_id
     LIMIT $2`,
    [excludedShowIds, limit]
  );
  return result.rows.map((r) => r.show_id);
}

export async function lockShowShareSkipLocked(
  client: PoolClient,
  showId: string
): Promise<boolean> {
  const result = await client.query(
    'SELECT id FROM shows WHERE id = $1 FOR SHARE SKIP LOCKED',
    [showId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Locks the show's reservations that need sweeping, in one ascending-id pass:
 *  - ACTIVE reservations past expires_at (to be marked EXPIRED), and
 *  - "stranded" reservations: already EXPIRED (the API lazily expires a user's
 *    stale reservation when they hold again, see expireStaleActiveReservations)
 *    but still owning a PENDING_PAYMENT booking that nothing else will close.
 * Both kinds are needed as the parent lock for lockPendingBookings.
 */
export async function lockExpiredReservations(
  client: PoolClient,
  showId: string,
  limit: number
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM reservations r
      WHERE show_id = $1
        AND ((status = 'ACTIVE' AND expires_at <= now())
          OR (status = 'EXPIRED' AND EXISTS (
                SELECT 1 FROM bookings b WHERE b.reservation_id = r.id AND b.status = 'PENDING_PAYMENT')))
      ORDER BY id LIMIT $2
      FOR UPDATE SKIP LOCKED`,
    [showId, limit]
  );
  return result.rows.map((r) => r.id);
}

export async function lockPendingBookings(
  client: PoolClient,
  reservationIds: string[]
): Promise<string[]> {
  if (reservationIds.length === 0) return [];
  // No SKIP LOCKED: these booking rows are uncontested while we hold the parent
  // reservation locks (FOR UPDATE) and the show row (FOR SHARE).
  //  - checkout, confirm and release lock the reservation before its booking,
  //    so they queue on the reservation lock we hold.
  //  - cancelEvent locks bookings WITHOUT their reservations (it takes every
  //    PENDING_PAYMENT/CONFIRMED booking of the event, stranded ones included),
  //    but only after locking the show FOR UPDATE, which conflicts with our
  //    FOR SHARE: it either waits for this transaction or already holds the
  //    show, in which case lockShowShareSkipLocked skipped the show.
  const result = await client.query<{ id: string }>(
    `SELECT id FROM bookings
      WHERE reservation_id = ANY($1::uuid[]) AND status = 'PENDING_PAYMENT'
      ORDER BY id
      FOR UPDATE`,
    [reservationIds]
  );
  return result.rows.map((r) => r.id);
}

export async function lockExpiredHeldSeats(
  client: PoolClient,
  showId: string,
  limit: number
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM show_seats
      WHERE show_id = $1 AND status = 'HELD' AND held_until <= now()
      ORDER BY id LIMIT $2
      FOR UPDATE SKIP LOCKED`,
    [showId, limit]
  );
  return result.rows.map((r) => r.id);
}

export async function expireReservations(
  client: PoolClient,
  ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await client.query(
    `UPDATE reservations SET status = 'EXPIRED'
      WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE' AND expires_at <= now()`,
    [ids]
  );
  return result.rowCount ?? 0;
}

export async function expireBookings(
  client: PoolClient,
  ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await client.query(
    `UPDATE bookings SET status = 'EXPIRED'
      WHERE id = ANY($1::uuid[]) AND status = 'PENDING_PAYMENT'`,
    [ids]
  );
  return result.rowCount ?? 0;
}

export async function freeSeats(
  client: PoolClient,
  ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await client.query(
    `UPDATE show_seats
        SET status = 'AVAILABLE', reservation_id = NULL, held_until = NULL
      WHERE id = ANY($1::uuid[]) AND status = 'HELD' AND held_until <= now()`,
    [ids]
  );
  return result.rowCount ?? 0;
}
