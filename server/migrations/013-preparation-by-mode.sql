-- Pollos B3 Administrator Web: preparation times per fulfillment mode and simplified reservations.
-- Apply ONLY to the local Admin PostgreSQL. No backups, data deletion or TU VERSO changes.
BEGIN;
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS delivery_preparation_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS pickup_preparation_minutes INTEGER;
ALTER TABLE stores
  DROP CONSTRAINT IF EXISTS stores_delivery_preparation_minutes_check,
  DROP CONSTRAINT IF EXISTS stores_pickup_preparation_minutes_check;
ALTER TABLE stores
  ADD CONSTRAINT stores_delivery_preparation_minutes_check
    CHECK (delivery_preparation_minutes IS NULL OR delivery_preparation_minutes BETWEEN 1 AND 240),
  ADD CONSTRAINT stores_pickup_preparation_minutes_check
    CHECK (pickup_preparation_minutes IS NULL OR pickup_preparation_minutes BETWEEN 1 AND 240);

-- Prior reservation schedule fields remain physically present for compatibility
-- but no longer gate the enabled state; only preparation time is mandatory.
ALTER TABLE store_reservation_settings
  DROP CONSTRAINT IF EXISTS b3_reservation_complete_when_enabled;
ALTER TABLE store_reservation_settings
  ADD CONSTRAINT b3_reservation_complete_when_enabled
    CHECK (NOT enabled OR preparation_minutes IS NOT NULL);
COMMIT;
