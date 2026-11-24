-- Pollos B3: commercial notifications are configured by company, not by store.
-- Separate from personal checkout reminders. No data is deleted.
BEGIN;
CREATE TABLE IF NOT EXISTS company_mobile_notifications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 1000),
 image_url TEXT,
 scheduled_at TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','DISABLED')),
 published_at TIMESTAMPTZ,
 push_sent_at TIMESTAMPTZ,
 push_claimed_at TIMESTAMPTZ,
 push_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT company_mobile_notifications_dates CHECK(expires_at>scheduled_at)
);
CREATE INDEX IF NOT EXISTS idx_company_mobile_notifications_tenant
 ON company_mobile_notifications(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_mobile_notifications_push
 ON company_mobile_notifications(status,scheduled_at) WHERE push_sent_at IS NULL;
COMMIT;
