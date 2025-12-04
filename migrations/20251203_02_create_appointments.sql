CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID REFERENCES reservations(id) ON DELETE RESTRICT,
  client_id UUID NOT NULL,
  barber_id UUID,
  unit_id UUID NOT NULL,
  service_id UUID NOT NULL,
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'agendado',
  origin VARCHAR(20) NOT NULL,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT appointments_valid_period CHECK (start_ts < end_ts)
);

CREATE INDEX IF NOT EXISTS idx_appointments_slot ON appointments(unit_id, start_ts);
CREATE INDEX IF NOT EXISTS idx_appointments_reservation ON appointments(reservation_id);
