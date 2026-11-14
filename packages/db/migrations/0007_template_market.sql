ALTER TABLE templates ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION list_public_templates()
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  payload jsonb,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.name, t.description, t.payload, t.created_at
  FROM templates t
  WHERE t.is_public = true
  ORDER BY t.created_at DESC
$$;

CREATE OR REPLACE FUNCTION get_public_template(p_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  payload jsonb,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.name, t.description, t.payload, t.created_at
  FROM templates t
  WHERE t.id = p_id AND t.is_public = true
$$;

GRANT EXECUTE ON FUNCTION list_public_templates() TO clouddeck_app;
GRANT EXECUTE ON FUNCTION get_public_template(uuid) TO clouddeck_app;
