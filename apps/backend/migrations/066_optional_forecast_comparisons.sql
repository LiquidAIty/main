-- Optional observations do not rewrite the original model forecast.
BEGIN;
CREATE TABLE IF NOT EXISTS ag_catalog.trading_forecast_comparisons (
  comparison_id UUID PRIMARY KEY,
  forecast_id UUID NOT NULL REFERENCES ag_catalog.trading_forecasts(forecast_id),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trading_forecast_comparisons_forecast_created_idx
  ON ag_catalog.trading_forecast_comparisons(forecast_id, created_at DESC);
REVOKE ALL ON ag_catalog.trading_forecast_comparisons FROM "liquidaity-user";
GRANT SELECT, INSERT ON ag_catalog.trading_forecast_comparisons TO "liquidaity-user";
COMMIT;
