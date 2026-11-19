-- FCM: extensión aditiva y segura de notificaciones existentes.
-- Los avisos creados antes de la migración se marcan SKIPPED: no se
-- envían retrospectivamente al activar FCM por primera vez.
BEGIN;
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS push_status TEXT;
UPDATE scheduled_notifications SET push_status='SKIPPED' WHERE push_status IS NULL;
ALTER TABLE scheduled_notifications ALTER COLUMN push_status SET DEFAULT 'PENDING';
ALTER TABLE scheduled_notifications ALTER COLUMN push_status SET NOT NULL;
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS push_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS push_last_error TEXT;
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS push_sent_at TIMESTAMPTZ;
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS push_locked_at TIMESTAMPTZ;
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS push_next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS fcm_message_id TEXT;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='scheduled_notifications'::regclass AND conname='scheduled_notifications_push_status_check') THEN
  ALTER TABLE scheduled_notifications ADD CONSTRAINT scheduled_notifications_push_status_check
    CHECK(push_status IN ('PENDING','SENDING','SENT','RETRY','FAILED','UNKNOWN','SKIPPED'));
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_notifications_push_due
 ON scheduled_notifications(app_id,push_next_attempt_at,send_at)
 WHERE push_status IN ('PENDING','RETRY') AND enabled=true AND cancelled_at IS NULL;
COMMIT;
