BEGIN;

DO $$
DECLARE
  v_user_id        uuid := gen_random_uuid();
  v_venue_id       uuid := gen_random_uuid();
  v_venue_seat1_id uuid := gen_random_uuid();
  v_venue_seat2_id uuid := gen_random_uuid();
  v_event_id       uuid := gen_random_uuid();
  v_show_a_id      uuid := gen_random_uuid();
  v_show_b_id      uuid := gen_random_uuid();
  v_show_seat1_id  uuid := gen_random_uuid();
  v_show_seat2_id  uuid := gen_random_uuid();
  v_res_a_id       uuid := gen_random_uuid();
  v_res_b_id       uuid := gen_random_uuid();
  v_res_bk1_id     uuid := gen_random_uuid();
  v_res_bk2_id     uuid := gen_random_uuid();
  v_booking1_id    uuid := gen_random_uuid();
  v_booking2_id    uuid := gen_random_uuid();
BEGIN
  -- -------------------------------------------------------------------
  -- Seed minimal test data
  -- -------------------------------------------------------------------
  -- 1. User
  INSERT INTO users (id, name, email, password_hash, role)
  VALUES (v_user_id, 'Verifier', 'verifier@flashseat.test', 'hash123', 'ORGANIZER');

  -- 2. Venue & 2 venue_seats
  INSERT INTO venues (id, owner_id, name, address, city)
  VALUES (v_venue_id, v_user_id, 'Arena', '100 Main St', 'Metropolis');

  INSERT INTO venue_seats (id, venue_id, section, row_label, seat_number, category)
  VALUES
    (v_venue_seat1_id, v_venue_id, 'MAIN', 'A', 1, 'REGULAR'),
    (v_venue_seat2_id, v_venue_id, 'MAIN', 'A', 2, 'REGULAR');

  -- 3. Event
  INSERT INTO events (id, organizer_id, title, category, status)
  VALUES (v_event_id, v_user_id, 'Rock Fest', 'MUSIC', 'PUBLISHED');

  -- 4. Shows: Show A and Show B (non-overlapping time ranges)
  INSERT INTO shows (id, event_id, venue_id, starts_at, ends_at, status)
  VALUES
    (v_show_a_id, v_event_id, v_venue_id, now() + interval '1 day', now() + interval '1 day 2 hours', 'SCHEDULED'),
    (v_show_b_id, v_event_id, v_venue_id, now() + interval '2 days', now() + interval '2 days 2 hours', 'SCHEDULED');

  -- 5. Two show_seats for Show A
  INSERT INTO show_seats (id, show_id, venue_seat_id, price_paise, status)
  VALUES
    (v_show_seat1_id, v_show_a_id, v_venue_seat1_id, 50000, 'AVAILABLE'),
    (v_show_seat2_id, v_show_a_id, v_venue_seat2_id, 50000, 'AVAILABLE');

  -- 6. Reservations (one for Show A, one for Show B)
  INSERT INTO reservations (id, user_id, show_id, status, expires_at, idempotency_key)
  VALUES
    (v_res_a_id, v_user_id, v_show_a_id, 'ACTIVE', now() + interval '10 minutes', 'idem-res-a'),
    (v_res_b_id, v_user_id, v_show_b_id, 'ACTIVE', now() + interval '10 minutes', 'idem-res-b');

  -- 7. Two reservations and bookings for Show A (used in booking_seats tests)
  INSERT INTO reservations (id, user_id, show_id, status, expires_at, idempotency_key)
  VALUES
    (v_res_bk1_id, v_user_id, v_show_a_id, 'CONFIRMED', now() + interval '10 minutes', 'idem-bk-1'),
    (v_res_bk2_id, v_user_id, v_show_a_id, 'CONFIRMED', now() + interval '10 minutes', 'idem-bk-2');

  INSERT INTO bookings (id, user_id, show_id, reservation_id, status, total_amount_paise)
  VALUES
    (v_booking1_id, v_user_id, v_show_a_id, v_res_bk1_id, 'CONFIRMED', 50000),
    (v_booking2_id, v_user_id, v_show_a_id, v_res_bk2_id, 'CONFIRMED', 50000);

  -- -------------------------------------------------------------------
  -- 1. show_seats row with status='HELD' but reservation_id NULL -> check_violation (chk_show_seat_hold)
  -- -------------------------------------------------------------------
  BEGIN
    UPDATE show_seats
    SET status = 'HELD', reservation_id = NULL, held_until = now() + interval '10 minutes'
    WHERE id = v_show_seat1_id;
    RAISE NOTICE 'FAIL: 1. show_seats status=HELD with reservation_id NULL';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: 1. show_seats status=HELD with reservation_id NULL';
    WHEN OTHERS THEN
      RAISE NOTICE 'FAIL: 1. show_seats status=HELD with reservation_id NULL (unexpected error: %)', SQLERRM;
  END;

  -- -------------------------------------------------------------------
  -- 2. show_seats row with status='AVAILABLE' but held_until NOT NULL -> check_violation (chk_show_seat_hold)
  -- -------------------------------------------------------------------
  BEGIN
    UPDATE show_seats
    SET status = 'AVAILABLE', reservation_id = NULL, held_until = now() + interval '10 minutes'
    WHERE id = v_show_seat1_id;
    RAISE NOTICE 'FAIL: 2. show_seats status=AVAILABLE with held_until NOT NULL';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: 2. show_seats status=AVAILABLE with held_until NOT NULL';
    WHEN OTHERS THEN
      RAISE NOTICE 'FAIL: 2. show_seats status=AVAILABLE with held_until NOT NULL (unexpected error: %)', SQLERRM;
  END;

  -- -------------------------------------------------------------------
  -- 3. show_seats row with status='BOOKED' but booking_id NULL -> check_violation (chk_show_seat_booked)
  -- -------------------------------------------------------------------
  BEGIN
    UPDATE show_seats
    SET status = 'BOOKED', booking_id = NULL
    WHERE id = v_show_seat1_id;
    RAISE NOTICE 'FAIL: 3. show_seats status=BOOKED with booking_id NULL';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: 3. show_seats status=BOOKED with booking_id NULL';
    WHEN OTHERS THEN
      RAISE NOTICE 'FAIL: 3. show_seats status=BOOKED with booking_id NULL (unexpected error: %)', SQLERRM;
  END;

  -- -------------------------------------------------------------------
  -- 4. A seat of show A pointing at a reservation that belongs to show B -> foreign_key_violation (composite FK)
  -- -------------------------------------------------------------------
  BEGIN
    UPDATE show_seats
    SET status = 'HELD', reservation_id = v_res_b_id, held_until = now() + interval '10 minutes'
    WHERE id = v_show_seat1_id;
    RAISE NOTICE 'FAIL: 4. seat of show A pointing at reservation of show B';
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE NOTICE 'PASS: 4. seat of show A pointing at reservation of show B';
    WHEN OTHERS THEN
      RAISE NOTICE 'FAIL: 4. seat of show A pointing at reservation of show B (unexpected error: %)', SQLERRM;
  END;

  -- -------------------------------------------------------------------
  -- 5. Two booking_seats rows for the same show_seat_id, both with released_at NULL -> unique_violation (uq_one_live_ticket_per_seat)
  -- -------------------------------------------------------------------
  BEGIN
    INSERT INTO booking_seats (booking_id, show_seat_id, price_paise, released_at)
    VALUES (v_booking1_id, v_show_seat1_id, 50000, NULL);

    INSERT INTO booking_seats (booking_id, show_seat_id, price_paise, released_at)
    VALUES (v_booking2_id, v_show_seat1_id, 50000, NULL);

    RAISE NOTICE 'FAIL: 5. two live tickets for same show_seat_id';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: 5. two live tickets for same show_seat_id';
    WHEN OTHERS THEN
      RAISE NOTICE 'FAIL: 5. two live tickets for same show_seat_id (unexpected error: %)', SQLERRM;
  END;

  -- -------------------------------------------------------------------
  -- 6. Same two booking_seats rows but the first has released_at set -> must SUCCEED (seat can be re-sold after release)
  -- -------------------------------------------------------------------
  BEGIN
    INSERT INTO booking_seats (booking_id, show_seat_id, price_paise, released_at)
    VALUES (v_booking1_id, v_show_seat1_id, 50000, now());

    INSERT INTO booking_seats (booking_id, show_seat_id, price_paise, released_at)
    VALUES (v_booking2_id, v_show_seat1_id, 50000, NULL);

    RAISE NOTICE 'PASS: 6. re-selling seat after release succeeds';

    DELETE FROM booking_seats WHERE show_seat_id = v_show_seat1_id;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'FAIL: 6. re-selling seat after release succeeds (unexpected error: %)', SQLERRM;
  END;

  -- -------------------------------------------------------------------
  -- 7. Two ACTIVE reservations for the same (user_id, show_id) -> unique_violation (uq_one_active_reservation)
  -- -------------------------------------------------------------------
  BEGIN
    INSERT INTO reservations (user_id, show_id, status, expires_at, idempotency_key)
    VALUES (v_user_id, v_show_a_id, 'ACTIVE', now() + interval '10 minutes', 'idem-active-conflict');
    RAISE NOTICE 'FAIL: 7. two active reservations for same user and show';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: 7. two active reservations for same user and show';
    WHEN OTHERS THEN
      RAISE NOTICE 'FAIL: 7. two active reservations for same user and show (unexpected error: %)', SQLERRM;
  END;

  -- -------------------------------------------------------------------
  -- 8. Two reservations with the same (user_id, idempotency_key) -> unique_violation
  -- -------------------------------------------------------------------
  BEGIN
    INSERT INTO reservations (user_id, show_id, status, expires_at, idempotency_key)
    VALUES (v_user_id, v_show_b_id, 'EXPIRED', now() - interval '10 minutes', 'idem-res-a');
    RAISE NOTICE 'FAIL: 8. two reservations with same user and idempotency_key';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: 8. two reservations with same user and idempotency_key';
    WHEN OTHERS THEN
      RAISE NOTICE 'FAIL: 8. two reservations with same user and idempotency_key (unexpected error: %)', SQLERRM;
  END;

END $$;

ROLLBACK;
