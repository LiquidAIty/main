-- Bind each Hermes Run to its exact materialized execution authority, native
-- Hermes session, and selected provider transport without adding another
-- session, transcript, or Run owner.
BEGIN;

ALTER TABLE ag_catalog.agent_runs
  ADD COLUMN IF NOT EXISTS execution_authority_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS saved_openai_runtime TEXT,
  ADD COLUMN IF NOT EXISTS effective_provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_api_mode TEXT,
  ADD COLUMN IF NOT EXISTS hermes_session_ref TEXT;

ALTER TABLE ag_catalog.agent_runs
  ADD CONSTRAINT agent_runs_execution_authority_sha256_check
    CHECK (
      execution_authority_sha256 IS NULL
      OR execution_authority_sha256 ~ '^[a-f0-9]{64}$'
    ),
  ADD CONSTRAINT agent_runs_saved_openai_runtime_check
    CHECK (
      saved_openai_runtime IS NULL
      OR saved_openai_runtime = 'codex_app_server'
    );

-- Historical provider_thread_ref values are intentionally left untouched.
-- Identifier shape cannot prove whether a UUID belongs to Hermes SessionDB or
-- to a native Codex App Server thread, and provider_turn_ref may be valid native
-- evidence. New executions populate the separate columns from observed runtime
-- identities; ambiguous historical Runs remain readable without relabeling or
-- clearing user data.

REVOKE ALL ON ag_catalog.agent_runs FROM "liquidaity-user";
GRANT SELECT, INSERT, UPDATE ON ag_catalog.agent_runs TO "liquidaity-user";

COMMIT;
