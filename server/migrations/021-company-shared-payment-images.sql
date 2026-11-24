-- Company-shared Yape, Plin, Izipay payment image assets.
-- Existing per-store payment method settings remain unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS company_payment_images(
 tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 method TEXT NOT NULL CHECK(method IN ('yape','plin','card')),
 image_url TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,method),
 CONSTRAINT company_payment_images_url_check CHECK (
  image_url IS NULL OR image_url ~ '^/api/v1/mobile/images/[0-9a-f-]{36}$'
 )
);
COMMIT;
