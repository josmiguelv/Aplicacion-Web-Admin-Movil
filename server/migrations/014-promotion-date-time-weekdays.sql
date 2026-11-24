-- Pollos B3 Administrator Web only. Promotion date, time and weekday schedule.
-- Existing promotions are preserved; legacy UTC timestamp bounds remain for compatibility.
BEGIN;
ALTER TABLE promotions
 ADD COLUMN IF NOT EXISTS starts_on DATE,
 ADD COLUMN IF NOT EXISTS ends_on DATE,
 ADD COLUMN IF NOT EXISTS active_from TIME WITHOUT TIME ZONE,
 ADD COLUMN IF NOT EXISTS active_until TIME WITHOUT TIME ZONE,
 ADD COLUMN IF NOT EXISTS active_weekdays INTEGER[];
ALTER TABLE promotions
 DROP CONSTRAINT IF EXISTS promotions_schedule_valid;
ALTER TABLE promotions
 ADD CONSTRAINT promotions_schedule_valid CHECK (
  (starts_on IS NULL AND ends_on IS NULL AND active_from IS NULL AND active_until IS NULL AND active_weekdays IS NULL)
  OR
  (starts_on IS NOT NULL AND ends_on IS NOT NULL AND starts_on<=ends_on
   AND active_from IS NOT NULL AND active_until IS NOT NULL AND active_from<active_until
   AND active_weekdays IS NOT NULL AND cardinality(active_weekdays) BETWEEN 1 AND 7
   AND active_weekdays <@ ARRAY[1,2,3,4,5,6,7]::INTEGER[]
   AND array_position(active_weekdays,NULL) IS NULL)
 );
COMMIT;
