-- Remote identity and queue metadata are not inputs to the 1A availability call.
-- Keep every existing value; allow new connections without inventing identifiers.
BEGIN;
ALTER TABLE tenant_integrations ALTER COLUMN external_tenant_id DROP NOT NULL;
ALTER TABLE tenant_integrations ALTER COLUMN channel_account_id DROP NOT NULL;
ALTER TABLE tenant_integrations ALTER COLUMN channel_type DROP NOT NULL;
ALTER TABLE tenant_integrations ALTER COLUMN instance_key DROP NOT NULL;
ALTER TABLE integration_bindings ALTER COLUMN queue_reference DROP NOT NULL;
COMMIT;
