-- Receipt images are separate from published products and company payment artwork.
-- The existing product_images bytes are reused; no historical rows are modified.
BEGIN;
CREATE TABLE IF NOT EXISTS mobile_payment_receipt_images (
 image_id UUID PRIMARY KEY REFERENCES product_images(id) ON DELETE CASCADE,
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 app_id TEXT NOT NULL REFERENCES mobile_apps(app_id),
 store_id UUID NOT NULL,
 interaction_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY (store_id,tenant_id) REFERENCES stores(id,tenant_id)
);
CREATE INDEX IF NOT EXISTS mobile_payment_receipt_images_interaction
 ON mobile_payment_receipt_images(tenant_id,interaction_id,created_at DESC);
COMMIT;
