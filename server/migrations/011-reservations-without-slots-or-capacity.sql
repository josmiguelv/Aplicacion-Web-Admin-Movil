-- Pollos B3 Administrator local DB only. Remove retired reservation capacity and slot interval requirements.
-- Retain legacy nullable columns for backward compatibility; no data is deleted.
BEGIN;
ALTER TABLE store_reservation_settings
 DROP CONSTRAINT IF EXISTS b3_reservation_complete_when_enabled;
ALTER TABLE store_reservation_settings
 ADD CONSTRAINT b3_reservation_complete_when_enabled CHECK(
  NOT enabled OR (
   min_advance_minutes IS NOT NULL AND max_advance_days IS NOT NULL AND
   first_time IS NOT NULL AND last_time IS NOT NULL AND preparation_minutes IS NOT NULL
  )
 );
COMMIT;
