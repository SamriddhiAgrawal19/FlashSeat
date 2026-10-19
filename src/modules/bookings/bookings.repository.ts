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
 * Never lock in a different order anywhere in the codebase. Checkout, confirm
 * and release only know a reservation/booking id: they first do a plain
 * (non-locking) SELECT of show_id (with the owner check), then lock the show row
 * FOR SHARE before touching reservations, bookings or seats.
 * =========================================================================
 */

import { Pool, PoolClient } from 'pg';

export interface ReservationForCheckoutRow {
  id: string;
  user_id: string;
  show_id: string;
  status: string;
  expires_at: Date;
  is_active_valid: boolean;
  /** status with lazy expiry applied: ACTIVE past expires_at reads as EXPIRED */
  effective_status: string;
}

export interface BookingRow {
  id: string;
  user_id: string;
  show_id: string;
  reservation_id: string;
  status: string;
  total_amount_paise: number;
  created_at: Date;
  confirmed_at: Date | null;
}

export interface ShowBookableStatusRow {
  id: string;
  status: string;
  event_status: string;
  not_started: boolean;
}

export interface LockedSeatForCheckoutRow {
  id: string;
  price_paise: number;
  status: string;
  reservation_id: string | null;
  hold_valid: boolean;
}

export interface BookingDetailRow {
  id: string;
  user_id: string;
  status: string;
  total_amount_paise: number;
  created_at: Date;
  confirmed_at: Date | null;
  reservation_expires_at: Date;
  /** false when the reservation is gone or lazily expired — reads report EXPIRED */
  reservation_active: boolean;
  event_id: string;
  event_title: string;
  show_id: string;
  show_starts_at: Date;
  venue_name: string;
  venue_city: string;
  total_count?: number;
  seats: Array<{
    id: string;
    section: string;
    row: string;
    number: number;
    category: string;
    pricePaise: number;
    ticketCode?: string | null;
  }>;
}

// 0. Plain (non-locking) read of the reservation's show_id with the owner check —
// done before any locking so the show row can be locked first (Rule A).
export async function getReservationRefForCheckout(
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

// 1. Lock reservation row FOR UPDATE for checkout
export async function getReservationForCheckout(
  client: PoolClient,
  userId: string,
  reservationId: string
): Promise<ReservationForCheckoutRow | null> {
  const result = await client.query<ReservationForCheckoutRow>(
    `SELECT id, user_id, show_id, status, expires_at,
            (status = 'ACTIVE' AND expires_at > now()) AS is_active_valid,
            (CASE WHEN status = 'ACTIVE' AND expires_at <= now()
                  THEN 'EXPIRED' ELSE status::text END) AS effective_status
       FROM reservations
      WHERE id = $1 AND user_id = $2
        FOR UPDATE`,
    [reservationId, userId]
  );
  return result.rows[0] || null;
}

// 2. Lock existing booking by reservation_id FOR UPDATE (for idempotent checkout)
export async function getBookingByReservationForUpdate(
  client: PoolClient,
  reservationId: string
): Promise<BookingRow | null> {
  const result = await client.query<BookingRow>(
    `SELECT id, user_id, show_id, reservation_id, status, total_amount_paise, created_at, confirmed_at
       FROM bookings
      WHERE reservation_id = $1
        FOR UPDATE`,
    [reservationId]
  );
  return result.rows[0] || null;
}

// 3. Check show bookability with FOR SHARE
export async function getShowBookableStatus(
  client: PoolClient,
  showId: string
): Promise<ShowBookableStatusRow | null> {
  const result = await client.query<ShowBookableStatusRow>(
    `SELECT s.id, s.status, e.status AS event_status,
            (s.starts_at > now()) AS not_started
       FROM shows s
       JOIN events e ON e.id = s.event_id
      WHERE s.id = $1
        FOR SHARE OF s`,
    [showId]
  );
  return result.rows[0] || null;
}

// 4. Lock reservation seats in ascending ID order and check Rule D
export async function lockReservationSeatsInOrder(
  client: PoolClient,
  reservationId: string
): Promise<{ seats: LockedSeatForCheckoutRow[]; expectedCount: number }> {
  // Count expected seats recorded in reservation_seats
  const countResult = await client.query<{ count: string | number }>(
    `SELECT count(*)::int as count FROM reservation_seats WHERE reservation_id = $1`,
    [reservationId]
  );
  const expectedCount = Number(countResult.rows[0]?.count ?? 0);

  // Lock show_seats in ascending ID order (Rule A: lock order hierarchy)
  const result = await client.query<LockedSeatForCheckoutRow>(
    `SELECT ss.id, ss.price_paise, ss.status, ss.reservation_id,
            (ss.held_until > now()) AS hold_valid
       FROM reservation_seats rs JOIN show_seats ss ON ss.id = rs.show_seat_id
      WHERE rs.reservation_id = $1
      ORDER BY ss.id FOR UPDATE OF ss`,
    [reservationId]
  );

  return {
    seats: result.rows,
    expectedCount,
  };
}

// 5. Insert new PENDING_PAYMENT booking
export async function insertBooking(
  client: PoolClient,
  userId: string,
  showId: string,
  reservationId: string,
  totalAmountPaise: number
): Promise<BookingRow> {
  const result = await client.query<BookingRow>(
    `INSERT INTO bookings (user_id, show_id, reservation_id, total_amount_paise, status)
     VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT')
     RETURNING id, user_id, show_id, reservation_id, status, total_amount_paise, created_at, confirmed_at`,
    [userId, showId, reservationId, totalAmountPaise]
  );
  return result.rows[0];
}

// 6. Read booking row without lock (step 1 of confirmBookingCore); joins the
// reservation only to learn show_id before taking the show lock.
export async function findBookingById(
  client: PoolClient | Pool,
  bookingId: string
): Promise<{ id: string; user_id: string; reservation_id: string; status: string; show_id: string } | null> {
  const result = await client.query<{ id: string; user_id: string; reservation_id: string; status: string; show_id: string }>(
    `SELECT b.id, b.user_id, b.reservation_id, b.status, r.show_id
       FROM bookings b
       JOIN reservations r ON r.id = b.reservation_id
      WHERE b.id = $1`,
    [bookingId]
  );
  return result.rows[0] || null;
}

// 7. Lock reservation row by id FOR UPDATE (step 2 of confirmBookingCore)
export async function lockReservationForConfirm(
  client: PoolClient,
  reservationId: string
): Promise<{ id: string; status: string; expires_at: Date; is_active_valid: boolean } | null> {
  const result = await client.query<{ id: string; status: string; expires_at: Date; is_active_valid: boolean }>(
    `SELECT id, status, expires_at,
            (status = 'ACTIVE' AND expires_at > now()) AS is_active_valid
       FROM reservations
      WHERE id = $1
        FOR UPDATE`,
    [reservationId]
  );
  return result.rows[0] || null;
}

// 8. Lock booking row by id FOR UPDATE (step 2 of confirmBookingCore)
export async function lockBookingForConfirm(
  client: PoolClient,
  bookingId: string
): Promise<BookingRow | null> {
  const result = await client.query<BookingRow>(
    `SELECT id, user_id, show_id, reservation_id, status, total_amount_paise, created_at, confirmed_at
       FROM bookings
      WHERE id = $1
        FOR UPDATE`,
    [bookingId]
  );
  return result.rows[0] || null;
}

// 9. Update show_seats to BOOKED
export async function markSeatsBooked(
  client: PoolClient,
  bookingId: string,
  seatIds: string[]
): Promise<number> {
  const result = await client.query(
    `UPDATE show_seats
        SET status = 'BOOKED', booking_id = $1, reservation_id = NULL, held_until = NULL
      WHERE id = ANY($2::uuid[])`,
    [bookingId, seatIds]
  );
  return result.rowCount ?? 0;
}

// 10. Bulk insert into booking_seats (the tickets)
export async function insertBookingSeats(
  client: PoolClient,
  bookingId: string,
  seatIds: string[]
): Promise<number> {
  const result = await client.query<{ price_paise: number }>(
    `INSERT INTO booking_seats (booking_id, show_seat_id, price_paise)
     SELECT $1, ss.id, ss.price_paise
       FROM show_seats ss
      WHERE ss.id = ANY($2::uuid[])
     RETURNING price_paise`,
    [bookingId, seatIds]
  );
  return result.rows.reduce((sum, r) => sum + r.price_paise, 0);
}

// 11. Finalize booking & reservation status to CONFIRMED
export async function setBookingAndReservationConfirmed(
  client: PoolClient,
  bookingId: string,
  reservationId: string
): Promise<void> {
  await client.query(
    `UPDATE bookings SET status = 'CONFIRMED', confirmed_at = now() WHERE id = $1`,
    [bookingId]
  );
  await client.query(
    `UPDATE reservations SET status = 'CONFIRMED' WHERE id = $1`,
    [reservationId]
  );
}

// 12. Get single booking details with seats & venue info
export async function getBookingDetailById(
  client: PoolClient | Pool,
  bookingId: string
): Promise<BookingDetailRow | null> {
  const result = await client.query<BookingDetailRow>(
    `SELECT b.id, b.user_id, b.status, b.total_amount_paise, b.created_at, b.confirmed_at,
            r.expires_at AS reservation_expires_at,
            (r.status = 'ACTIVE' AND r.expires_at > now()) AS reservation_active,
            e.id AS event_id, e.title AS event_title,
            s.id AS show_id, s.starts_at AS show_starts_at,
            v.name AS venue_name, v.city AS venue_city,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', ss.id,
                  'section', vs.section,
                  'row', vs.row_label,
                  'number', vs.seat_number,
                  'category', vs.category,
                  'pricePaise', ss.price_paise,
                  'ticketCode', CASE WHEN b.status = 'CONFIRMED' THEN bs.ticket_code ELSE NULL END
                ) ORDER BY vs.section, length(vs.row_label), vs.row_label, vs.seat_number
              ) FILTER (WHERE ss.id IS NOT NULL),
              '[]'::json
            ) AS seats
       FROM bookings b
       JOIN reservations r ON r.id = b.reservation_id
       JOIN shows s ON s.id = b.show_id
       JOIN events e ON e.id = s.event_id
       JOIN venues v ON v.id = s.venue_id
       JOIN reservation_seats rs ON rs.reservation_id = b.reservation_id
       JOIN show_seats ss ON ss.id = rs.show_seat_id
       JOIN venue_seats vs ON vs.id = ss.venue_seat_id
       LEFT JOIN booking_seats bs ON bs.booking_id = b.id AND bs.show_seat_id = ss.id AND bs.released_at IS NULL
      WHERE b.id = $1
      GROUP BY b.id, r.expires_at, r.status, e.id, e.title, s.id, s.starts_at, v.name, v.city`,
    [bookingId]
  );
  return result.rows[0] || null;
}

// 13. List user's bookings with pagination (single query with json_agg and window total_count)
export async function listUserBookings(
  client: PoolClient | Pool,
  userId: string,
  limit: number,
  offset: number
): Promise<{ rows: BookingDetailRow[]; total: number }> {
  const result = await client.query<BookingDetailRow>(
    `SELECT b.id, b.user_id, b.status, b.total_amount_paise, b.created_at, b.confirmed_at,
            r.expires_at AS reservation_expires_at,
            (r.status = 'ACTIVE' AND r.expires_at > now()) AS reservation_active,
            e.id AS event_id, e.title AS event_title,
            s.id AS show_id, s.starts_at AS show_starts_at,
            v.name AS venue_name, v.city AS venue_city,
            count(*) OVER()::int AS total_count,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', ss.id,
                  'section', vs.section,
                  'row', vs.row_label,
                  'number', vs.seat_number,
                  'category', vs.category,
                  'pricePaise', ss.price_paise,
                  'ticketCode', CASE WHEN b.status = 'CONFIRMED' THEN bs.ticket_code ELSE NULL END
                ) ORDER BY vs.section, length(vs.row_label), vs.row_label, vs.seat_number
              ) FILTER (WHERE ss.id IS NOT NULL),
              '[]'::json
            ) AS seats
       FROM bookings b
       JOIN reservations r ON r.id = b.reservation_id
       JOIN shows s ON s.id = b.show_id
       JOIN events e ON e.id = s.event_id
       JOIN venues v ON v.id = s.venue_id
       JOIN reservation_seats rs ON rs.reservation_id = b.reservation_id
       JOIN show_seats ss ON ss.id = rs.show_seat_id
       JOIN venue_seats vs ON vs.id = ss.venue_seat_id
       LEFT JOIN booking_seats bs ON bs.booking_id = b.id AND bs.show_seat_id = ss.id AND bs.released_at IS NULL
      WHERE b.user_id = $1
      GROUP BY b.id, r.expires_at, r.status, e.id, e.title, s.id, s.starts_at, v.name, v.city
      ORDER BY b.created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const total = result.rows[0]?.total_count ?? 0;
  return {
    rows: result.rows,
    total,
  };
}
