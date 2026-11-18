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
