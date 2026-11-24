-- Company-wide private checkout reminders: configuration and notification preview text.
-- This changes only the independent B3 Administrator database.
BEGIN;
ALTER TABLE mobile_checkout_policies
 ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS reminder_title TEXT NOT NULL DEFAULT 'Tu compra está pendiente',
 ADD COLUMN IF NOT EXISTS reminder_message TEXT NOT NULL DEFAULT 'Continúa con el pago o cancela tu solicitud de Pollos B3.';
ALTER TABLE mobile_checkout_policies
 DROP CONSTRAINT IF EXISTS mobile_checkout_policies_reminder_content_check;
ALTER TABLE mobile_checkout_policies
 ADD CONSTRAINT mobile_checkout_policies_reminder_content_check CHECK (
  length(trim(reminder_title)) BETWEEN 1 AND 120
  AND length(trim(reminder_message)) BETWEEN 1 AND 500
 );
COMMIT;
