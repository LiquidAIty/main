-- Project-owned WorldView capability selection.
--
-- This is a bounded availability mask, not a provider catalog, tool grant,
-- agent assignment, or Run receipt.  Saved Card and Run authority continue to
-- narrow the effective set before the existing Jev batch.

BEGIN;

CREATE TABLE IF NOT EXISTS ag_catalog.project_worldview_capabilities (
  project_id UUID NOT NULL REFERENCES ag_catalog.projects(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL CHECK (
    capability_id ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  ),
  main_enabled BOOLEAN,
  main_reason TEXT CHECK (
    main_reason IS NULL OR char_length(main_reason) <= 1000
  ),
  user_enabled BOOLEAN,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, capability_id),
  CHECK (main_reason IS NULL OR main_enabled IS NOT NULL),
  CHECK (main_enabled IS NOT NULL OR user_enabled IS NOT NULL)
);

COMMIT;
