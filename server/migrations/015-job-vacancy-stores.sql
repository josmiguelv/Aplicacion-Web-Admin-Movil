-- Pollos B3 Administrator Web only: assign a vacancy to one or more stores.
-- Existing jobs and their image URLs are preserved; no changes to TU VERSO.
BEGIN;
CREATE TABLE IF NOT EXISTS job_vacancy_stores (
 tenant_id UUID NOT NULL,
 vacancy_id UUID NOT NULL,
 store_id UUID NOT NULL,
 PRIMARY KEY (tenant_id,vacancy_id,store_id),
 FOREIGN KEY(vacancy_id,tenant_id) REFERENCES job_vacancies(id,tenant_id) ON DELETE CASCADE,
 FOREIGN KEY(store_id,tenant_id) REFERENCES stores(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_job_vacancy_stores_store
 ON job_vacancy_stores(tenant_id,store_id);
COMMIT;
