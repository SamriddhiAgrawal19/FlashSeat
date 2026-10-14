-- Up Migration

-- =====================================================================
-- FlashSeat — Migration 002: Phase 2 Booking Engine
-- Tables: reservations, bookings, show_seats, reservation_seats, booking_seats
-- (payments / refunds / webhook_events come later in Phase 3)
--
-- Design decision: PostgreSQL is the authority for seat holds.
--   * A hold = show_seats.status='HELD' + reservation_id + held_until.
--   * Acquiring seats is ONE atomic UPDATE (implemented in a later step).
--   * Redis is only a fast-path in front, never the source of truth.
--
-- Creation order matters: reservations -> bookings -> show_seats -> junction tables.
-- =====================================================================

-- ---------- Enums ----------
CREATE TYPE show_seat_status   AS ENUM ('AVAILABLE', 'HELD', 'BOOKED', 'BLOCKED');
CREATE TYPE reservation_status AS ENUM ('ACTIVE', 'CONFIRMED', 'EXPIRED', 'RELEASED');
CREATE TYPE booking_status     AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'PAYMENT_FAILED',
                                        'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED');

-- ---------- reservations: a user's temporary hold on seats ----------
CREATE TABLE reservations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid               NOT NULL REFERENCES users(id),
  show_id         uuid               NOT NULL REFERENCES shows(id),
  status          reservation_status NOT NULL DEFAULT 'ACTIVE',
  expires_at      timestamptz        NOT NULL,
  idempotency_key text               NOT NULL,
  created_at      timestamptz        NOT NULL DEFAULT now(),
  updated_at      timestamptz        NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),   -- same request retried => same reservation
  UNIQUE (id, show_id)                 -- target for composite FKs (seat must belong to the same show)
);
-- One active reservation per user per show (anti-hoarding).
-- App must first mark stale reservations (expires_at < now()) EXPIRED in the same transaction.
CREATE UNIQUE INDEX uq_one_active_reservation
  ON reservations(user_id, show_id) WHERE status = 'ACTIVE';
-- The expiry sweeper uses this.
CREATE INDEX idx_reservations_expiry
  ON reservations(expires_at) WHERE status = 'ACTIVE';

-- ---------- bookings: created at checkout ----------
CREATE TABLE bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid           NOT NULL REFERENCES users(id),
  show_id            uuid           NOT NULL REFERENCES shows(id),
  reservation_id     uuid           NOT NULL UNIQUE,   -- one booking per reservation
  status             booking_status NOT NULL DEFAULT 'PENDING_PAYMENT',
  total_amount_paise bigint         NOT NULL CHECK (total_amount_paise >= 0),
  confirmed_at       timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz    NOT NULL DEFAULT now(),
  updated_at         timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (id, show_id),
  FOREIGN KEY (reservation_id, show_id) REFERENCES reservations(id, show_id)
);
CREATE INDEX idx_bookings_user ON bookings(user_id, created_at DESC);
CREATE INDEX idx_bookings_show_status ON bookings(show_id, status);

-- ---------- show_seats: the hottest table, one row per (show, physical seat) ----------
-- price_paise is a snapshot copied from show_category_prices at show creation.
CREATE TABLE show_seats (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id        uuid             NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  venue_seat_id  uuid             NOT NULL REFERENCES venue_seats(id),
  price_paise    int              NOT NULL CHECK (price_paise >= 0),
  status         show_seat_status NOT NULL DEFAULT 'AVAILABLE',
  reservation_id uuid,            -- set only while HELD
  held_until     timestamptz,     -- set only while HELD
  booking_id     uuid,            -- set only while BOOKED
  updated_at     timestamptz      NOT NULL DEFAULT now(),
  UNIQUE (show_id, venue_seat_id),
  -- composite FKs: the hold/booking must belong to the SAME show as the seat
  FOREIGN KEY (reservation_id, show_id) REFERENCES reservations(id, show_id),
  FOREIGN KEY (booking_id, show_id)     REFERENCES bookings(id, show_id),
  -- state consistency enforced by the DB, not by app discipline
  CONSTRAINT chk_show_seat_hold CHECK (
    (status = 'HELD' AND reservation_id IS NOT NULL AND held_until IS NOT NULL)
    OR (status <> 'HELD' AND reservation_id IS NULL AND held_until IS NULL)
  ),
  CONSTRAINT chk_show_seat_booked CHECK ((status = 'BOOKED') = (booking_id IS NOT NULL))
);
CREATE INDEX idx_show_seats_show_status ON show_seats(show_id, status);
CREATE INDEX idx_show_seats_hold_expiry ON show_seats(held_until) WHERE status = 'HELD';
CREATE INDEX idx_show_seats_reservation ON show_seats(reservation_id) WHERE reservation_id IS NOT NULL;

-- ---------- reservation_seats: which seats a reservation asked for (history) ----------
CREATE TABLE reservation_seats (
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  show_seat_id   uuid NOT NULL REFERENCES show_seats(id),
  PRIMARY KEY (reservation_id, show_seat_id)
);

-- ---------- booking_seats: the actual tickets ----------
CREATE TABLE booking_seats (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid        NOT NULL REFERENCES bookings(id),
  show_seat_id  uuid        NOT NULL REFERENCES show_seats(id),
  price_paise   int         NOT NULL CHECK (price_paise >= 0),
  ticket_code   uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,  -- goes into the QR later
  checked_in_at timestamptz,
  released_at   timestamptz,  -- set on cancel/refund so the seat can be sold again
  UNIQUE (booking_id, show_seat_id)
);
-- FINAL SAFETY NET: a seat can have at most ONE live ticket, even if every other layer fails.
CREATE UNIQUE INDEX uq_one_live_ticket_per_seat
  ON booking_seats(show_seat_id) WHERE released_at IS NULL;

-- ---------- updated_at triggers (function set_updated_at() exists from migration 001) ----------
CREATE TRIGGER trg_reservations_updated BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_bookings_updated     BEFORE UPDATE ON bookings     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_show_seats_updated   BEFORE UPDATE ON show_seats   FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TRIGGER IF EXISTS trg_show_seats_updated   ON show_seats;
DROP TRIGGER IF EXISTS trg_bookings_updated     ON bookings;
DROP TRIGGER IF EXISTS trg_reservations_updated ON reservations;

-- Reverse dependency order: junction tables first, then show_seats (it references
-- both reservations and bookings), then bookings (references reservations), then reservations.
DROP TABLE IF EXISTS booking_seats;
DROP TABLE IF EXISTS reservation_seats;
DROP TABLE IF EXISTS show_seats;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS reservations;

DROP TYPE IF EXISTS booking_status;
DROP TYPE IF EXISTS reservation_status;
DROP TYPE IF EXISTS show_seat_status;