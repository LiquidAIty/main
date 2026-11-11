-- Immutable model outputs, separate from graph evidence and broker execution.
BEGIN;
CREATE TABLE IF NOT EXISTS ag_catalog.trading_forecasts (
  forecast_id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  card_revision_id UUID NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (project_id, deck_id, card_id)
    REFERENCES ag_catalog.agent_cards(project_id, deck_id, card_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS trading_forecasts_card_created_idx
  ON ag_catalog.trading_forecasts(project_id, deck_id, card_id, created_at DESC);
REVOKE ALL ON ag_catalog.trading_forecasts FROM "liquidaity-user";
GRANT SELECT, INSERT ON ag_catalog.trading_forecasts TO "liquidaity-user";
COMMIT;
