-- Permit evidence-linked reviews before a Trader decision exists.
-- Existing decisions, journals, profiles and historical records are unchanged.
BEGIN;

ALTER TABLE ag_catalog.trading_journal_entries
  ALTER COLUMN decision_id DROP NOT NULL;

ALTER TABLE ag_catalog.trading_journal_entries
  ADD CONSTRAINT trading_journal_review_subject_required CHECK (
    decision_id IS NOT NULL OR (
      phase = 'REVIEW' AND (
        cardinality(proposal_ids) > 0 OR jsonb_path_exists(evidence, '$[*].jobId')
      )
    )
  );

COMMIT;
