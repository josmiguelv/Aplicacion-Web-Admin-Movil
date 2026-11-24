-- Pollos B3 Administrador Web: independent per-service schedules.
-- Only apply to local Admin PostgreSQL after code update; no TU VERSO changes.
BEGIN;
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS service_hours JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMIT;
