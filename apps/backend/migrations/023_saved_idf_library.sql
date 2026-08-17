-- Explicitly saved, repeatable IDF communications.
--
-- Ordinary invocations remain transient. This schema stores only an exact IDF
-- body when a user explicitly chooses Save IDF / Save & Run. Provider
-- envelopes, selected context bundles, model output, and transcripts are not
-- stored here.

BEGIN;

CREATE TABLE IF NOT EXISTS ag_catalog.saved_idfs (
  idf_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  target_card_id TEXT NOT NULL,
  head_revision INTEGER NOT NULL CHECK (head_revision > 0),
  state TEXT NOT NULL DEFAULT 'saved' CHECK (state IN ('saved', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (idf_id, project_id, deck_id, target_card_id),
  FOREIGN KEY (project_id, deck_id, target_card_id)
    REFERENCES ag_catalog.agent_cards(project_id, deck_id, card_id) ON DELETE RESTRICT
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_card_revisions_identity_tuple_key'
      AND conrelid = 'ag_catalog.agent_card_revisions'::regclass
  ) THEN
    ALTER TABLE ag_catalog.agent_card_revisions
      ADD CONSTRAINT agent_card_revisions_identity_tuple_key
      UNIQUE (revision_id, project_id, deck_id, card_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS ag_catalog.saved_idf_revisions (
  idf_id UUID NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  target_card_id TEXT NOT NULL,
  target_card_revision_id UUID NOT NULL,
  idd_version INTEGER NOT NULL CHECK (idd_version > 0),
  idd_sha256 TEXT NOT NULL CHECK (idd_sha256 ~ '^[0-9a-f]{64}$'),
  content_markdown TEXT NOT NULL CHECK (
    octet_length(content_markdown) > 0
    AND octet_length(content_markdown) <= 1048576
  ),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  provenance_kind TEXT NOT NULL CHECK (
    provenance_kind IN ('inspector', 'main', 'agent', 'import')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (idf_id, revision),
  UNIQUE (
    idf_id, revision, project_id, deck_id, target_card_revision_id
  ),
  FOREIGN KEY (idf_id, project_id, deck_id, target_card_id)
    REFERENCES ag_catalog.saved_idfs(idf_id, project_id, deck_id, target_card_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (target_card_revision_id, project_id, deck_id, target_card_id)
    REFERENCES ag_catalog.agent_card_revisions(revision_id, project_id, deck_id, card_id)
    ON DELETE RESTRICT
);

ALTER TABLE ag_catalog.agent_runs
  ADD COLUMN IF NOT EXISTS saved_idf_id UUID,
  ADD COLUMN IF NOT EXISTS saved_idf_revision INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_saved_idf_pair_check'
      AND conrelid = 'ag_catalog.agent_runs'::regclass
  ) THEN
    ALTER TABLE ag_catalog.agent_runs
      ADD CONSTRAINT agent_runs_saved_idf_pair_check CHECK (
        (saved_idf_id IS NULL AND saved_idf_revision IS NULL)
        OR (saved_idf_id IS NOT NULL AND saved_idf_revision IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_saved_idf_revision_fkey'
      AND conrelid = 'ag_catalog.agent_runs'::regclass
  ) THEN
    ALTER TABLE ag_catalog.agent_runs
      ADD CONSTRAINT agent_runs_saved_idf_revision_fkey
      FOREIGN KEY (
        saved_idf_id, saved_idf_revision, project_id, deck_id,
        target_card_revision_id
      ) REFERENCES ag_catalog.saved_idf_revisions (
        idf_id, revision, project_id, deck_id, target_card_revision_id
      ) ON DELETE RESTRICT;
  END IF;
END
$$;

REVOKE ALL ON
  ag_catalog.saved_idfs,
  ag_catalog.saved_idf_revisions
  FROM "liquidaity-user";
GRANT SELECT, INSERT, UPDATE ON ag_catalog.saved_idfs TO "liquidaity-user";
GRANT SELECT, INSERT ON ag_catalog.saved_idf_revisions TO "liquidaity-user";

-- Transitional assignment/IDF stores are historical read-only data. Their
-- former application-role ownership or broad grants must not leave a second
-- writable prompt-delivery authority beside the explicit saved-IDF library.
DO $$
DECLARE
  legacy_table TEXT;
BEGIN
  FOREACH legacy_table IN ARRAY ARRAY[
    'input_data_files',
    'agent_assignments',
    'agent_context_references',
    'agent_results'
  ] LOOP
    IF to_regclass('ag_catalog.' || legacy_table) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE ag_catalog.%I OWNER TO postgres', legacy_table);
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ag_catalog.%I FROM "liquidaity-user"',
        legacy_table
      );
      EXECUTE format('GRANT SELECT ON ag_catalog.%I TO "liquidaity-user"', legacy_table);
    END IF;
  END LOOP;
END
$$;

COMMIT;
