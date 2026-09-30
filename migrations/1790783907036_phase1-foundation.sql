-- Up Migration

-- =====================================================================
-- FlashSeat — Migration 001: Phase 1 Foundation (PostgreSQL 14+)
-- Tables: users, refresh_tokens, organizer_profiles, venues, venue_seats,
--         events, shows, show_category_prices
-- Money is stored in paise (integer). All timestamps are timestamptz.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive emails
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- for the venue-overlap exclusion constraint

-- ---------- Enums ----------
CREATE TYPE user_role        AS ENUM ('ATTENDEE', 'ORGANIZER', 'ADMIN');
CREATE TYPE organizer_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE event_status     AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');
CREATE TYPE show_status      AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED');

-- ---------- updated_at helper ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- Auth ----------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL CHECK (length(trim(name)) > 0),
  email         citext      NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  role          user_role   NOT NULL DEFAULT 'ATTENDEE',
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Refresh-token rotation: we store only a HASH of the token, never the token itself.
CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- Extra info for organizers (college society / club).
-- Default APPROVED for now; change to PENDING when the admin approval flow is added.
CREATE TABLE organizer_profiles (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  organization_name text             NOT NULL,
  status            organizer_status NOT NULL DEFAULT 'APPROVED',
  created_at        timestamptz      NOT NULL DEFAULT now()
);

-- ---------- Venues ----------
-- Capacity is NOT stored: it is COUNT(venue_seats). No denormalised copy to go stale.
CREATE TABLE venues (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid        NOT NULL REFERENCES users(id),
  name       text        NOT NULL,
  address    text        NOT NULL,
  city       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_venues_owner ON venues(owner_id);

-- Physical seat layout, reusable across shows.
-- General admission trick: one section 'GA', row 'G', seat numbers 1..N.
CREATE TABLE venue_seats (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  section     text NOT NULL DEFAULT 'MAIN',
  row_label   text NOT NULL,
  seat_number int  NOT NULL CHECK (seat_number > 0),
  category    text NOT NULL DEFAULT 'REGULAR',   -- REGULAR / VIP / ...
  UNIQUE (venue_id, section, row_label, seat_number)
);
CREATE INDEX idx_venue_seats_category ON venue_seats(venue_id, category);

-- ---------- Events & Shows ----------
CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid         NOT NULL REFERENCES users(id),
  title        text         NOT NULL,
  description  text         NOT NULL DEFAULT '',
  category     text         NOT NULL,
  poster_url   text,
  status       event_status NOT NULL DEFAULT 'DRAFT',
  cancelled_at timestamptz,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_organizer ON events(organizer_id);
CREATE INDEX idx_events_published_category ON events(category) WHERE status = 'PUBLISHED';

-- One event -> many shows. The venue belongs to the show, not the event.
CREATE TABLE shows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  venue_id      uuid        NOT NULL REFERENCES venues(id),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  sales_open_at timestamptz,
  status        show_status NOT NULL DEFAULT 'SCHEDULED',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- Two live shows can never overlap in the same venue (enforced by the DB).
  CONSTRAINT no_venue_overlap EXCLUDE USING gist (
    venue_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'CANCELLED')
);
CREATE INDEX idx_shows_event ON shows(event_id);
CREATE INDEX idx_shows_starts_at ON shows(starts_at);

-- Price per seat category for a show. In Phase 2 these prices get copied
-- (snapshotted) into show_seats.price_paise when seats are generated.
CREATE TABLE show_category_prices (
  show_id     uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  category    text NOT NULL,
  price_paise int  NOT NULL CHECK (price_paise >= 0),
  PRIMARY KEY (show_id, category)
);

-- ---------- updated_at triggers ----------
CREATE TRIGGER trg_users_updated  BEFORE UPDATE ON users  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_events_updated BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_shows_updated  BEFORE UPDATE ON shows  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Down Migration

-- ---------- Triggers (drop before dropping their tables, though CASCADE
-- from DROP TABLE would remove them anyway — explicit is clearer) ----------
DROP TRIGGER IF EXISTS trg_shows_updated  ON shows;
DROP TRIGGER IF EXISTS trg_events_updated ON events;
DROP TRIGGER IF EXISTS trg_users_updated  ON users;

-- ---------- Tables (drop in REVERSE dependency order — a table that
-- references another must be dropped first) ----------
DROP TABLE IF EXISTS show_category_prices;
DROP TABLE IF EXISTS shows;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS venue_seats;
DROP TABLE IF EXISTS venues;
DROP TABLE IF EXISTS organizer_profiles;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;

-- ---------- Function ----------
DROP FUNCTION IF EXISTS set_updated_at();

-- ---------- Enums ----------
DROP TYPE IF EXISTS show_status;
DROP TYPE IF EXISTS event_status;
DROP TYPE IF EXISTS organizer_status;
DROP TYPE IF EXISTS user_role;

-- ---------- Extensions ----------
-- Usually left alone since other databases/migrations might depend on them,
-- but included here for a fully clean teardown in a throwaway dev DB.
DROP EXTENSION IF EXISTS btree_gist;
DROP EXTENSION IF EXISTS citext;