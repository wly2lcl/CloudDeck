CREATE TABLE IF NOT EXISTS subtitle_style_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  style jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE subtitle_style_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE subtitle_style_presets FORCE ROW LEVEL SECURITY;
CREATE POLICY subtitle_style_presets_tenant_policy ON subtitle_style_presets
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON subtitle_style_presets TO clouddeck_app;
