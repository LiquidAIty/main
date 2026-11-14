-- Optional shared work records in the existing application database.
-- No runtime jobs, sessions, agent dispatch, broker authorization, or journal state.
BEGIN;

CREATE TABLE ag_catalog.agent_records (
  record_id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  card_revision_id UUID NOT NULL,
  record_kind TEXT NOT NULL CHECK (length(record_kind) BETWEEN 1 AND 80),
  content TEXT NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 32000),
  details JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details)='object'),
  source_references JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(source_references)='array'),
  source_execution JSONB CHECK (source_execution IS NULL OR jsonb_typeof(source_execution)='object'),
  event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 160),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256)=64),
  UNIQUE(project_id, deck_id, record_id),
  UNIQUE(project_id, deck_id, card_id, idempotency_key),
  FOREIGN KEY (project_id, deck_id, card_id)
    REFERENCES ag_catalog.agent_cards(project_id, deck_id, card_id) ON DELETE RESTRICT,
  FOREIGN KEY (card_revision_id) REFERENCES ag_catalog.agent_card_revisions(revision_id) ON DELETE RESTRICT
);
CREATE INDEX agent_record_scope_time ON ag_catalog.agent_records(project_id, deck_id, created_at DESC, record_id);
CREATE INDEX agent_record_text ON ag_catalog.agent_records USING GIN (to_tsvector('simple',content));

CREATE TABLE ag_catalog.agent_record_links (
  link_id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  card_revision_id UUID NOT NULL,
  source_id UUID NOT NULL,
  target_id UUID NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('SUPPORTS','CHALLENGES','EVALUATES','SUPERSEDES','EXECUTED_AS','REFERENCES')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_id<>target_id),
  UNIQUE(project_id, deck_id, card_id, source_id, target_id, relation),
  FOREIGN KEY (project_id, deck_id, source_id) REFERENCES ag_catalog.agent_records(project_id, deck_id, record_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, deck_id, target_id) REFERENCES ag_catalog.agent_records(project_id, deck_id, record_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, deck_id, card_id) REFERENCES ag_catalog.agent_cards(project_id, deck_id, card_id) ON DELETE RESTRICT,
  FOREIGN KEY (card_revision_id) REFERENCES ag_catalog.agent_card_revisions(revision_id) ON DELETE RESTRICT
);
CREATE INDEX agent_record_link_target ON ag_catalog.agent_record_links(project_id, deck_id, target_id);

CREATE FUNCTION ag_catalog.reject_agent_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'agent_records_are_append_only';
END;
$$;
CREATE TRIGGER agent_records_immutable BEFORE UPDATE OR DELETE ON ag_catalog.agent_records
  FOR EACH ROW EXECUTE FUNCTION ag_catalog.reject_agent_record_mutation();
CREATE TRIGGER agent_record_links_immutable BEFORE UPDATE OR DELETE ON ag_catalog.agent_record_links
  FOR EACH ROW EXECUTE FUNCTION ag_catalog.reject_agent_record_mutation();
REVOKE ALL ON ag_catalog.agent_records, ag_catalog.agent_record_links FROM "liquidaity-user";
GRANT SELECT, INSERT ON ag_catalog.agent_records, ag_catalog.agent_record_links TO "liquidaity-user";
COMMIT;
