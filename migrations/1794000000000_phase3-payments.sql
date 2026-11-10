-- Up Migration

-- =====================================================================
-- FlashSeat — Migration 003: Phase 3 payments (Razorpay, test mode first)
-- Tables: payments, refunds, webhook_events
--
-- No change to booking_status: the existing values cover every new state.
--   * payment captured but the hold was lost / show no longer bookable
--     -> booking REFUND_PENDING (refunds.reason = 'HOLD_EXPIRED' or 'EVENT_CANCELLED')
--   * refund paid out -> booking REFUNDED
-- Mock-paid bookings (POST /bookings/:id/confirm-mock) have no payments row.
--
-- Lock order (docs/lock-order.md): payments and refunds rows sit between
-- bookings (level 5) and show_seats (level 6).
-- =====================================================================

CREATE TYPE payment_status AS ENUM ('CREATED', 'CAPTURED', 'FAILED');
CREATE TYPE refund_status  AS ENUM ('PENDING', 'PROCESSED', 'FAILED');
CREATE TYPE refund_reason  AS ENUM ('EVENT_CANCELLED', 'HOLD_EXPIRED');

-- ---------- payments: one row per provider order ----------
CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          uuid           NOT NULL REFERENCES bookings(id),
  provider            text           NOT NULL CHECK (provider IN ('razorpay')),
  provider_order_id   text           NOT NULL UNIQUE,
  provider_payment_id text           UNIQUE,            -- set when a payment attempt is known
  amount_paise        bigint         NOT NULL CHECK (amount_paise >= 0),
  currency            text           NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  status              payment_status NOT NULL DEFAULT 'CREATED',
  failure_reason      text,
  created_at          timestamptz    NOT NULL DEFAULT now(),
  updated_at          timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT chk_payment_captured_has_id CHECK (status <> 'CAPTURED' OR provider_payment_id IS NOT NULL)
);
-- At most one open (CREATED) order per booking: concurrent "create order" calls converge.
CREATE UNIQUE INDEX uq_one_created_payment_per_booking ON payments(booking_id) WHERE status = 'CREATED';
-- At most one CAPTURED payment per booking: money is taken once.
CREATE UNIQUE INDEX uq_one_captured_payment_per_booking ON payments(booking_id) WHERE status = 'CAPTURED';
CREATE INDEX idx_payments_booking ON payments(booking_id);

-- ---------- refunds: at most one per payment ----------
CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid          NOT NULL UNIQUE REFERENCES payments(id),  -- never refund a payment twice
  booking_id         uuid          NOT NULL REFERENCES bookings(id),
  provider_refund_id text          UNIQUE,
  amount_paise       bigint        NOT NULL CHECK (amount_paise >= 0),
  status             refund_status NOT NULL DEFAULT 'PENDING',
  reason             refund_reason NOT NULL,
  attempts           int           NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error         text,
  next_attempt_at    timestamptz   NOT NULL DEFAULT now(),   -- worker backoff / claim lease
  processed_at       timestamptz,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT chk_refund_processed_has_id CHECK (status <> 'PROCESSED' OR provider_refund_id IS NOT NULL)
);
CREATE INDEX idx_refunds_due ON refunds(next_attempt_at) WHERE status = 'PENDING';
CREATE INDEX idx_refunds_booking ON refunds(booking_id);

-- ---------- webhook_events: dedupe + retry queue for provider webhooks ----------
CREATE TABLE webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text        NOT NULL,
  event_id        text        NOT NULL,          -- x-razorpay-event-id
  event_type      text        NOT NULL,
  payload         jsonb       NOT NULL,          -- kept so the worker can retry processing
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  attempts        int         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);
CREATE INDEX idx_webhook_events_pending ON webhook_events(next_attempt_at) WHERE processed_at IS NULL;

CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_refunds_updated  BEFORE UPDATE ON refunds  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TRIGGER IF EXISTS trg_refunds_updated  ON refunds;
DROP TRIGGER IF EXISTS trg_payments_updated ON payments;
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS payments;
DROP TYPE IF EXISTS refund_reason;
DROP TYPE IF EXISTS refund_status;
DROP TYPE IF EXISTS payment_status;
