CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period text NOT NULL,
  total_usd numeric(12,4) NOT NULL,
  job_count integer NOT NULL,
  snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'issued',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period)
);
CREATE INDEX IF NOT EXISTS invoices_tenant_idx ON invoices(tenant_id, period);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY invoices_tenant_policy ON invoices
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO clouddeck_app;
