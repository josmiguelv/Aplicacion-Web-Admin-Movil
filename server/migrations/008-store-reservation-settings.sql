-- Pollos B3: additive per-store scheduling policy. Administrator database ONLY.
-- No reservation may be created by this migration. Feature disabled by default.
BEGIN;
CREATE TABLE IF NOT EXISTS store_reservation_settings(
 tenant_id UUID NOT NULL,
 store_id UUID NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT false,
 min_advance_minutes INTEGER CHECK(min_advance_minutes BETWEEN 0 AND 10080),
 max_advance_days INTEGER CHECK(max_advance_days BETWEEN 1 AND 60),
 first_time TEXT CHECK(first_time IS NULL OR first_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 last_time TEXT CHECK(last_time IS NULL OR last_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 slot_minutes INTEGER CHECK(slot_minutes IN (15,30,60)),
 max_orders_per_slot INTEGER CHECK(max_orders_per_slot BETWEEN 1 AND 500),
 preparation_minutes INTEGER CHECK(preparation_minutes BETWEEN 1 AND 240),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,store_id),
 FOREIGN KEY(store_id,tenant_id) REFERENCES stores(id,tenant_id) ON DELETE CASCADE,
 CONSTRAINT b3_reservation_complete_when_enabled CHECK(
  NOT enabled OR
  min_advance_minutes IS NOT NULL AND max_advance_days IS NOT NULL AND
  first_time IS NOT NULL AND last_time IS NOT NULL AND
  slot_minutes IS NOT NULL AND max_orders_per_slot IS NOT NULL AND preparation_minutes IS NOT NULL
 ),
 CONSTRAINT b3_reservation_window_valid CHECK(first_time IS NULL OR last_time IS NULL OR first_time < last_time),
 CONSTRAINT b3_reservation_advance_valid CHECK(min_advance_minutes IS NULL OR max_advance_days IS NULL OR min_advance_minutes < max_advance_days*1440)
);
COMMIT;
