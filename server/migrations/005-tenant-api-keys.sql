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
