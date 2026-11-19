-- INTEGRA B2G: programación de notificaciones consultables por API.
-- Migración aditiva e idempotente; sin acceso a TU VERSO ni Android.
BEGIN;
CREATE TABLE IF NOT EXISTS scheduled_notifications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 app_id TEXT NOT NULL REFERENCES mobile_apps(app_id),
 title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
 message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
 image_id UUID NOT NULL REFERENCES product_images(id),
 send_at TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ,
 enabled BOOLEAN NOT NULL DEFAULT true,
 cancelled_at TIMESTAMPTZ,
 created_by UUID NOT NULL REFERENCES admin_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT notification_expiry_after_send CHECK (expires_at IS NULL OR expires_at > send_at)
);
CREATE INDEX IF NOT EXISTS scheduled_notifications_tenant_send ON scheduled_notifications (tenant_id,send_at DESC);
CREATE INDEX IF NOT EXISTS scheduled_notifications_app_due ON scheduled_notifications (app_id,send_at DESC)
 WHERE enabled=true AND cancelled_at IS NULL;
COMMIT;
