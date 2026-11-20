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
