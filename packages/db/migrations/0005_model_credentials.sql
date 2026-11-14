CREATE TABLE IF NOT EXISTS model_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  label text NOT NULL,
  encrypted_secret text NOT NULL,
  key_hint text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS model_credentials_tenant_idx
  ON model_credentials(tenant_id, provider, created_at);

ALTER TABLE model_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY model_credentials_tenant_policy ON model_credentials
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON model_credentials TO clouddeck_app;
