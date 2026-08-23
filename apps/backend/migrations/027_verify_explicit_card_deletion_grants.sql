-- Reassert and verify the exact grants required by the guarded single-Card
-- deletion owner. The verification keeps backend readiness fail-closed.

BEGIN;

GRANT DELETE ON
  ag_catalog.agent_cards,
  ag_catalog.agent_card_revisions,
  ag_catalog.deck_card_memberships
  TO "liquidaity-user";

GRANT DELETE ON agentgraph."Card" TO "liquidaity-user";

DO $verify$
BEGIN
  IF NOT has_table_privilege('liquidaity-user', 'ag_catalog.agent_cards', 'DELETE') THEN
    RAISE EXCEPTION 'explicit_card_deletion_grant_missing:agent_cards';
  END IF;
  IF NOT has_table_privilege('liquidaity-user', 'ag_catalog.agent_card_revisions', 'DELETE') THEN
    RAISE EXCEPTION 'explicit_card_deletion_grant_missing:agent_card_revisions';
  END IF;
  IF NOT has_table_privilege('liquidaity-user', 'ag_catalog.deck_card_memberships', 'DELETE') THEN
    RAISE EXCEPTION 'explicit_card_deletion_grant_missing:deck_card_memberships';
  END IF;
  IF NOT has_table_privilege('liquidaity-user', 'agentgraph."Card"', 'DELETE') THEN
    RAISE EXCEPTION 'explicit_card_deletion_grant_missing:agentgraph_card';
  END IF;
END
$verify$;

COMMIT;
