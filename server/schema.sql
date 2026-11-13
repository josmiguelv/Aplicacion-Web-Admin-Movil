
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),
  is_super boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES admin_users(id),
  role text NOT NULL CHECK(role IN ('TENANT_ADMIN')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),
  PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES admin_users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS mobile_apps (
  app_id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  published_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(app_id,tenant_id)
);
CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  address text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  delivery_enabled boolean NOT NULL DEFAULT false,
  pickup_enabled boolean NOT NULL DEFAULT false,
  dine_in_enabled boolean NOT NULL DEFAULT false,
  latitude double precision,
  longitude double precision,
  delivery_radius_m integer CHECK(delivery_radius_m IS NULL OR delivery_radius_m BETWEEN 100 AND 30000),
  delivery_fee_cents integer NOT NULL DEFAULT 0 CHECK(delivery_fee_cents >= 0),
  priority integer NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_stores_tenant ON stores(tenant_id,active);
CREATE TABLE IF NOT EXISTS product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  price_cents integer NOT NULL CHECK(price_cents>=0),
  available boolean NOT NULL DEFAULT true,
  image_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,image_id) REFERENCES product_images(tenant_id,id),
  UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
CREATE TABLE IF NOT EXISTS promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  discount_percent numeric(5,2) CHECK(discount_percent BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS payment_methods (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  store_id uuid NOT NULL,
  method text NOT NULL CHECK(method IN ('YAPE','PLIN','CARD','CASH')),
  mode text NOT NULL CHECK(mode IN ('DELIVERY','PICKUP','DINE_IN')),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,store_id,method,mode),
  FOREIGN KEY(tenant_id,store_id) REFERENCES stores(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS catalog_publications (
  app_id text NOT NULL REFERENCES mobile_apps(app_id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  version integer NOT NULL CHECK(version>0),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES admin_users(id),
  PRIMARY KEY(app_id,version)
);
CREATE TABLE IF NOT EXISTS admin_audit (
  id bigserial PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  actor_user_id uuid NOT NULL REFERENCES admin_users(id),
  action text NOT NULL,
  subject_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON admin_audit(tenant_id,created_at DESC);
