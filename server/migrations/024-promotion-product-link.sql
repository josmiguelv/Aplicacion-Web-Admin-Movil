-- Link scheduled promotions to a catalog product (including combo products).
-- Existing promotions are preserved with NULL; newly created scheduled promotions require a product in the API.
BEGIN;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS product_id UUID;
CREATE INDEX IF NOT EXISTS promotions_tenant_product_idx ON promotions(tenant_id,product_id);
-- The write route validates same-tenant and active product; this constraint also prevents cross-tenant links.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='promotions_product_same_tenant_fkey') THEN
  ALTER TABLE promotions ADD CONSTRAINT promotions_product_same_tenant_fkey
   FOREIGN KEY (product_id,tenant_id) REFERENCES products(id,tenant_id);
 END IF;
END $$;
COMMIT;
