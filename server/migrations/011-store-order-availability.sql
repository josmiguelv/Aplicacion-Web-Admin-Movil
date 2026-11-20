-- Bandera por sede para que cada aplicación consumidora consulte la disponibilidad del pedido.
-- No genera consultas ni cambia la lógica de pedidos.
BEGIN;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS consult_order_availability BOOLEAN NOT NULL DEFAULT false;
COMMIT;
