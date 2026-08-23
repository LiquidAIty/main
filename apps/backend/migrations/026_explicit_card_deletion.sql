-- Permit only the exact relational and AGE deletes used by the guarded
-- Python-owned single-Card deletion transaction.

BEGIN;

GRANT DELETE ON
  ag_catalog.agent_cards,
  ag_catalog.agent_card_revisions,
  ag_catalog.deck_card_memberships
  TO "liquidaity-user";

GRANT DELETE ON agentgraph."Card" TO "liquidaity-user";

COMMIT;
