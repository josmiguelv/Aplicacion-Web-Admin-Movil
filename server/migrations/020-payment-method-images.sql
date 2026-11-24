-- B3 Admin: optional image per payment method, store, and fulfillment mode.
-- CASH never accepts an image. Existing enabled flags and records are preserved.
BEGIN;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_image_guard;
ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_image_guard CHECK (
 (method='cash' AND image_url IS NULL) OR
 (method<>'cash' AND (image_url IS NULL OR image_url ~ '^/api/v1/mobile/images/[0-9a-f-]{36}$'))
);
COMMIT;
