-- CloudDeck M1 初始化：多租户、资产、能力、任务、计量与审计

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  tier text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text,
  locale text NOT NULL DEFAULT 'zh-CN',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  device text,
  ip text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  cover_asset_id uuid,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS projects_tenant_created_idx ON projects(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  storage_key text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  latest_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_tenant_project_idx ON assets(tenant_id, project_id, type);

CREATE TABLE IF NOT EXISTS asset_versions (
  tenant_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  version integer NOT NULL,
  storage_key text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, version)
);

CREATE TABLE IF NOT EXISTS asset_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_asset_id uuid NOT NULL,
  from_version integer NOT NULL,
  to_asset_id uuid NOT NULL,
  to_version integer NOT NULL,
  relation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_links_from_idx ON asset_links(tenant_id, from_asset_id);
CREATE INDEX IF NOT EXISTS asset_links_to_idx ON asset_links(tenant_id, to_asset_id);

CREATE TABLE IF NOT EXISTS capabilities (
  id text NOT NULL,
  version text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  manifest jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active',
  driver_default text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS capability_drivers (
  capability_id text NOT NULL,
  driver_id text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (capability_id, driver_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  capability_id text NOT NULL,
  capability_version text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  driver_id text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_cost_usd numeric(12,4) NOT NULL DEFAULT 0,
  actual_cost_usd numeric(12,4) NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  retried_from_job_id uuid,
  resume_count integer NOT NULL DEFAULT 0,
  cancel_requested boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  created_by uuid REFERENCES users(id),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_tenant_status_idx ON jobs(tenant_id, status);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(status, created_at);

CREATE TABLE IF NOT EXISTS job_events (
  seq bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_events_job_seq_idx ON job_events(job_id, seq);

CREATE TABLE IF NOT EXISTS job_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,
  version integer NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id uuid,
  capability_id text NOT NULL,
  driver_id text NOT NULL,
  unit text NOT NULL,
  quantity numeric(16,4) NOT NULL,
  unit_price numeric(12,6) NOT NULL,
  amount_usd numeric(12,4) NOT NULL,
  model text,
  provider text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_tenant_time_idx ON usage_ledger(tenant_id, occurred_at);

CREATE TABLE IF NOT EXISTS quota_limits (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  max_cost_usd numeric(12,4) NOT NULL DEFAULT 5,
  max_jobs integer NOT NULL DEFAULT 50,
  max_concurrency integer NOT NULL DEFAULT 1,
  storage_bytes bigint NOT NULL DEFAULT 2147483648
);

CREATE TABLE IF NOT EXISTS quota_usage (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period text NOT NULL,
  cost_usd numeric(12,4) NOT NULL DEFAULT 0,
  job_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, period)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor_type text NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  target_type text,
  target_id text,
  ip text,
  user_agent text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_tenant_time_idx ON audit_logs(tenant_id, created_at);

-- 租户上下文函数：未设置时返回 NULL，策略自然拒绝
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- 行级安全：对租户表启用并强制
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects', 'assets', 'asset_versions', 'asset_links', 'jobs',
    'job_events', 'job_artifacts', 'usage_ledger', 'quota_limits',
    'quota_usage', 'audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t || '_tenant_policy', t
    );
  END LOOP;
END $$;

-- 非超级用户角色：生产连接使用它，RLS 才会真正生效
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clouddeck_app') THEN
    CREATE ROLE clouddeck_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO clouddeck_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clouddeck_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clouddeck_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clouddeck_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO clouddeck_app;
