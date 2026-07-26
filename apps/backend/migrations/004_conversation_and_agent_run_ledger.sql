-- Normalize the live Main/OpenClaude transcript and outer run lifecycle.
-- Exact message/result text belongs in PostgreSQL rows. Apache AGE remains the
-- relationship/lineage authority; the model runtime remains OpenClaude/Python.

BEGIN;

CREATE TABLE IF NOT EXISTS ag_catalog.conversations (
  project_id UUID NOT NULL REFERENCES ag_catalog.projects(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  next_seq BIGINT NOT NULL DEFAULT 0 CHECK (next_seq >= 0),
  PRIMARY KEY (project_id, conversation_id)
);

CREATE TABLE IF NOT EXISTS ag_catalog.conversation_messages (
  project_id UUID NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  parent_message_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool', 'question', 'answer')),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'streaming', 'complete', 'error')),
  seq BIGINT NOT NULL CHECK (seq > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  provider_continuation_ref TEXT,
  provider_message_id TEXT,
  linked_plan_draft_id TEXT,
  linked_plan_step_id TEXT,
  linked_artifact_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(linked_artifact_ids) = 'array'),
  linked_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(linked_evidence_ids) = 'array'),
  visible_activities JSONB,
  PRIMARY KEY (project_id, message_id),
  UNIQUE (project_id, conversation_id, seq),
  FOREIGN KEY (project_id, conversation_id)
    REFERENCES ag_catalog.conversations(project_id, conversation_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS conversation_messages_history_idx
  ON ag_catalog.conversation_messages(project_id, conversation_id, seq);

CREATE INDEX IF NOT EXISTS conversation_messages_parent_idx
  ON ag_catalog.conversation_messages(project_id, parent_message_id)
  WHERE parent_message_id IS NOT NULL;

-- Extend the existing Python-owned card_run_traces record. This remains one
-- run authority for AutoGen card traces and the outer OpenClaude lifecycle.
CREATE TABLE IF NOT EXISTS ag_catalog.card_run_traces (
  project_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  deck_id TEXT NOT NULL DEFAULT '',
  card_id TEXT NOT NULL DEFAULT '',
  profile_id TEXT,
  profile_version INTEGER,
  skill_versions JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_binding_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  outcome TEXT NOT NULL DEFAULT 'pending',
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, correlation_id)
);

ALTER TABLE ag_catalog.card_run_traces
  ADD COLUMN IF NOT EXISTS conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS runtime TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS model_key TEXT,
  ADD COLUMN IF NOT EXISTS provider_model_id TEXT,
  ADD COLUMN IF NOT EXISTS user_message_id TEXT,
  ADD COLUMN IF NOT EXISTS result_message_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_input_tokens BIGINT,
  ADD COLUMN IF NOT EXISTS provider_output_tokens BIGINT,
  ADD COLUMN IF NOT EXISTS total_cost_usd DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS usage_available BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS usage_source TEXT,
  ADD COLUMN IF NOT EXISTS context_breakdown_json TEXT,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE ag_catalog.card_run_traces
SET runtime = COALESCE(runtime, 'autogen'),
    state = COALESCE(state, 'completed'),
    completed_at = COALESCE(completed_at, created_at),
    updated_at = COALESCE(updated_at, created_at)
WHERE runtime IS NULL OR state IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS card_run_traces_correlation_uidx
  ON ag_catalog.card_run_traces(correlation_id);

CREATE INDEX IF NOT EXISTS card_run_traces_conversation_idx
  ON ag_catalog.card_run_traces(project_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS card_run_traces_active_idx
  ON ag_catalog.card_run_traces(project_id, state)
  WHERE state IN ('pending', 'running');

-- One-time, idempotent import from the retired project-row JSONB authority.
-- The legacy key is intentionally left untouched as recoverable historical
-- data; application reads and writes move to the normalized tables.
INSERT INTO ag_catalog.conversations (
  project_id,
  conversation_id,
  title,
  created_at,
  updated_at,
  archived_at,
  next_seq
)
SELECT
  project.id,
  COALESCE(NULLIF(item.value->>'conversationId', ''), item.key),
  NULLIF(item.value->>'title', ''),
  COALESCE(NULLIF(item.value->>'createdAt', '')::timestamptz, project.created_at),
  COALESCE(NULLIF(item.value->>'updatedAt', '')::timestamptz, project.updated_at),
  NULLIF(item.value->>'archivedAt', '')::timestamptz,
  0
FROM ag_catalog.projects AS project
CROSS JOIN LATERAL jsonb_each(
  COALESCE(
    project.agent_io_schema->'liquidaity_conversations_v1'->'conversations',
    '{}'::jsonb
  )
) AS item
ON CONFLICT (project_id, conversation_id) DO NOTHING;

-- Preserve messages whose legacy conversation entry is absent.
INSERT INTO ag_catalog.conversations (project_id, conversation_id, created_at, updated_at, next_seq)
SELECT
  project.id,
  item.value->>'conversationId',
  MIN(COALESCE(NULLIF(item.value->>'createdAt', '')::timestamptz, project.created_at)),
  MAX(COALESCE(NULLIF(item.value->>'createdAt', '')::timestamptz, project.updated_at)),
  0
FROM ag_catalog.projects AS project
CROSS JOIN LATERAL jsonb_each(
  COALESCE(
    project.agent_io_schema->'liquidaity_conversations_v1'->'messages',
    '{}'::jsonb
  )
) AS item
WHERE NULLIF(item.value->>'conversationId', '') IS NOT NULL
GROUP BY project.id, item.value->>'conversationId'
ON CONFLICT (project_id, conversation_id) DO NOTHING;

INSERT INTO ag_catalog.conversation_messages (
  project_id,
  conversation_id,
  message_id,
  parent_message_id,
  role,
  content,
  status,
  seq,
  created_at,
  completed_at,
  provider_continuation_ref,
  provider_message_id,
  linked_plan_draft_id,
  linked_plan_step_id,
  linked_artifact_ids,
  linked_evidence_ids,
  visible_activities
)
SELECT
  project.id,
  item.value->>'conversationId',
  COALESCE(NULLIF(item.value->>'messageId', ''), item.key),
  NULLIF(item.value->>'parentMessageId', ''),
  COALESCE(NULLIF(item.value->>'role', ''), 'user'),
  COALESCE(item.value->>'content', ''),
  COALESCE(NULLIF(item.value->>'status', ''), 'complete'),
  (item.value->>'seq')::bigint,
  COALESCE(NULLIF(item.value->>'createdAt', '')::timestamptz, project.created_at),
  NULLIF(item.value->>'completedAt', '')::timestamptz,
  NULLIF(item.value->>'providerContinuationRef', ''),
  NULLIF(item.value->>'providerMessageId', ''),
  NULLIF(item.value->>'linkedPlanDraftId', ''),
  NULLIF(item.value->>'linkedPlanStepId', ''),
  CASE
    WHEN jsonb_typeof(item.value->'linkedArtifactIds') = 'array'
      THEN item.value->'linkedArtifactIds'
    ELSE '[]'::jsonb
  END,
  CASE
    WHEN jsonb_typeof(item.value->'linkedEvidenceIds') = 'array'
      THEN item.value->'linkedEvidenceIds'
    ELSE '[]'::jsonb
  END,
  CASE
    WHEN jsonb_typeof(item.value->'visibleActivities') = 'array'
      THEN item.value->'visibleActivities'
    ELSE NULL
  END
FROM ag_catalog.projects AS project
CROSS JOIN LATERAL jsonb_each(
  COALESCE(
    project.agent_io_schema->'liquidaity_conversations_v1'->'messages',
    '{}'::jsonb
  )
) AS item
WHERE NULLIF(item.value->>'conversationId', '') IS NOT NULL
  AND NULLIF(item.value->>'seq', '') IS NOT NULL
ON CONFLICT (project_id, message_id) DO NOTHING;

UPDATE ag_catalog.conversations AS conversation
SET next_seq = greatest(conversation.next_seq, imported.max_seq)
FROM (
  SELECT project_id, conversation_id, MAX(seq) AS max_seq
  FROM ag_catalog.conversation_messages
  GROUP BY project_id, conversation_id
) AS imported
WHERE conversation.project_id = imported.project_id
  AND conversation.conversation_id = imported.conversation_id;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ag_catalog.conversations, ag_catalog.conversation_messages, ag_catalog.card_run_traces
  TO "liquidaity-user";

COMMIT;
