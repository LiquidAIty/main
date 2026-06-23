"""Forecast model adapters behind one typed contract.

Each adapter consumes the same {@link forecast_contract.BarWindow} (a normalized
recorded Alpaca OHLCV window) and returns a {@link forecast_contract.ForecastResult}.
Adapters lazy-import their heavy runtime (torch + the model libs) so the rails import
cleanly even when those libs aren't installed — they then report `model_unavailable`
rather than crashing. Capability only: no trades, no signals, no recommendations.
"""
