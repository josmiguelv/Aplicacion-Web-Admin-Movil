-- One configured image per provider per tenant (Yape, Plin, Izipay/card).
-- Run ONLY against the Administrator database after migration 007.
BEGIN;
CREATE TABLE IF NOT EXISTS tenant_payment_images (
 tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 method TEXT NOT NULL CHECK (method IN ('yape','plin','card')),
 image_id UUID NOT NULL REFERENCES product_images(id) ON DELETE RESTRICT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, method)
);
COMMIT;
