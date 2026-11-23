-- Pollos B3: plazos de pago por empresa y notificaciones privadas por interacción.
-- Ejecutar en la base independiente del Administrador, nunca en TU VERSO.
BEGIN;
CREATE TABLE IF NOT EXISTS mobile_checkout_policies(
 tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 payment_wait_minutes INT NOT NULL DEFAULT 10 CHECK(payment_wait_minutes BETWEEN 5 AND 30),
 reminder_count INT NOT NULL DEFAULT 2 CHECK(reminder_count BETWEEN 0 AND 2),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mobile_checkout_followups(
 interaction_id UUID PRIMARY KEY,
 tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 app_id TEXT NOT NULL,
 store_id UUID NOT NULL,
 access_hash TEXT NOT NULL CHECK(access_hash ~ '^[a-f0-9]{64}$'),
 fcm_token TEXT CHECK(fcm_token IS NULL OR length(fcm_token) BETWEEN 50 AND 4096),
 state TEXT NOT NULL DEFAULT 'WAITING' CHECK(state IN ('WAITING','PAYMENT_PENDING','CANCELLED','EXPIRED','FINISHED')),
 checkout_started_at TIMESTAMPTZ,
 checkout_expires_at TIMESTAMPTZ,
 reminder_sent_count INT NOT NULL DEFAULT 0 CHECK(reminder_sent_count BETWEEN 0 AND 2),
 agent_notice_sent BOOLEAN NOT NULL DEFAULT false,
 agent_checked_at TIMESTAMPTZ,
 expiry_notice_sent BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mobile_checkout_followups_due
 ON mobile_checkout_followups(state,checkout_expires_at) WHERE state='PAYMENT_PENDING';
CREATE INDEX IF NOT EXISTS mobile_checkout_followups_agent_due
 ON mobile_checkout_followups(state,agent_checked_at) WHERE state='WAITING';
COMMIT;
