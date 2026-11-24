-- Two independent private-payment reminders per company.
-- Existing title/message remain reminder 1. No orders or notifications are deleted.
BEGIN;
ALTER TABLE mobile_checkout_policies
 ADD COLUMN IF NOT EXISTS reminder2_title TEXT NOT NULL DEFAULT '⏰ Tu pedido sigue pendiente',
 ADD COLUMN IF NOT EXISTS reminder2_message TEXT NOT NULL DEFAULT 'Aún tienes un pago pendiente en Pollos B3. Entra a la app y completa tu pedido antes de que termine el plazo.';
ALTER TABLE mobile_checkout_policies
 DROP CONSTRAINT IF EXISTS mobile_checkout_policies_reminder2_content_check;
ALTER TABLE mobile_checkout_policies
 ADD CONSTRAINT mobile_checkout_policies_reminder2_content_check CHECK (
  length(trim(reminder2_title)) BETWEEN 1 AND 120
  AND length(trim(reminder2_message)) BETWEEN 1 AND 500
 );
COMMIT;
