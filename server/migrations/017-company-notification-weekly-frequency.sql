-- Company-wide recurring commercial notifications, local Peru calendar.
-- Keep previous notices and their original one-shot behavior.
BEGIN;
ALTER TABLE company_mobile_notifications
 ADD COLUMN IF NOT EXISTS weekdays INTEGER[],
 ADD COLUMN IF NOT EXISTS run_time TIME WITHOUT TIME ZONE;
ALTER TABLE company_mobile_notifications
 DROP CONSTRAINT IF EXISTS company_mobile_notifications_weekly_schedule_check;
ALTER TABLE company_mobile_notifications ADD CONSTRAINT company_mobile_notifications_weekly_schedule_check CHECK(
  (weekdays IS NULL AND run_time IS NULL)
  OR (weekdays IS NOT NULL AND run_time IS NOT NULL
      AND cardinality(weekdays) BETWEEN 1 AND 7
      AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::INTEGER[]
      AND array_position(weekdays,NULL) IS NULL)
);
CREATE TABLE IF NOT EXISTS company_mobile_notification_runs (
 notification_id UUID NOT NULL REFERENCES company_mobile_notifications(id) ON DELETE CASCADE,
 run_date DATE NOT NULL,
 claim_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 sent_at TIMESTAMPTZ,
 error TEXT,
 PRIMARY KEY(notification_id,run_date)
);
CREATE INDEX IF NOT EXISTS idx_company_mobile_notification_runs_pending
 ON company_mobile_notification_runs(claim_at) WHERE sent_at IS NULL;
COMMIT;
