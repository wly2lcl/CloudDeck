CREATE TABLE IF NOT EXISTS collab_docs (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_id text NOT NULL,
  state_b64 text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, doc_id)
);

ALTER TABLE collab_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE collab_docs FORCE ROW LEVEL SECURITY;
CREATE POLICY collab_docs_tenant_policy ON collab_docs
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON collab_docs TO clouddeck_app;
