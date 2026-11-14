CREATE TABLE IF NOT EXISTS tenant_capabilities (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  capability_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, capability_id)
);

CREATE TABLE IF NOT EXISTS templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS templates_tenant_idx ON templates(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shares_project_idx ON shares(tenant_id, project_id);

ALTER TABLE tenant_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_capabilities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_capabilities_tenant_policy ON tenant_capabilities
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates FORCE ROW LEVEL SECURITY;
CREATE POLICY templates_tenant_policy ON templates
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE shares FORCE ROW LEVEL SECURITY;
CREATE POLICY shares_tenant_policy ON shares
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_capabilities TO clouddeck_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON templates TO clouddeck_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON shares TO clouddeck_app;

-- 公开分享按 token 查询时必须绕过租户 RLS，先定位分享再进入租户上下文。
CREATE OR REPLACE FUNCTION find_share_by_token(p_hash text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  project_id uuid,
  expires_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.tenant_id, s.project_id, s.expires_at, s.revoked_at
  FROM shares s
  WHERE s.token_hash = p_hash
$$;

GRANT EXECUTE ON FUNCTION find_share_by_token(text) TO clouddeck_app;
