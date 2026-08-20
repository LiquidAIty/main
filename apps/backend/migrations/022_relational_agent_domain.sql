-- Stable Project/Deck/Card persistence for the runtime MVP.
--
-- Dynamic prompts, hydrated context, provider requests,
-- ordinary responses, and transcripts are intentionally absent. The existing
-- legacy tables and project JSONB are preserved read-only until cutover proof.
-- React Flow Card relationships live only in AGE after an explicit one-time
-- Python cutover; this migration creates vocabulary but never seeds startup
-- topology.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
LOAD 'age';
SET LOCAL search_path = ag_catalog, "$user", public;

CREATE TABLE IF NOT EXISTS ag_catalog.deck_legacy_snapshots (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES ag_catalog.projects(id) ON DELETE RESTRICT,
  deck_id TEXT NOT NULL,
  source_revision TEXT,
  snapshot_json JSONB NOT NULL CHECK (jsonb_typeof(snapshot_json) = 'object'),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, deck_id, source_revision)
);

CREATE TABLE IF NOT EXISTS ag_catalog.agent_decks (
  project_id UUID NOT NULL REFERENCES ag_catalog.projects(id) ON DELETE RESTRICT,
  deck_id TEXT NOT NULL,
  name TEXT NOT NULL,
  workspace_root TEXT,
  document_version INTEGER NOT NULL CHECK (document_version > 0),
  revision TEXT NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, deck_id),
  UNIQUE (project_id, revision)
);

CREATE TABLE IF NOT EXISTS ag_catalog.deck_prompt_templates (
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  content TEXT NOT NULL,
  PRIMARY KEY (project_id, deck_id, template_id),
  UNIQUE (project_id, deck_id, ordinal),
  FOREIGN KEY (project_id, deck_id)
    REFERENCES ag_catalog.agent_decks(project_id, deck_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ag_catalog.agent_cards (
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_revision_id UUID,
  PRIMARY KEY (project_id, deck_id, card_id),
  FOREIGN KEY (project_id, deck_id)
    REFERENCES ag_catalog.agent_decks(project_id, deck_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ag_catalog.agent_card_revisions (
  revision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  template_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'agent' CHECK (kind = 'agent'),
  title TEXT NOT NULL,
  subtitle TEXT,
  role TEXT,
  status TEXT,
  parent_graph_id TEXT,
  base_prompt TEXT NOT NULL,
  base_prompt_sha256 TEXT NOT NULL,
  stable_output_contract TEXT,
  runtime_type TEXT NOT NULL CHECK (runtime_type IN ('assistant_agent', 'magentic_one')),
  runtime_binding TEXT,
  provider TEXT,
  model_key TEXT,
  provider_model_id TEXT,
  access_mode TEXT CHECK (
    access_mode IS NULL OR access_mode IN (
      'chatgpt-account', 'coder-oauth', 'openai-api', 'openrouter-api'
    )
  ),
  reasoning_effort TEXT CHECK (
    reasoning_effort IS NULL OR reasoning_effort IN ('low', 'medium', 'high', 'xhigh')
  ),
  temperature DOUBLE PRECISION,
  max_tokens INTEGER CHECK (max_tokens IS NULL OR max_tokens > 0),
  max_turns INTEGER CHECK (max_turns IS NULL OR max_turns > 0),
  execution_mode TEXT CHECK (
    execution_mode IS NULL OR execution_mode IN ('single', 'auto-kanban')
  ),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  enabled_location TEXT NOT NULL DEFAULT 'default' CHECK (
    enabled_location IN ('default', 'card', 'runtime-options')
  ),
  -- Bounded provider/runtime extension fields only; never a complete Card,
  -- prompt envelope, topology document, or orchestration state.
  runtime_extension_config JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(runtime_extension_config) = 'object'),
  revision_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, deck_id, card_id, revision_number),
  FOREIGN KEY (project_id, deck_id, card_id)
    REFERENCES ag_catalog.agent_cards(project_id, deck_id, card_id) ON DELETE RESTRICT
);

ALTER TABLE ag_catalog.agent_cards
  DROP CONSTRAINT IF EXISTS agent_cards_current_revision_fkey;
ALTER TABLE ag_catalog.agent_cards
  ADD CONSTRAINT agent_cards_current_revision_fkey
  FOREIGN KEY (current_revision_id)
  REFERENCES ag_catalog.agent_card_revisions(revision_id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS ag_catalog.deck_card_memberships (
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  position_x DOUBLE PRECISION NOT NULL,
  position_y DOUBLE PRECISION NOT NULL,
  parent_graph_id TEXT,
  display_status TEXT,
  -- Flexible React presentation state only. Stable Card execution fields are
  -- relational columns/facets/grants and are never reconstructed from here.
  presentation_config JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(presentation_config) = 'object'),
  PRIMARY KEY (project_id, deck_id, card_id),
  UNIQUE (project_id, deck_id, ordinal),
  FOREIGN KEY (project_id, deck_id, card_id)
    REFERENCES ag_catalog.agent_cards(project_id, deck_id, card_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ag_catalog.card_capability_grants (
  revision_id UUID NOT NULL REFERENCES ag_catalog.agent_card_revisions(revision_id) ON DELETE CASCADE,
  grant_kind TEXT NOT NULL CHECK (
    grant_kind IN ('tool', 'native_tool', 'skill', 'toolset', 'mcp_connection', 'coder_card')
  ),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  grant_id TEXT NOT NULL,
  PRIMARY KEY (revision_id, grant_kind, grant_id),
  UNIQUE (revision_id, grant_kind, ordinal)
);

CREATE TABLE IF NOT EXISTS ag_catalog.hermes_card_facets (
  revision_id UUID PRIMARY KEY REFERENCES ag_catalog.agent_card_revisions(revision_id) ON DELETE CASCADE,
  profile_name TEXT NOT NULL,
  profile_home_ref TEXT,
  instruction_text TEXT NOT NULL DEFAULT '',
  instruction_sha256 TEXT NOT NULL,
  snapshot_model TEXT,
  snapshot_gateway TEXT,
  details_present BOOLEAN NOT NULL DEFAULT FALSE,
  conflict_resolution TEXT CHECK (
    conflict_resolution IS NULL OR conflict_resolution IN ('hermes', 'card')
  )
);

CREATE TABLE IF NOT EXISTS ag_catalog.autogen_card_facets (
  revision_id UUID PRIMARY KEY REFERENCES ag_catalog.agent_card_revisions(revision_id) ON DELETE CASCADE,
  assistant_name TEXT NOT NULL,
  system_message TEXT NOT NULL DEFAULT '',
  system_message_sha256 TEXT NOT NULL,
  termination_mode TEXT,
  max_turns INTEGER CHECK (max_turns IS NULL OR max_turns > 0)
);

-- Prompt-free run status only. Assignment/delegation and parent/child identity
-- are AGE relationships, not relational columns.
CREATE TABLE IF NOT EXISTS ag_catalog.agent_runs (
  run_id TEXT PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES ag_catalog.projects(id) ON DELETE RESTRICT,
  deck_id TEXT NOT NULL,
  target_card_revision_id UUID NOT NULL
    REFERENCES ag_catalog.agent_card_revisions(revision_id) ON DELETE RESTRICT,
  runtime_type TEXT NOT NULL,
  provider TEXT,
  model_key TEXT,
  provider_model_id TEXT,
  access_mode TEXT,
  correlation_id TEXT NOT NULL UNIQUE,
  provider_thread_ref TEXT,
  provider_turn_ref TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  error_summary TEXT,
  provider_input_tokens BIGINT CHECK (provider_input_tokens IS NULL OR provider_input_tokens >= 0),
  provider_output_tokens BIGINT CHECK (provider_output_tokens IS NULL OR provider_output_tokens >= 0),
  total_cost_usd NUMERIC(18,8) CHECK (total_cost_usd IS NULL OR total_cost_usd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (project_id, deck_id)
    REFERENCES ag_catalog.agent_decks(project_id, deck_id) ON DELETE RESTRICT
);

-- Explicit durable deliverables only. Bodies remain in their canonical file,
-- object store, CoderReport, or knowledge graph.
CREATE TABLE IF NOT EXISTS ag_catalog.run_artifacts (
  artifact_id TEXT PRIMARY KEY,
  producing_run_id TEXT NOT NULL REFERENCES ag_catalog.agent_runs(run_id) ON DELETE RESTRICT,
  artifact_kind TEXT NOT NULL,
  locator TEXT NOT NULL,
  media_type TEXT,
  content_sha256 TEXT,
  provenance_ref TEXT,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The schema migration does not choose a Project or Deck. The explicit Python
-- cutover operation receives both existing identities and writes the
-- recoverable legacy snapshot in the same transaction as the relational
-- backfill. No Project row, code, type, route identity, or JSONB deck is
-- changed here.

-- Vocabulary only. Relationship instances are created by the explicit
-- one-time cutover or accepted React Flow edits through Python rails.
DO $$
DECLARE
  graph_oid OID;
  label_name TEXT;
BEGIN
  SELECT graphid INTO graph_oid FROM ag_catalog.ag_graph WHERE name = 'agentgraph';
  IF graph_oid IS NULL THEN RAISE EXCEPTION 'agentgraph_not_found'; END IF;

  FOREACH label_name IN ARRAY ARRAY['Card', 'Run', 'Artifact', 'NativeReference', 'Tool'] LOOP
    IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_label WHERE graph = graph_oid AND name = label_name) THEN
      PERFORM ag_catalog.create_vlabel('agentgraph'::cstring, label_name::cstring);
    END IF;
  END LOOP;
  FOREACH label_name IN ARRAY ARRAY[
    'FLOW', 'MAGENTIC_OPTION', 'MAGENTIC_CONTROL',
    'ASSIGNED_TO', 'DELEGATED_TO', 'CHILD_RUN', 'EXECUTED_BY',
    'VIEWED', 'USED', 'USED_TOOL', 'PRODUCED_ARTIFACT'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_label WHERE graph = graph_oid AND name = label_name) THEN
      PERFORM ag_catalog.create_elabel('agentgraph'::cstring, label_name::cstring);
    END IF;
  END LOOP;
END
$$;

-- The database previously carried a broad ag_catalog default-table grant.
-- Remove it for future tables, clear inherited privileges on this bounded
-- domain, then grant only operations proven by the Python owner.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ag_catalog
  REVOKE ALL ON TABLES FROM "liquidaity-user";
REVOKE ALL ON
  ag_catalog.deck_legacy_snapshots,
  ag_catalog.agent_decks,
  ag_catalog.deck_prompt_templates,
  ag_catalog.agent_cards,
  ag_catalog.agent_card_revisions,
  ag_catalog.deck_card_memberships,
  ag_catalog.card_capability_grants,
  ag_catalog.hermes_card_facets,
  ag_catalog.autogen_card_facets,
  ag_catalog.agent_runs,
  ag_catalog.run_artifacts
  FROM "liquidaity-user";

-- The explicit one-time Python cutover may capture a snapshot. No runtime
-- path may update or delete it afterward.
GRANT SELECT, INSERT ON ag_catalog.deck_legacy_snapshots TO "liquidaity-user";
GRANT SELECT, INSERT, UPDATE ON
  ag_catalog.agent_decks,
  ag_catalog.agent_cards,
  ag_catalog.deck_card_memberships,
  ag_catalog.agent_runs
  TO "liquidaity-user";
GRANT SELECT, INSERT ON
  ag_catalog.agent_card_revisions,
  ag_catalog.card_capability_grants,
  ag_catalog.hermes_card_facets,
  ag_catalog.autogen_card_facets,
  ag_catalog.run_artifacts
  TO "liquidaity-user";
GRANT SELECT, INSERT, DELETE ON ag_catalog.deck_prompt_templates TO "liquidaity-user";

GRANT USAGE ON SCHEMA agentgraph TO "liquidaity-user";
GRANT SELECT, INSERT, UPDATE ON agentgraph."Card" TO "liquidaity-user";
GRANT SELECT, INSERT, UPDATE, DELETE
  ON agentgraph."FLOW",
     agentgraph."MAGENTIC_OPTION",
     agentgraph."MAGENTIC_CONTROL"
  TO "liquidaity-user";
GRANT SELECT, INSERT, UPDATE
  ON agentgraph."Run",
     agentgraph."Artifact",
     agentgraph."NativeReference",
     agentgraph."Tool",
     agentgraph."ASSIGNED_TO",
     agentgraph."DELEGATED_TO",
     agentgraph."CHILD_RUN",
     agentgraph."EXECUTED_BY",
     agentgraph."VIEWED",
     agentgraph."USED",
     agentgraph."USED_TOOL",
     agentgraph."PRODUCED_ARTIFACT"
  TO "liquidaity-user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA agentgraph TO "liquidaity-user";

COMMIT;
