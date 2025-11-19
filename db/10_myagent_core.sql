-- 10_myagent_core.sql
-- Core tables for MyAgent / Personal Agency

-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- Already exists

-- 1) Projects (per user)
CREATE TABLE IF NOT EXISTS projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  name         text NOT NULL,
  code         text,              -- short slug, e.g. 'liquidaity'
  description  text,
  status       text NOT NULL DEFAULT 'active', -- active|paused|archived
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_owner
  ON projects(owner_user_id);

-- 2) Goals (per project)
CREATE TABLE IF NOT EXISTS project_goals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  status       text NOT NULL DEFAULT 'open',   -- open|in_progress|done|dropped
  priority     int  NOT NULL DEFAULT 5,        -- 1=highest
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  due_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_goals_project
  ON project_goals(project_id);

-- 3) Plans (versioned per project)
CREATE TABLE IF NOT EXISTS project_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version       int  NOT NULL,
  summary       text,
  detail        text,
  active        boolean NOT NULL DEFAULT true,
  supersedes_id uuid REFERENCES project_plans(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_project_version
  ON project_plans(project_id, version);

CREATE INDEX IF NOT EXISTS idx_plans_project_active
  ON project_plans(project_id) WHERE active = true;

-- 4) Plan deltas (change-of-plan log)
CREATE TABLE IF NOT EXISTS plan_deltas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_plan_id  uuid REFERENCES project_plans(id),
  to_plan_id    uuid REFERENCES project_plans(id),
  reason        text,
  created_by    uuid,           -- user_id
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_deltas_project
  ON plan_deltas(project_id);

-- 5) Tasks (per goal / project)
CREATE TABLE IF NOT EXISTS tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  goal_id      uuid REFERENCES project_goals(id) ON DELETE SET NULL,
  title        text NOT NULL,
  description  text,
  kind         text,            -- code|research|ops|trade|...
  status       text NOT NULL DEFAULT 'todo',  -- todo|doing|blocked|done|dropped
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  due_at       timestamptz,
  metadata     jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tasks_project
  ON tasks(project_id);

CREATE INDEX IF NOT EXISTS idx_tasks_goal
  ON tasks(goal_id);

CREATE INDEX IF NOT EXISTS idx_tasks_status
  ON tasks(status);

-- 6) Executions (runs / operations tied to tasks)
CREATE TABLE IF NOT EXISTS executions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid REFERENCES tasks(id) ON DELETE SET NULL,
  agent_name   text,            -- "MyAgent","RootCodeAI","Sol", etc.
  result       jsonb,           -- structured payload from the run
  ok           boolean,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_executions_task
  ON executions(task_id);

-- 7) Preferences (per user, generic key/value)
CREATE TABLE IF NOT EXISTS preferences (
  user_id      uuid NOT NULL,
  key          text NOT NULL,
  value        jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
