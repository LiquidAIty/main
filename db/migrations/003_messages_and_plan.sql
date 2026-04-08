-- Messages table for chat history persistence
CREATE TABLE IF NOT EXISTS ag_catalog.messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  turn_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_project_id ON ag_catalog.messages(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON ag_catalog.messages(created_at);

-- Plan Wiki table for HumanPlan / AgentPrompt Wiki persistence
CREATE TABLE IF NOT EXISTS ag_catalog.plan_wiki (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  anchor TEXT NOT NULL,
  what_changed JSONB NOT NULL DEFAULT '[]',
  open_questions JSONB NOT NULL DEFAULT '[]',
  sources JSONB NOT NULL DEFAULT '[]',
  delta_summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft', 'grounded', 'revised')),
  turn_id TEXT,
  last_user_message TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_wiki_project_id ON ag_catalog.plan_wiki(project_id);
