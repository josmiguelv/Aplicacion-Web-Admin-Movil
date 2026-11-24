-- INTEGRA B2G multi-tenant commercial administration. Deploy only in an empty, isolated PostgreSQL database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 180),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','TENANT_ADMIN')),
  tenant_id UUID REFERENCES tenants(id),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((role='SUPER_ADMIN' AND tenant_id IS NULL) OR (role='TENANT_ADMIN' AND tenant_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mobile_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  app_id TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  published_revision INT NOT NULL DEFAULT 0,
  complaints_book_url TEXT
);
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  radius_km DOUBLE PRECISION CHECK(radius_km IS NULL OR (radius_km > 0 AND radius_km <= 500)),
  delivery_rate_per_km_pen NUMERIC(10,2) CHECK(delivery_rate_per_km_pen >= 0),
  delivery_pricing_mode TEXT NOT NULL DEFAULT 'PER_KM' CHECK(delivery_pricing_mode IN ('PER_KM','FIXED')),
  delivery_fee_pen NUMERIC(10,2) CHECK(delivery_fee_pen >= 0),
  active BOOLEAN NOT NULL DEFAULT false,
  delivery_enabled BOOLEAN NOT NULL DEFAULT false,
  pickup_enabled BOOLEAN NOT NULL DEFAULT false,
  dine_in_enabled BOOLEAN NOT NULL DEFAULT false,
  opening_hours JSONB,
  service_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_preparation_minutes INTEGER CHECK(delivery_preparation_minutes BETWEEN 1 AND 240),
  pickup_preparation_minutes INTEGER CHECK(pickup_preparation_minutes BETWEEN 1 AND 240),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id,tenant_id)
);
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  price_pen NUMERIC(10,2) NOT NULL CHECK(price_pen >= 0),
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  starts_on DATE,
  ends_on DATE,
  active_from TIME WITHOUT TIME ZONE,
  active_until TIME WITHOUT TIME ZONE,
  active_weekdays INTEGER[],
  active BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT promotions_schedule_valid CHECK(
    (starts_on IS NULL AND ends_on IS NULL AND active_from IS NULL AND active_until IS NULL AND active_weekdays IS NULL)
    OR (starts_on IS NOT NULL AND ends_on IS NOT NULL AND starts_on<=ends_on
        AND active_from IS NOT NULL AND active_until IS NOT NULL AND active_from<active_until
        AND active_weekdays IS NOT NULL AND cardinality(active_weekdays) BETWEEN 1 AND 7
        AND active_weekdays <@ ARRAY[1,2,3,4,5,6,7]::INTEGER[]
        AND array_position(active_weekdays,NULL) IS NULL)
  ),
  UNIQUE(id,tenant_id)
);
-- Fields used by date/time/day promotion schedules; update existing local DB via migration 014.
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS starts_on DATE;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS ends_on DATE;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS active_from TIME WITHOUT TIME ZONE;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS active_until TIME WITHOUT TIME ZONE;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS active_weekdays INTEGER[];

-- Commercial notices are company-scoped and separate from checkout reminders.
CREATE TABLE IF NOT EXISTS company_mobile_notifications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 1000),
 image_url TEXT,
 scheduled_at TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 weekdays INTEGER[],
 run_time TIME WITHOUT TIME ZONE,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','DISABLED')),
 published_at TIMESTAMPTZ,
 push_sent_at TIMESTAMPTZ,
 push_claimed_at TIMESTAMPTZ,
 push_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT company_mobile_notifications_dates CHECK(expires_at>scheduled_at),
 CONSTRAINT company_mobile_notifications_weekly_schedule_check CHECK(
  (weekdays IS NULL AND run_time IS NULL)
  OR (weekdays IS NOT NULL AND run_time IS NOT NULL
   AND cardinality(weekdays) BETWEEN 1 AND 7
   AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::INTEGER[]
   AND array_position(weekdays,NULL) IS NULL)
 )
);
CREATE INDEX IF NOT EXISTS idx_company_mobile_notifications_tenant
 ON company_mobile_notifications(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_mobile_notifications_push
 ON company_mobile_notifications(status,scheduled_at) WHERE push_sent_at IS NULL;

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

CREATE TABLE IF NOT EXISTS payment_methods (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  store_id UUID NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('delivery','pickup','dine_in','reservation')),
  method TEXT NOT NULL CHECK(method IN ('yape','plin','card','cash')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  image_url TEXT,
  CONSTRAINT payment_methods_image_guard CHECK (method='cash' AND image_url IS NULL OR method<>'cash' AND (image_url IS NULL OR image_url ~ '^/api/v1/mobile/images/[0-9a-f-]{36}
  PRIMARY KEY (tenant_id,store_id,mode,method),
  FOREIGN KEY(store_id,tenant_id) REFERENCES stores(id,tenant_id) ON DELETE CASCADE
);
)),
  PRIMARY KEY (tenant_id,store_id,mode,method),
  FOREIGN KEY(store_id,tenant_id) REFERENCES stores(id,tenant_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS published_catalogs (
  app_id TEXT PRIMARY KEY REFERENCES mobile_apps(app_id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  revision INT NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_audit (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  actor_user_id UUID REFERENCES admin_users(id),
  action TEXT NOT NULL,
  target_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stores_tenant ON stores(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON admin_sessions(token_hash);
CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_images_tenant ON product_images(tenant_id);
-- Additive migration for existing admin databases; null means NOT CONFIGURED.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS opening_hours JSONB;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS delivery_preparation_minutes INTEGER CHECK(delivery_preparation_minutes BETWEEN 1 AND 240);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS pickup_preparation_minutes INTEGER CHECK(pickup_preparation_minutes BETWEEN 1 AND 240);

-- Safe additive upgrade of already provisioned databases; run as a reviewed migration before deployment.
-- Historical radius 0 signified unconfigured coverage: convert it to NULL (unlimited).
-- Legacy fixed delivery fees are retained but never used for per-kilometre quotations.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS delivery_rate_per_km_pen NUMERIC(10,2);
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_radius_km_check;
ALTER TABLE stores ALTER COLUMN radius_km DROP NOT NULL;
ALTER TABLE stores ALTER COLUMN radius_km DROP DEFAULT;
UPDATE stores SET radius_km=NULL WHERE radius_km=0;
ALTER TABLE stores ADD CONSTRAINT stores_radius_km_check CHECK (radius_km IS NULL OR (radius_km>0 AND radius_km<=500));
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_delivery_rate_per_km_pen_check;
ALTER TABLE stores ADD CONSTRAINT stores_delivery_rate_per_km_pen_check CHECK (delivery_rate_per_km_pen IS NULL OR delivery_rate_per_km_pen>=0);

-- Explicit pricing mode; historical fixed amount remains in delivery_fee_pen.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS delivery_pricing_mode TEXT NOT NULL DEFAULT 'PER_KM';
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_delivery_pricing_mode_check;
ALTER TABLE stores ADD CONSTRAINT stores_delivery_pricing_mode_check CHECK (delivery_pricing_mode IN ('PER_KM','FIXED'));


-- Vacantes: creadas solo por un administrador autenticado, ocultas hasta publicar.
CREATE TABLE IF NOT EXISTS job_vacancies (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 150),
 summary TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '',
 requirements TEXT NOT NULL DEFAULT '',
 schedule TEXT NOT NULL DEFAULT '',
 employment_type TEXT NOT NULL DEFAULT '',
 location_label TEXT NOT NULL DEFAULT '',
 image_url TEXT,
 whatsapp_phone TEXT NOT NULL CHECK(whatsapp_phone ~ '^51[0-9]{9}$'),
 active BOOLEAN NOT NULL DEFAULT false,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_job_vacancies_tenant ON job_vacancies(tenant_id);
-- A vacancy may target one or many stores in the same company.
CREATE TABLE IF NOT EXISTS job_vacancy_stores (
 tenant_id UUID NOT NULL,
 vacancy_id UUID NOT NULL,
 store_id UUID NOT NULL,
 PRIMARY KEY (tenant_id,vacancy_id,store_id),
 FOREIGN KEY(vacancy_id,tenant_id) REFERENCES job_vacancies(id,tenant_id) ON DELETE CASCADE,
 FOREIGN KEY(store_id,tenant_id) REFERENCES stores(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_job_vacancy_stores_store
 ON job_vacancy_stores(tenant_id,store_id);

-- Official complaints-book URL is configured by the tenant, never guessed by the app.
ALTER TABLE mobile_apps ADD COLUMN IF NOT EXISTS complaints_book_url TEXT;

-- Additive migration: preserves UUIDs, relationships and existing stores.
BEGIN;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS code TEXT;
UPDATE stores SET code='sede-'||id::text WHERE code IS NULL;
ALTER TABLE stores ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stores_tenant_code_unique ON stores(tenant_id,code);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='stores'::regclass AND conname='stores_code_format') THEN
  ALTER TABLE stores ADD CONSTRAINT stores_code_format CHECK(length(code) BETWEEN 2 AND 80 AND code ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
 END IF;
END $$;
CREATE OR REPLACE FUNCTION preserve_store_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.code IS DISTINCT FROM OLD.code THEN
  RAISE EXCEPTION 'El ID de la sede no se puede modificar' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER stores_preserve_code BEFORE UPDATE ON stores
 FOR EACH ROW EXECUTE FUNCTION preserve_store_code();
COMMIT;

-- Local/approved database only. No credentials or external requests in migrations.
BEGIN;
CREATE TABLE IF NOT EXISTS tenant_integrations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 provider TEXT NOT NULL DEFAULT 'TUVERSO' CHECK(provider='TUVERSO'),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 180),
 external_tenant_id TEXT NOT NULL CHECK(length(external_tenant_id) BETWEEN 1 AND 180),
 channel_account_id UUID NOT NULL,
 channel_type TEXT NOT NULL CHECK(channel_type IN ('MOBILE_APP','WEB')),
 instance_key TEXT NOT NULL CHECK(length(instance_key) BETWEEN 1 AND 180),
 base_url TEXT NOT NULL DEFAULT 'https://api.tuverso.integra-b2g.com'
  CHECK(base_url='https://api.tuverso.integra-b2g.com'),
 scopes TEXT[] NOT NULL DEFAULT ARRAY['queue.availability.read']::text[]
  CHECK('queue.availability.read'=ANY(scopes))
  CHECK(scopes <@ ARRAY['queue.availability.read','interactions.create','interactions.read','interactions.events.read','conversations.read','conversations.messages.write']::text[]),
 encrypted_credential TEXT,
 credential_hint TEXT,
 credential_reference TEXT CHECK(credential_reference IS NULL OR length(credential_reference)<=180),
 expires_at TIMESTAMPTZ,
 suspended BOOLEAN NOT NULL DEFAULT false,
 check_state TEXT NOT NULL DEFAULT 'UNCONFIGURED' CHECK(check_state IN ('UNCONFIGURED','CONFIGURED','QUERY_CONNECTED','AUTH_ERROR')),
 last_check JSONB,
 revision INT NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id),
 UNIQUE(provider,external_tenant_id,channel_account_id,instance_key),
 CHECK((encrypted_credential IS NULL)=(credential_hint IS NULL))
);
CREATE INDEX IF NOT EXISTS tenant_integrations_tenant ON tenant_integrations(tenant_id);
CREATE TABLE IF NOT EXISTS integration_bindings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 integration_id UUID NOT NULL,
 store_id UUID NOT NULL,
 external_location_id TEXT NOT NULL CHECK(length(external_location_id) BETWEEN 1 AND 180),
 purpose TEXT NOT NULL CHECK(length(purpose)<=80 AND purpose ~ '^[A-Z][A-Z0-9_]*$'),
 queue_reference UUID NOT NULL,
 authorization_confirmed_by UUID NOT NULL REFERENCES admin_users(id),
 authorization_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(integration_id,tenant_id) REFERENCES tenant_integrations(id,tenant_id) ON DELETE CASCADE,
 FOREIGN KEY(store_id,tenant_id) REFERENCES stores(id,tenant_id),
 UNIQUE(integration_id,external_location_id,purpose)
);
CREATE INDEX IF NOT EXISTS integration_bindings_tenant ON integration_bindings(tenant_id,integration_id);
COMMIT;

-- Remote identity and queue metadata are not inputs to the 1A availability call.
-- Keep every existing value; allow new connections without inventing identifiers.
BEGIN;
ALTER TABLE tenant_integrations ALTER COLUMN external_tenant_id DROP NOT NULL;
ALTER TABLE tenant_integrations ALTER COLUMN channel_account_id DROP NOT NULL;
ALTER TABLE tenant_integrations ALTER COLUMN channel_type DROP NOT NULL;
ALTER TABLE tenant_integrations ALTER COLUMN instance_key DROP NOT NULL;
ALTER TABLE integration_bindings ALTER COLUMN queue_reference DROP NOT NULL;
COMMIT;

-- INTEGRA B2G: API Keys S2S del backend administrativo.
-- Migración aditiva: NO modifica TU VERSO ni credenciales tvi_v1_.
BEGIN;

CREATE TABLE IF NOT EXISTS tenant_api_keys (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 120),
 key_hash TEXT NOT NULL UNIQUE CHECK (key_hash ~ '^[a-f0-9]{64}$'),
 key_prefix TEXT NOT NULL CHECK (length(key_prefix) BETWEEN 12 AND 25),
 scopes TEXT[] NOT NULL DEFAULT ARRAY['catalog.read']::TEXT[]
  CHECK (scopes=ARRAY['catalog.read']::TEXT[]),
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ,
 last_used_at TIMESTAMPTZ,
 created_by UUID NOT NULL REFERENCES admin_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_api_keys_tenant_created
 ON tenant_api_keys(tenant_id,created_at DESC);

COMMIT;

-- Tenant-scoped mobile order availability; same additive DDL as migration 006.
-- Additive, tenant-scoped order availability. Do not run automatically at API startup.
BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'America/Lima';

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS consult_order_availability BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mobile_apps_app_tenant_unique' AND conrelid='mobile_apps'::regclass) THEN
    ALTER TABLE mobile_apps ADD CONSTRAINT mobile_apps_app_tenant_unique UNIQUE (app_id,tenant_id);
  END IF;
END $$;

ALTER TABLE integration_bindings
  ADD COLUMN IF NOT EXISTS app_id TEXT;

-- Existing binding is safely assigned only when its tenant has exactly one app.
-- Multi-app tenants must choose the intended app explicitly in the administrator.
UPDATE integration_bindings b
SET app_id = a.app_id
FROM mobile_apps a
WHERE a.tenant_id=b.tenant_id
  AND b.app_id IS NULL
  AND (SELECT count(*) FROM mobile_apps x WHERE x.tenant_id=b.tenant_id)=1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='integration_bindings_id_tenant_unique' AND conrelid='integration_bindings'::regclass) THEN
    ALTER TABLE integration_bindings ADD CONSTRAINT integration_bindings_id_tenant_unique UNIQUE (id,tenant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='integration_bindings_app_tenant_fk' AND conrelid='integration_bindings'::regclass) THEN
    ALTER TABLE integration_bindings
      ADD CONSTRAINT integration_bindings_app_tenant_fk
      FOREIGN KEY(app_id,tenant_id) REFERENCES mobile_apps(app_id,tenant_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS integration_bindings_app_store
  ON integration_bindings(tenant_id,app_id,store_id,purpose) WHERE app_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS mobile_order_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  idempotency_key UUID NOT NULL,
  validation_token_hash TEXT NOT NULL CHECK(validation_token_hash ~ '^[a-f0-9]{64}$'),
  request_hash TEXT NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  customer_external_id TEXT NOT NULL CHECK(length(customer_external_id) BETWEEN 1 AND 180),
  request_summary TEXT NOT NULL CHECK(length(request_summary) BETWEEN 1 AND 1200),
  subtotal NUMERIC(12,2) NOT NULL CHECK(subtotal>=0),
  currency CHAR(3) NOT NULL,
  catalog_revision INTEGER NOT NULL CHECK(catalog_revision>=0),
  candidates JSONB NOT NULL CHECK(jsonb_typeof(candidates)='array'),
  candidate_index INTEGER NOT NULL DEFAULT 0 CHECK(candidate_index>=0),
  status TEXT NOT NULL CHECK(status IN ('CHECKING_STORES','WAITING_APPROVAL','CREATE_UNCERTAIN','READY_FOR_PAYMENT','UNAVAILABLE','VALIDATION_ERROR','CANCELLED')),
  selected_store_id UUID,
  lease_until TIMESTAMPTZ,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,app_id,idempotency_key),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(app_id,tenant_id) REFERENCES mobile_apps(app_id,tenant_id) ON DELETE CASCADE,
  FOREIGN KEY(selected_store_id,tenant_id) REFERENCES stores(id,tenant_id)
);

CREATE INDEX IF NOT EXISTS mobile_order_validations_pending
  ON mobile_order_validations(status,lease_until,updated_at)
  WHERE status IN ('CHECKING_STORES','WAITING_APPROVAL','CREATE_UNCERTAIN');

CREATE TABLE IF NOT EXISTS mobile_order_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  validation_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL CHECK(attempt_number>0),
  store_id UUID NOT NULL,
  binding_id UUID,
  integration_id UUID,
  idempotency_key UUID NOT NULL,
  external_reference TEXT NOT NULL CHECK(length(external_reference) BETWEEN 1 AND 180),
  interaction_id UUID,
  status TEXT NOT NULL CHECK(status IN ('CHECKING_AVAILABILITY','NO_CAPACITY','CREATE_UNCERTAIN','PENDING','ACCEPTED','REJECTED','EXPIRED','ERROR')),
  decision_reason TEXT CHECK(decision_reason IS NULL OR length(decision_reason)<=400),
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(validation_id,attempt_number),
  UNIQUE(tenant_id,integration_id,external_reference),
  FOREIGN KEY(validation_id,tenant_id) REFERENCES mobile_order_validations(id,tenant_id) ON DELETE CASCADE,
  FOREIGN KEY(store_id,tenant_id) REFERENCES stores(id,tenant_id),
  FOREIGN KEY(binding_id,tenant_id) REFERENCES integration_bindings(id,tenant_id),
  FOREIGN KEY(integration_id,tenant_id) REFERENCES tenant_integrations(id,tenant_id)
);

CREATE INDEX IF NOT EXISTS mobile_order_attempts_validation
  ON mobile_order_attempts(tenant_id,validation_id,attempt_number);

COMMIT;

-- Pollos B3: plazos de pago por empresa y notificaciones privadas por interacción.
-- Ejecutar en la base independiente del Administrador, nunca en TU VERSO.
BEGIN;
CREATE TABLE IF NOT EXISTS mobile_checkout_policies(
 tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 payment_wait_minutes INT NOT NULL DEFAULT 10 CHECK(payment_wait_minutes BETWEEN 5 AND 30),
 reminder_count INT NOT NULL DEFAULT 2 CHECK(reminder_count BETWEEN 0 AND 2),
 reminders_enabled BOOLEAN NOT NULL DEFAULT false,
 reminder_title TEXT NOT NULL DEFAULT 'Tu compra está pendiente',
 reminder_message TEXT NOT NULL DEFAULT 'Continúa con el pago o cancela tu solicitud de Pollos B3.',
 reminder2_title TEXT NOT NULL DEFAULT '⏰ Tu pedido sigue pendiente',
 reminder2_message TEXT NOT NULL DEFAULT 'Aún tienes un pago pendiente en Pollos B3. Entra a la app y completa tu pedido antes de que termine el plazo.',
 CONSTRAINT mobile_checkout_policies_reminder2_content_check CHECK (length(trim(reminder2_title)) BETWEEN 1 AND 120 AND length(trim(reminder2_message)) BETWEEN 1 AND 500),
 CONSTRAINT mobile_checkout_policies_reminder_content_check CHECK (length(trim(reminder_title)) BETWEEN 1 AND 120 AND length(trim(reminder_message)) BETWEEN 1 AND 500),
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

-- Reservation scheduling policy; isolated commercial configuration, OFF by default.
-- Keep identical to server/migrations/008-store-reservation-settings.sql.
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
  preparation_minutes IS NOT NULL
 ),
 CONSTRAINT b3_reservation_window_valid CHECK(first_time IS NULL OR last_time IS NULL OR first_time < last_time),
 CONSTRAINT b3_reservation_advance_valid CHECK(min_advance_minutes IS NULL OR max_advance_days IS NULL OR min_advance_minutes < max_advance_days*1440)
);

-- Pollos B3: durable scheduled order lifecycle, isolated Administrator PostgreSQL.
-- Never apply this migration to TU VERSO's database.

CREATE TABLE IF NOT EXISTS mobile_scheduled_orders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 app_id TEXT NOT NULL,
 store_id UUID NOT NULL,
 idempotency_key UUID NOT NULL,
 access_hash CHAR(64) NOT NULL CHECK(access_hash ~ '^[a-f0-9]{64}$'),
 request_hash CHAR(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 mode TEXT NOT NULL CHECK(mode IN ('delivery','pickup')),
 scheduled_at TIMESTAMPTZ NOT NULL,
 service_date TEXT NOT NULL,
 service_time TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'CREATING'
  CHECK(status IN ('CREATING','FORM_UNCERTAIN','AWAITING_AGENT','AWAITING_PAYMENT','CONFIRMED','REJECTED','CANCELLED','EXPIRED')),
 hold_until TIMESTAMPTZ NOT NULL,
 catalog_revision INTEGER NOT NULL CHECK(catalog_revision>0),
 products JSONB NOT NULL,
 customer JSONB NOT NULL,
 destination JSONB,
 subtotal_pen NUMERIC(12,2) NOT NULL CHECK(subtotal_pen>=0),
 delivery_fee_pen NUMERIC(12,2) NOT NULL CHECK(delivery_fee_pen>=0),
 total_pen NUMERIC(12,2) NOT NULL CHECK(total_pen>=0),
 preparation_minutes INTEGER NOT NULL CHECK(preparation_minutes BETWEEN 1 AND 240),
 interaction_id UUID,
 form_key UUID NOT NULL,
 form_sent BOOLEAN NOT NULL DEFAULT false,
 cancel_notice_key UUID NOT NULL DEFAULT gen_random_uuid(),
 cancel_notice_sent BOOLEAN NOT NULL DEFAULT false,
 agent_decision_message_id UUID,
 approved_at TIMESTAMPTZ,
 payment_method TEXT CHECK(payment_method IN ('yape','plin','card','cash')),
 payment_status TEXT NOT NULL DEFAULT 'NOT_SELECTED'
  CHECK(payment_status IN ('NOT_SELECTED','AWAITING_VERIFICATION','VERIFIED','DUE_AT_RECEIPT')),
 payment_reference TEXT,
 payment_expires_at TIMESTAMPTZ,
 confirmed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(store_id,tenant_id) REFERENCES stores(id,tenant_id),
 UNIQUE(tenant_id,app_id,idempotency_key),
 UNIQUE(interaction_id),
 CONSTRAINT reservation_paid_state CHECK(status<>'CONFIRMED' OR payment_status IN ('VERIFIED','DUE_AT_RECEIPT')),
 CONSTRAINT reservation_form_acked CHECK(NOT form_sent OR interaction_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_b3_reservations_capacity
 ON mobile_scheduled_orders(tenant_id,store_id,scheduled_at,status,hold_until);
CREATE INDEX IF NOT EXISTS idx_b3_reservations_admin
 ON mobile_scheduled_orders(tenant_id,created_at DESC);
