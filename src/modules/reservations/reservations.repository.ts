/**
 * =========================================================================
 * GLOBAL LOCK ORDER
 * Every transaction that locks these entities must lock in this strict order:
 *   1. event row (FOR UPDATE for mutations, FOR SHARE for read-then-create)
 *   2. show row (FOR SHARE on booking paths, FOR UPDATE in cancelEvent)
 *   3. reservation row (FOR UPDATE)
 *   4. booking row (FOR UPDATE)
 *   5. show_seats rows (ORDER BY id ASC FOR UPDATE)
 *
 * Never lock in a different order anywhere in the codebase. Paths that only
 * know a reservation/booking id first do a plain (non-locking) SELECT of show_id
 * (with the owner check), then lock the show row before anything below it.
 * =========================================================================
 */

import { Pool, PoolClient } from 'pg';

export interface ShowForBookingRow {
  id: string;
  status: string;
  event_status: string;
  not_started: boolean;
  sales_open: boolean;
}

export interface ReservationWithSeatIdsRow {
  id: string;
  user_id: string;
  show_id: string;
  status: string;
  /** status with lazy expiry applied: ACTIVE past expires_at reads as EXPIRED */
  effective_status: string;
  expires_at: Date;
  idempotency_key: string;
  seat_ids: string[];
}

export interface InsertReservationResult {
  id: string;
  status: string;
  expires_at: Date;
}

export interface LockedSeatRow {
  id: string;
  price_paise: number;
  section: string;
  row_label: string;
  seat_number: number;
  category: string;
  is_available: boolean;
}

export interface ReservationSeatDetailRow {
  id: string;
  user_id: string;
  show_id: string;
  status: string;
  /** status with lazy expiry applied: ACTIVE past expires_at reads as EXPIRED */
  effective_status: string;
  expires_at: Date;
  seat_id: string;
  section: string;
  row_label: string;
  seat_number: number;
  category: string;
  price_paise: number;
}

export interface ReservationForUpdateRow {
  id: string;
  user_id: string;
  status: string;
}

// 0a. Plain (non-locking) read of the reservation's show — the owner check lives
// here so checkout/release can learn show_id before taking the show lock (hierarchy).
export async function getReservationOwnerShow(
  client: PoolClient,
  userId: string,
  reservationId: string
): Promise<{ id: string; user_id: string; show_id: string } | null> {
  const result = await client.query<{ id: string; user_id: string; show_id: string }>(
    'SELECT id, user_id, show_id FROM reservations WHERE id = $1 AND user_id = $2',
    [reservationId, userId]
  );
  return result.rows[0] || null;
}

// 0b. Lock the show row FOR SHARE (hierarchy level 2). Release takes this only to
// respect the hierarchy — release never requires the show to be bookable.
export async function lockShowForRelease(client: PoolClient, showId: string): Promise<void> {
  await client.query('SELECT id FROM shows WHERE id = $1 FOR SHARE', [showId]);
}

// 1. Get show for booking verification with FOR SHARE lock
export async function getShowForBooking(
  client: PoolClient,
  showId: string
): Promise<ShowForBookingRow | null> {
  // FOR SHARE OF s: prevents concurrent event/show status mutations during booking
  // while allowing concurrent reads/bookings of other seats in the same show.
  const result = await client.query<ShowForBookingRow>(
    `SELECT s.id, s.status, e.status AS event_status,
            (s.starts_at > now()) AS not_started,
            (s.sales_open_at IS NULL OR s.sales_open_at <= now()) AS sales_open
       FROM shows s JOIN events e ON e.id = s.event_id
      WHERE s.id = $1
        FOR SHARE OF s`,
    [showId]
  );
  return result.rows[0] || null;
}

// 2. Find reservation by user & idempotency key including aggregated sorted seat IDs
export async function findReservationByKey(
  client: PoolClient,
  userId: string,
  key: string
): Promise<ReservationWithSeatIdsRow | null> {
  const result = await client.query<ReservationWithSeatIdsRow>(
    `SELECT r.id, r.user_id, r.show_id, r.status, r.expires_at, r.idempotency_key,
            (CASE WHEN r.status = 'ACTIVE' AND r.expires_at <= now()
                  THEN 'EXPIRED' ELSE r.status::text END) AS effective_status,
            COALESCE(
              ARRAY_AGG(rs.show_seat_id::text ORDER BY rs.show_seat_id) FILTER (WHERE rs.show_seat_id IS NOT NULL),
              ARRAY[]::text[]
            ) AS seat_ids
       FROM reservations r
       LEFT JOIN reservation_seats rs ON rs.reservation_id = r.id
      WHERE r.user_id = $1 AND r.idempotency_key = $2
      GROUP BY r.id`,
    [userId, key]
  );
  return result.rows[0] || null;
}

// 3. Mark expired active reservations of user for this show as EXPIRED using DB clock
export async function expireStaleActiveReservations(
  client: PoolClient,
  userId: string,
  showId: string
): Promise<void> {
  // Touches only reservations, not show_seats. Leftover HELD seats are handled lazily by
  // the availability rules (status='HELD' AND held_until < now()) and later by the background sweeper.
  await client.query(
    `UPDATE reservations SET status = 'EXPIRED'
      WHERE user_id = $1 AND show_id = $2 AND status = 'ACTIVE' AND expires_at <= now()`,
    [userId, showId]
  );
}

// 4. Insert reservation row using DB clock (make_interval)
export async function insertReservation(
  client: PoolClient,
  userId: string,
  showId: string,
  key: string,
  holdSeconds: number
): Promise<InsertReservationResult | null> {
  // Why the reservation row is inserted before seats are locked:
  // Inserting the reservation row first claims the idempotency key early and triggers the
  // uq_one_active_reservation constraint immediately, avoiding unnecessary locks if invalid.
  const result = await client.query<InsertReservationResult>(
    `INSERT INTO reservations (user_id, show_id, idempotency_key, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING id, status, expires_at`,
    [userId, showId, key, holdSeconds]
  );
  return result.rows[0] || null;
}

// 5. Lock seats in order with FOR UPDATE
export async function lockSeatsInOrder(
  client: PoolClient,
  showId: string,
  seatIds: string[]
): Promise<LockedSeatRow[]> {
  // The ORDER BY ss.id before FOR UPDATE is mandatory: it is the consistent lock
  // ordering that prevents deadlocks across concurrent requests trying to reserve overlapping sets.
  const result = await client.query<LockedSeatRow>(
    `SELECT ss.id, ss.price_paise, vs.section, vs.row_label, vs.seat_number, vs.category,
            (ss.status = 'AVAILABLE' OR (ss.status = 'HELD' AND ss.held_until < now())) AS is_available
       FROM show_seats ss JOIN venue_seats vs ON vs.id = ss.venue_seat_id
      WHERE ss.show_id = $1 AND ss.id = ANY($2::uuid[])
      ORDER BY ss.id
        FOR UPDATE OF ss`,
    [showId, seatIds]
  );
  return result.rows;
}

// 6. Bulk update show_seats to HELD
export async function holdSeats(
  client: PoolClient,
  reservationId: string,
  expiresAt: Date,
  seatIds: string[]
): Promise<number> {
  const result = await client.query(
    `UPDATE show_seats SET status = 'HELD', reservation_id = $1, held_until = $2
      WHERE id = ANY($3::uuid[])`,
    [reservationId, expiresAt, seatIds]
  );
  return result.rowCount ?? 0;
}

// 7. Insert junction rows into reservation_seats
export async function insertReservationSeats(
  client: PoolClient,
  reservationId: string,
  seatIds: string[]
): Promise<void> {
  await client.query(
    `INSERT INTO reservation_seats (reservation_id, show_seat_id)
     SELECT $1, unnest($2::uuid[])`,
    [reservationId, seatIds]
  );
}

// 8. Fetch complete reservation details with seats
export async function getReservationWithSeats(
  client: PoolClient | Pool,
  userId: string,
  reservationId: string
): Promise<ReservationSeatDetailRow[]> {
  const result = await client.query<ReservationSeatDetailRow>(
    `SELECT r.id, r.user_id, r.show_id, r.status, r.expires_at,
            (CASE WHEN r.status = 'ACTIVE' AND r.expires_at <= now()
                  THEN 'EXPIRED' ELSE r.status::text END) AS effective_status,
            ss.id AS seat_id, vs.section, vs.row_label, vs.seat_number, vs.category, ss.price_paise
       FROM reservations r
       JOIN reservation_seats rs ON rs.reservation_id = r.id
       JOIN show_seats ss ON ss.id = rs.show_seat_id
       JOIN venue_seats vs ON vs.id = ss.venue_seat_id
      WHERE r.id = $1 AND r.user_id = $2
      ORDER BY vs.section, length(vs.row_label), vs.row_label, vs.seat_number`,
    [reservationId, userId]
  );
  return result.rows;
}

// 9. Lock reservation row for release
export async function getReservationForUpdate(
  client: PoolClient,
  userId: string,
  reservationId: string
): Promise<ReservationForUpdateRow | null> {
  const result = await client.query<ReservationForUpdateRow>(
    `SELECT id, user_id, status FROM reservations WHERE id = $1 AND user_id = $2 FOR UPDATE`,
    [reservationId, userId]
  );
  return result.rows[0] || null;
}

// 10. Lock held seats belonging to a reservation in order
export async function lockHeldSeatsForReservation(
  client: PoolClient,
  reservationId: string
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM show_seats WHERE reservation_id = $1 AND status = 'HELD' ORDER BY id FOR UPDATE`,
    [reservationId]
  );
  return result.rows.map((r) => r.id);
}

// 11. Release held seats back to AVAILABLE
export async function releaseHeldSeats(
  client: PoolClient,
  reservationId: string
): Promise<void> {
  await client.query(
    `UPDATE show_seats SET status = 'AVAILABLE', reservation_id = NULL, held_until = NULL
      WHERE reservation_id = $1 AND status = 'HELD'`,
    [reservationId]
  );
}

// 12. Update reservation status to RELEASED
export async function setReservationReleased(
  client: PoolClient,
  reservationId: string
): Promise<void> {
  await client.query(
    `UPDATE reservations SET status = 'RELEASED' WHERE id = $1`,
    [reservationId]
  );
}

// 13. Lock booking for a reservation (for releaseReservation)
export async function getBookingByReservationForUpdate(
  client: PoolClient,
  reservationId: string
): Promise<{ id: string; status: string } | null> {
  const result = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM bookings WHERE reservation_id = $1 FOR UPDATE`,
    [reservationId]
  );
  return result.rows[0] || null;
}

// 14. Cancel pending booking on reservation release
export async function cancelPendingBooking(
  client: PoolClient,
  bookingId: string
): Promise<void> {
  await client.query(
    `UPDATE bookings SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1 AND status = 'PENDING_PAYMENT'`,
    [bookingId]
  );
}
