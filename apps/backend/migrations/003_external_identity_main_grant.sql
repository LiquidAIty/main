-- One verified external OAuth identity may enter one explicitly granted project.
-- Auth0 owns tokens; LiquidAIty stores only the durable issuer/subject grant.

BEGIN;

CREATE TABLE IF NOT EXISTS ag_catalog.external_identity_main_grant (
  grant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES ag_catalog.projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (issuer, subject)
);

COMMENT ON TABLE ag_catalog.external_identity_main_grant IS
  'Verified OAuth issuer/subject to one existing LiquidAIty user and owned project. No OAuth tokens are stored.';

COMMIT;
