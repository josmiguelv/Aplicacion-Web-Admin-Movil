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
