CREATE TABLE IF NOT EXISTS availability_slot_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL,
  service_id UUID NOT NULL,
  barber_id UUID,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_duration_minutes INTEGER NOT NULL CHECK (slot_duration_minutes > 0),
  buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
  capacity_per_slot INTEGER NOT NULL DEFAULT 1 CHECK (capacity_per_slot > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT availability_slot_templates_valid_period CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_slot_templates_lookup
  ON availability_slot_templates(unit_id, service_id, weekday);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_active_slot
  ON reservations(
    unit_id,
    service_id,
    start_ts,
    COALESCE(barber_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status IN ('locked', 'confirmed');
