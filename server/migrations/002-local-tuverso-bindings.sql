-- Configuraciones locales (borrador), sin efectos remotos en TU VERSO.
-- Ejecutar solo en la base del administrador; no tocar bases de datos de TU VERSO.
BEGIN;

CREATE TABLE IF NOT EXISTS local_tuverso_queue_bindings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 store_id UUID NOT NULL,
 channel_type TEXT NOT NULL CHECK (channel_type IN ('MOBILE_APP','WEB')),
 instance_key TEXT NOT NULL CHECK (length(instance_key) BETWEEN 1 AND 180 AND instance_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]*$'),
 purpose TEXT NOT NULL CHECK (length(purpose) BETWEEN 1 AND 80 AND purpose ~ '^[A-Z][A-Z0-9_]*$'),
 remote_queue_id UUID NOT NULL,
 created_by UUID NOT NULL REFERENCES admin_users(id),
 updated_by UUID NOT NULL REFERENCES admin_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 removed_at TIMESTAMPTZ,
 FOREIGN KEY (store_id,tenant_id) REFERENCES stores(id,tenant_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS local_tuverso_bindings_active_unique
 ON local_tuverso_queue_bindings (tenant_id,channel_type,instance_key,store_id,purpose)
 WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_local_tuverso_bindings_tenant
 ON local_tuverso_queue_bindings(tenant_id) WHERE removed_at IS NULL;

COMMIT;
