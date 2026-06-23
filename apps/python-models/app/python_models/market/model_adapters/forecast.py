"""Dispatcher over the typed forecast adapters. Importing this is light (the adapters
lazy-import their heavy runtimes)."""

from __future__ import annotations

from .chronos_adapter import forecast_chronos
from .forecast_contract import MODEL_CHRONOS, MODEL_KRONOS, BarWindow, ForecastResult, errored
from .kronos_adapter import forecast_kronos

ADAPTERS = {MODEL_CHRONOS: forecast_chronos, MODEL_KRONOS: forecast_kronos}
KNOWN_MODELS = tuple(ADAPTERS)


def run_forecast(model: str, window: BarWindow, horizon: int = 5) -> ForecastResult:
    """Run one named adapter over a recorded bar window. Unknown model → typed error."""
    fn = ADAPTERS.get(str(model))
    if fn is None:
        return errored(str(model), "unknown", window, horizon, f"unknown_model:{model}")
    return fn(window, horizon)
