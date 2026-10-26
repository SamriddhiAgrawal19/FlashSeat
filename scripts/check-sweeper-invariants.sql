-- =====================================================================
-- FlashSeat Sweeper Invariant Checker
-- Every query MUST return ZERO rows once a sweep has run and nothing
-- new has expired in the meantime.  The 1-minute grace window accounts
-- for the sweeper's own cycle time.
-- =====================================================================

\echo '--- S1. ACTIVE reservations expired > 1 minute ago ---'
SELECT id, show_id, expires_at
  FROM reservations
 WHERE status = 'ACTIVE'
   AND expires_at < now() - interval '1 minute';

\echo '--- S2. HELD seats expired > 1 minute ago ---'
SELECT id, show_id, held_until
  FROM show_seats
 WHERE status = 'HELD'
   AND held_until < now() - interval '1 minute';

\echo '--- S3. PENDING_PAYMENT bookings whose reservation is EXPIRED or RELEASED ---'
SELECT b.id, b.reservation_id, b.status AS booking_status, r.status AS reservation_status
  FROM bookings b
  JOIN reservations r ON r.id = b.reservation_id
 WHERE b.status = 'PENDING_PAYMENT'
   AND r.status IN ('EXPIRED', 'RELEASED');
