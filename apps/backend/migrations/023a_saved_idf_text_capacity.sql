-- Saved IDFs are explicit user-authored text documents. PostgreSQL TEXT/TOAST
-- owns their physical representation; an arbitrary application-size ceiling
-- would reject valid large literal-query or bounded inline-data cases. Default
-- transient execution remains the primary database-growth control.

BEGIN;

ALTER TABLE ag_catalog.saved_idf_revisions
  DROP CONSTRAINT IF EXISTS saved_idf_revisions_content_markdown_check;

ALTER TABLE ag_catalog.saved_idf_revisions
  ADD CONSTRAINT saved_idf_revisions_content_markdown_check
  CHECK (octet_length(content_markdown) > 0);

COMMIT;
