-- Producto opcional en notificaciones: nunca forzar un producto para avisos informativos.
-- Referencia segura: producto del mismo tenant; eliminación del producto desvincula el aviso.
BEGIN;
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS product_id UUID;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='scheduled_notifications'::regclass AND conname='scheduled_notifications_product_same_tenant_fk') THEN
  ALTER TABLE scheduled_notifications ADD CONSTRAINT scheduled_notifications_product_same_tenant_fk
   FOREIGN KEY(product_id,tenant_id) REFERENCES products(id,tenant_id) MATCH SIMPLE
   ON DELETE SET NULL (product_id);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_notifications_product ON scheduled_notifications(product_id) WHERE product_id IS NOT NULL;
COMMIT;
