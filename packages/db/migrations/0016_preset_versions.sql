ALTER TABLE subtitle_style_presets
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS subtitle_style_preset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  preset_id uuid NOT NULL REFERENCES subtitle_style_presets(id) ON DELETE CASCADE,
  version integer NOT NULL,
  style jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (preset_id, version)
);
ALTER TABLE subtitle_style_preset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subtitle_style_preset_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY subtitle_style_preset_versions_tenant_policy ON subtitle_style_preset_versions
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON subtitle_style_preset_versions TO clouddeck_app;

INSERT INTO subtitle_style_preset_versions (tenant_id, preset_id, version, style)
SELECT tenant_id, id, version, style FROM subtitle_style_presets
ON CONFLICT (preset_id, version) DO NOTHING;
