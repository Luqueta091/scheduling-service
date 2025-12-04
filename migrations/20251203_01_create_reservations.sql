CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_token VARCHAR(255) UNIQUE NOT NULL,
  unit_id UUID NOT NULL,
  service_id UUID NOT NULL,
  barber_id UUID,
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'locked',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT reservations_valid_period CHECK (start_ts < end_ts)
);

CREATE INDEX IF NOT EXISTS idx_reservations_slot ON reservations(unit_id, start_ts);
CREATE INDEX IF NOT EXISTS idx_reservations_token ON reservations(reservation_token);
