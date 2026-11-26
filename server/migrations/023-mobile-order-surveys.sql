-- Pollos B3: append-only, tenant-bound post-order satisfaction surveys.
BEGIN;
CREATE TABLE IF NOT EXISTS mobile_order_surveys (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 app_id TEXT NOT NULL,
 store_id UUID NOT NULL,
 interaction_id UUID NOT NULL,
 idempotency_key UUID NOT NULL,
 rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
 tags JSONB NOT NULL DEFAULT '[]'::jsonb,
 comment TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT mobile_order_surveys_app_fk FOREIGN KEY (app_id) REFERENCES mobile_apps(app_id),
 CONSTRAINT mobile_order_surveys_store_fk FOREIGN KEY (store_id,tenant_id) REFERENCES stores(id,tenant_id),
 CONSTRAINT mobile_order_surveys_tags_check CHECK (
  jsonb_typeof(tags)='array' AND jsonb_array_length(tags)<=5 AND
  tags <@ '["Sabor","Temperatura","Tiempo","Presentación","Atención"]'::jsonb
 ),
 CONSTRAINT mobile_order_surveys_comment_check CHECK (comment IS NULL OR char_length(comment)<=500),
 CONSTRAINT mobile_order_surveys_interaction_unique UNIQUE (tenant_id,app_id,interaction_id),
 CONSTRAINT mobile_order_surveys_idempotency_unique UNIQUE (tenant_id,app_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS mobile_order_surveys_listing
 ON mobile_order_surveys(tenant_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS mobile_order_surveys_store_date
 ON mobile_order_surveys(tenant_id,store_id,created_at DESC);
COMMIT;
