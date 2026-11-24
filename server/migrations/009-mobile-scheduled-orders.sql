-- Pollos B3: durable scheduled order lifecycle, isolated Administrator PostgreSQL.
-- Never apply this migration to TU VERSO's database.
BEGIN;
CREATE TABLE IF NOT EXISTS mobile_scheduled_orders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 app_id TEXT NOT NULL,
 store_id UUID NOT NULL,
 idempotency_key UUID NOT NULL,
 access_hash CHAR(64) NOT NULL CHECK(access_hash ~ '^[a-f0-9]{64}$'),
 request_hash CHAR(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 mode TEXT NOT NULL CHECK(mode IN ('delivery','pickup')),
 scheduled_at TIMESTAMPTZ NOT NULL,
 service_date TEXT NOT NULL,
 service_time TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'CREATING'
  CHECK(status IN ('CREATING','FORM_UNCERTAIN','AWAITING_AGENT','AWAITING_PAYMENT','CONFIRMED','REJECTED','CANCELLED','EXPIRED')),
 hold_until TIMESTAMPTZ NOT NULL,
 catalog_revision INTEGER NOT NULL CHECK(catalog_revision>0),
 products JSONB NOT NULL,
 customer JSONB NOT NULL,
 destination JSONB,
 subtotal_pen NUMERIC(12,2) NOT NULL CHECK(subtotal_pen>=0),
 delivery_fee_pen NUMERIC(12,2) NOT NULL CHECK(delivery_fee_pen>=0),
 total_pen NUMERIC(12,2) NOT NULL CHECK(total_pen>=0),
 preparation_minutes INTEGER NOT NULL CHECK(preparation_minutes BETWEEN 1 AND 240),
 interaction_id UUID,
 form_key UUID NOT NULL,
 form_sent BOOLEAN NOT NULL DEFAULT false,
 cancel_notice_key UUID NOT NULL DEFAULT gen_random_uuid(),
 cancel_notice_sent BOOLEAN NOT NULL DEFAULT false,
 agent_decision_message_id UUID,
 approved_at TIMESTAMPTZ,
 payment_method TEXT CHECK(payment_method IN ('yape','plin','card','cash')),
 payment_status TEXT NOT NULL DEFAULT 'NOT_SELECTED'
  CHECK(payment_status IN ('NOT_SELECTED','AWAITING_VERIFICATION','VERIFIED','DUE_AT_RECEIPT')),
 payment_reference TEXT,
 payment_expires_at TIMESTAMPTZ,
 confirmed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(store_id,tenant_id) REFERENCES stores(id,tenant_id),
 UNIQUE(tenant_id,app_id,idempotency_key),
 UNIQUE(interaction_id),
 CONSTRAINT reservation_paid_state CHECK(status<>'CONFIRMED' OR payment_status IN ('VERIFIED','DUE_AT_RECEIPT')),
 CONSTRAINT reservation_form_acked CHECK(NOT form_sent OR interaction_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_b3_reservations_capacity
 ON mobile_scheduled_orders(tenant_id,store_id,scheduled_at,status,hold_until);
CREATE INDEX IF NOT EXISTS idx_b3_reservations_admin
 ON mobile_scheduled_orders(tenant_id,created_at DESC);
COMMIT;
