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
  active BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS payment_methods (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  store_id UUID NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('delivery','pickup','dine_in')),
  method TEXT NOT NULL CHECK(method IN ('yape','plin','card','cash')),
  enabled BOOLEAN NOT NULL DEFAULT false,
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
