-- 11_myagent_api.sql
-- API functions for MyAgent personal productivity

-- List active projects for a user
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
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.name,
    p.code,
    p.description,
    p.status,
    COALESCE(g.goal_count, 0) as goal_count,
    COALESCE(t.task_count, 0) as task_count,
    p.created_at
  FROM projects p
  LEFT JOIN (
    SELECT project_id, COUNT(*) as goal_count 
    FROM project_goals 
    WHERE status IN ('open', 'in_progress')
    GROUP BY project_id
  ) g ON p.id = g.project_id
  LEFT JOIN (
    SELECT project_id, COUNT(*) as task_count
    FROM tasks
    WHERE status IN ('todo', 'doing', 'blocked')
    GROUP BY project_id  
  ) t ON p.id = t.project_id
  WHERE p.status = 'active'
    AND (user_id_param IS NULL OR p.owner_user_id = user_id_param)
  ORDER BY p.updated_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Get active tasks summary  
CREATE OR REPLACE FUNCTION api.get_active_tasks(user_id_param uuid DEFAULT NULL, limit_param int DEFAULT 10)
RETURNS TABLE (
  id uuid,
  project_name text,
  title text,
  status text,
  kind text,
  due_at timestamptz,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id,
    p.name as project_name,
    t.title,
    t.status,
    t.kind,
    t.due_at,
    t.created_at
  FROM tasks t
  JOIN projects p ON t.project_id = p.id
  WHERE t.status IN ('todo', 'doing', 'blocked')
    AND p.status = 'active'
    AND (user_id_param IS NULL OR p.owner_user_id = user_id_param)
  ORDER BY 
    CASE WHEN t.due_at IS NOT NULL THEN t.due_at ELSE '2099-01-01'::timestamptz END,
    t.created_at DESC
  LIMIT limit_param;
END;
$$ LANGUAGE plpgsql;
