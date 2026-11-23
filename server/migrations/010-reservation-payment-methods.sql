-- Add independent reservation payment policy, preserving existing delivery/pickup methods.
-- Administrator DB only; never run against TU VERSO.
BEGIN;
ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_mode_check;
ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_mode_check
 CHECK (mode IN ('delivery','pickup','dine_in','reservation'));
COMMIT;
