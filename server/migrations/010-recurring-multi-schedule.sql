-- Migración 010: varios días y varias franjas por secuencia (America/Lima).
-- Aditiva: conserva campañas existentes y su historial de notificaciones.
BEGIN;
CREATE TABLE IF NOT EXISTS recurring_notification_slots (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 recurrence_id UUID NOT NULL REFERENCES recurring_notifications(id),
 weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
 start_time TIME NOT NULL,
 end_time TIME NOT NULL,
 active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT recurring_notification_slots_window CHECK (end_time > start_time),
 CONSTRAINT recurring_notification_slots_unique UNIQUE(recurrence_id,weekday,start_time,end_time)
);
CREATE INDEX IF NOT EXISTS idx_recurring_slots_active
 ON recurring_notification_slots(recurrence_id,weekday) WHERE active=true;
-- Cada campaña antigua conserva su configuración como su primera franja.
INSERT INTO recurring_notification_slots(recurrence_id,weekday,start_time,end_time)
SELECT r.id,r.weekday,r.start_time,r.end_time FROM recurring_notifications r
ON CONFLICT (recurrence_id,weekday,start_time,end_time) DO NOTHING;
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS recurrence_slot_id UUID;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='scheduled_notifications'::regclass AND conname='scheduled_notifications_slot_fk') THEN
  ALTER TABLE scheduled_notifications ADD CONSTRAINT scheduled_notifications_slot_fk
   FOREIGN KEY (recurrence_slot_id) REFERENCES recurring_notification_slots(id);
 END IF;
END $$;
-- El historial anterior usa la identidad de su primera regla (incluso si fue editada).
UPDATE scheduled_notifications n SET recurrence_slot_id=s.id
 FROM recurring_notification_slots s
 WHERE n.recurrence_id=s.recurrence_id AND n.recurrence_slot_id IS NULL;
-- Cambiamos la unicidad por campaña/día a regla/día para permitir dos ventanas
-- distintas el mismo jueves sin duplicar ninguno de los dos mensajes.
DROP INDEX IF EXISTS idx_notifications_once_per_series_day;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_once_per_slot_day
 ON scheduled_notifications(recurrence_slot_id,occurrence_date)
 WHERE recurrence_slot_id IS NOT NULL;
COMMIT;
