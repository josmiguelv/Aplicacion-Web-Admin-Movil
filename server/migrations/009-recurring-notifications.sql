-- Campañas periódicas: frecuencia semanal y ventana horaria America/Lima.
-- Solo afecta al administrador comercial. Migración 009 aditiva e idempotente.
BEGIN;
CREATE TABLE IF NOT EXISTS recurring_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  app_id TEXT NOT NULL REFERENCES mobile_apps(app_id),
  created_by UUID NOT NULL REFERENCES admin_users(id),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 120),
  message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),
  image_id UUID NOT NULL REFERENCES product_images(id),
  product_id UUID,
  weekday SMALLINT NOT NULL CHECK(weekday BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  start_date DATE NOT NULL,
  until_date DATE,
  time_zone TEXT NOT NULL DEFAULT 'America/Lima' CHECK(time_zone='America/Lima'),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED','DELETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recurring_notifications_valid_window CHECK(end_time>start_time),
  CONSTRAINT recurring_notifications_valid_dates CHECK(until_date IS NULL OR until_date>=start_date),
  CONSTRAINT recurring_notifications_product_same_tenant_fk
    FOREIGN KEY(product_id,tenant_id) REFERENCES products(id,tenant_id) MATCH SIMPLE
    ON DELETE SET NULL(product_id),
  UNIQUE(id,tenant_id)
);
CREATE INDEX IF NOT EXISTS recurring_notifications_due ON recurring_notifications(weekday,status,start_date)
 WHERE status='ACTIVE';
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS recurrence_id UUID;
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS occurrence_date DATE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='scheduled_notifications'::regclass AND conname='scheduled_notifications_recurrence_fk') THEN
  ALTER TABLE scheduled_notifications ADD CONSTRAINT scheduled_notifications_recurrence_fk
   FOREIGN KEY(recurrence_id,tenant_id) REFERENCES recurring_notifications(id,tenant_id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='scheduled_notifications'::regclass AND conname='scheduled_notifications_recurrence_pair_check') THEN
  ALTER TABLE scheduled_notifications ADD CONSTRAINT scheduled_notifications_recurrence_pair_check
   CHECK((recurrence_id IS NULL AND occurrence_date IS NULL) OR (recurrence_id IS NOT NULL AND occurrence_date IS NOT NULL));
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_once_per_series_day
 ON scheduled_notifications(recurrence_id,occurrence_date)
 WHERE recurrence_id IS NOT NULL;
COMMIT;
