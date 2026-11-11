-- Append-only candidate work products and intentional journals in Trading's existing owner.
-- No broker ledger, scheduler, chat copy, or changes to existing decisions.
BEGIN;

CREATE TABLE ag_catalog.trading_proposals (
  proposal_id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  card_revision_id UUID NOT NULL,
  source_execution JSONB NOT NULL CHECK (jsonb_typeof(source_execution) = 'object'),
  idempotency_key TEXT NOT NULL,
  original_proposal_id UUID REFERENCES ag_catalog.trading_proposals(proposal_id) ON DELETE RESTRICT,
  inversion_type TEXT NOT NULL CHECK (inversion_type IN ('original','exact_counterparty','opposing_direction')),
  proposal JSONB NOT NULL CHECK (jsonb_typeof(proposal) = 'object'),
  economics JSONB NOT NULL CHECK (jsonb_typeof(economics) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, deck_id, card_id, idempotency_key),
  CHECK ((inversion_type = 'original') = (original_proposal_id IS NULL))
);
CREATE INDEX trading_proposal_pair ON ag_catalog.trading_proposals(project_id, deck_id, original_proposal_id);

CREATE TABLE ag_catalog.trading_assessments (
  assessment_id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  card_revision_id UUID NOT NULL,
  source_execution JSONB NOT NULL CHECK (jsonb_typeof(source_execution) = 'object'),
  idempotency_key TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opportunity','research','contrarian','quant_initial','quant_comparison','shadow_outcome')),
  proposal_ids UUID[] NOT NULL,
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, deck_id, card_id, idempotency_key)
);
CREATE INDEX trading_assessment_candidate ON ag_catalog.trading_assessments(project_id, deck_id, candidate_id, created_at);

CREATE TABLE ag_catalog.trading_journal_entries (
  entry_id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  card_revision_id UUID NOT NULL,
  source_execution JSONB NOT NULL CHECK (jsonb_typeof(source_execution) = 'object'),
  idempotency_key TEXT NOT NULL,
  decision_id UUID NOT NULL REFERENCES ag_catalog.trading_decisions(decision_id) ON DELETE RESTRICT,
  phase TEXT NOT NULL CHECK (phase IN ('BEFORE','DURING','AFTER','REVIEW','CORRECTION')),
  markdown TEXT NOT NULL CHECK (length(btrim(markdown)) > 0),
  proposal_ids UUID[] NOT NULL,
  assessment_ids UUID[] NOT NULL,
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'array'),
  review JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, deck_id, card_id, idempotency_key),
  CHECK ((phase = 'REVIEW') = (review IS NOT NULL))
);
CREATE UNIQUE INDEX trading_journal_original_before ON ag_catalog.trading_journal_entries(decision_id) WHERE phase='BEFORE';
CREATE INDEX trading_journal_decision ON ag_catalog.trading_journal_entries(project_id, deck_id, decision_id, created_at);

REVOKE ALL ON ag_catalog.trading_proposals, ag_catalog.trading_assessments, ag_catalog.trading_journal_entries FROM "liquidaity-user";
GRANT SELECT, INSERT ON ag_catalog.trading_proposals, ag_catalog.trading_assessments, ag_catalog.trading_journal_entries TO "liquidaity-user";
COMMIT;
