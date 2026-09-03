-- Durable paper Trade Jobs and typed decision evidence beneath saved Cards.
-- This schema intentionally has no broker order table or live-execution flag.
BEGIN;

CREATE TABLE IF NOT EXISTS ag_catalog.trading_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  -- The least-privilege application migrator cannot acquire REFERENCES on the
  -- protected Card tables. Python validates this immutable identity before
  -- every write, and explicit Card deletion performs the inverse reference audit.
  card_revision_id UUID NOT NULL,
  source_run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  plan JSONB NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  state TEXT NOT NULL CHECK (state IN ('monitoring', 'paused', 'completed', 'fail_safe')),
  current_action TEXT NOT NULL CHECK (
    current_action IN ('WAIT', 'ENTER', 'HOLD', 'REDUCE', 'EXIT', 'PAUSE', 'FAIL_SAFE')
  ),
  execution_state TEXT NOT NULL CHECK (
    execution_state = 'blocked_pending_separate_approval'
  ),
  budget_ceiling_usd NUMERIC(20,4) NOT NULL CHECK (budget_ceiling_usd > 0),
  max_loss_usd NUMERIC(20,4) NOT NULL CHECK (
    max_loss_usd > 0 AND max_loss_usd <= budget_ceiling_usd
  ),
  realized_pnl_usd NUMERIC(20,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, deck_id, card_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS trading_jobs_card_state_idx
  ON ag_catalog.trading_jobs(project_id, deck_id, card_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS ag_catalog.trading_decisions (
  decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES ag_catalog.trading_jobs(job_id) ON DELETE RESTRICT,
  source_run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN ('WAIT', 'ENTER', 'HOLD', 'REDUCE', 'EXIT', 'PAUSE', 'FAIL_SAFE')
  ),
  rationale TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  missing_terms JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(missing_terms) = 'array'),
  execution_requested BOOLEAN NOT NULL DEFAULT FALSE CHECK (execution_requested = FALSE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS ag_catalog.trading_interventions (
  intervention_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES ag_catalog.trading_jobs(job_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('PAUSE', 'EXIT', 'FAIL_SAFE')),
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON ag_catalog.trading_jobs FROM "liquidaity-user";
REVOKE ALL ON ag_catalog.trading_decisions FROM "liquidaity-user";
REVOKE ALL ON ag_catalog.trading_interventions FROM "liquidaity-user";
GRANT SELECT, INSERT, UPDATE ON ag_catalog.trading_jobs TO "liquidaity-user";
GRANT SELECT, INSERT ON ag_catalog.trading_decisions TO "liquidaity-user";
GRANT SELECT, INSERT ON ag_catalog.trading_interventions TO "liquidaity-user";

COMMIT;
