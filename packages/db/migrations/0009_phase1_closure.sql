ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_hint text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES users(id),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON api_keys(tenant_id, created_at);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY api_keys_tenant_policy ON api_keys
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO clouddeck_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON password_resets TO clouddeck_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_verifications TO clouddeck_app;

ALTER TABLE quota_usage
  ADD COLUMN IF NOT EXISTS reserved_cost_usd numeric(12,4) NOT NULL DEFAULT 0;

-- API Key 鉴权发生在登录态之前，按 hash 查询需要绕过租户 RLS。
CREATE OR REPLACE FUNCTION find_api_key_by_hash(p_hash text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  created_by uuid,
  scopes jsonb,
  revoked_at timestamptz,
  expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.id, k.tenant_id, k.created_by, k.scopes, k.revoked_at, k.expires_at
  FROM api_keys k
  WHERE k.key_hash = p_hash
$$;

GRANT EXECUTE ON FUNCTION find_api_key_by_hash(text) TO clouddeck_app;
