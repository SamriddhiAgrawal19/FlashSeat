-- =====================================================================
-- FlashSeat Invariant Checker
-- Every query in this file MUST return ZERO rows on a healthy database.
-- =====================================================================

\echo '--- 1. show_seats BOOKED without exactly one live booking_seat ---'
SELECT ss.id, ss.show_id, ss.status, count(bs.id) AS live_tickets_count
  FROM show_seats ss
  LEFT JOIN booking_seats bs ON bs.show_seat_id = ss.id AND bs.released_at IS NULL
 WHERE ss.status = 'BOOKED'
 GROUP BY ss.id, ss.show_id, ss.status
HAVING count(bs.id) <> 1;

\echo '--- 2. live booking_seats whose show_seat is not BOOKED or booking_id mismatch ---'
SELECT bs.id, bs.booking_id, bs.show_seat_id, ss.status AS seat_status, ss.booking_id AS seat_booking_id
  FROM booking_seats bs
  JOIN show_seats ss ON ss.id = bs.show_seat_id
 WHERE bs.released_at IS NULL
   AND (ss.status <> 'BOOKED' OR ss.booking_id IS DISTINCT FROM bs.booking_id);

\echo '--- 3. invalid HELD show_seats ---'
SELECT ss.id, ss.status, ss.reservation_id, ss.held_until, r.status AS reservation_status
  FROM show_seats ss
  LEFT JOIN reservations r ON r.id = ss.reservation_id
 WHERE ss.status = 'HELD'
   AND (
     ss.reservation_id IS NULL
     OR r.status IN ('RELEASED', 'CONFIRMED')
     OR (ss.held_until > now() AND r.status <> 'ACTIVE')
   );

\echo '--- 4. CONFIRMED bookings with price or seat count mismatch ---'
SELECT b.id, b.total_amount_paise,
       COALESCE(bs_agg.sum_price, 0) AS tickets_total_price,
       COALESCE(bs_agg.count_tickets, 0) AS live_tickets_count,
       COALESCE(rs_agg.count_res_seats, 0) AS res_seats_count
  FROM bookings b
  LEFT JOIN (
    SELECT booking_id, sum(price_paise) AS sum_price, count(*) AS count_tickets
      FROM booking_seats
     WHERE released_at IS NULL
     GROUP BY booking_id
  ) bs_agg ON bs_agg.booking_id = b.id
  LEFT JOIN (
    SELECT reservation_id, count(*) AS count_res_seats
      FROM reservation_seats
     GROUP BY reservation_id
  ) rs_agg ON rs_agg.reservation_id = b.reservation_id
 WHERE b.status = 'CONFIRMED'
   AND (
     COALESCE(bs_agg.sum_price, 0) <> b.total_amount_paise
     OR COALESCE(bs_agg.count_tickets, 0) <> COALESCE(rs_agg.count_res_seats, 0)
   );

\echo '--- 5. BOOKED seats whose booking status is not CONFIRMED or REFUND_PENDING ---'
SELECT ss.id, ss.booking_id, b.status AS booking_status
  FROM show_seats ss
  LEFT JOIN bookings b ON b.id = ss.booking_id
 WHERE ss.status = 'BOOKED'
   AND (b.status IS NULL OR b.status NOT IN ('CONFIRMED', 'REFUND_PENDING'));

\echo '--- 6. CONFIRMED reservations without CONFIRMED booking ---'
SELECT r.id, r.user_id, r.status AS reservation_status
  FROM reservations r
  LEFT JOIN bookings b ON b.reservation_id = r.id AND b.status = 'CONFIRMED'
 WHERE r.status = 'CONFIRMED'
   AND b.id IS NULL;
