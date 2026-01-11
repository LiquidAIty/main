-- db/12_myagent_api_patch.sql
-- Patch for api.list_projects to remove ambiguous "status" references
-- and fully qualify all table columns.

CREATE OR REPLACE FUNCTION api.list_projects(user_id_param uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  name text,
  code text,
  description text,
  status text,
  goal_count bigint,
  task_count bigint,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.code,
    p.description,
    p.status,
    COALESCE(g.goal_count, 0)  AS goal_count,
    COALESCE(t.task_count, 0)  AS task_count,
    p.created_at
  FROM projects p
  LEFT JOIN (
    SELECT
      pg.project_id,
      COUNT(*) AS goal_count
    FROM project_goals pg
    WHERE pg.status IN ('open', 'in_progress')
    GROUP BY pg.project_id
  ) g
    ON p.id = g.project_id
  LEFT JOIN (
    SELECT
      t2.project_id,
      COUNT(*) AS task_count
    FROM tasks t2
    WHERE t2.status IN ('todo', 'doing', 'blocked')
    GROUP BY t2.project_id
  ) t
    ON p.id = t.project_id
  WHERE p.status = 'active'
    AND (user_id_param IS NULL OR p.owner_user_id = user_id_param)
  ORDER BY p.updated_at DESC;
END;
$$;
