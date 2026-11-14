CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text NOT NULL,
  tier text NOT NULL,
  amount_usd numeric(12,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);
CREATE INDEX IF NOT EXISTS payments_tenant_idx ON payments(tenant_id, created_at);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_tenant_policy ON payments
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

CREATE TABLE IF NOT EXISTS device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token)
);
CREATE INDEX IF NOT EXISTS device_tokens_tenant_idx ON device_tokens(tenant_id, user_id);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY device_tokens_tenant_policy ON device_tokens
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO clouddeck_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON device_tokens TO clouddeck_app;

-- 支付回调没有登录态，按 provider + external_id 定位支付单后再进入租户上下文。
CREATE OR REPLACE FUNCTION find_payment_by_external(p_provider text, p_external text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  tier text,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.tenant_id, p.tier, p.status
  FROM payments p
  WHERE p.provider = p_provider AND p.external_id = p_external
$$;

GRANT EXECUTE ON FUNCTION find_payment_by_external(text, text) TO clouddeck_app;
