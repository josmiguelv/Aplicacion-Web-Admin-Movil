-- Pollos B3 catalog admin: tenant isolation. Deploy in an empty, isolated PostgreSQL database.
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
  published_revision INT NOT NULL DEFAULT 0
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
