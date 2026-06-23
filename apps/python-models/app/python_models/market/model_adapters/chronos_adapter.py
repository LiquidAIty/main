"""Chronos-Bolt adapter — univariate probabilistic close-price forecast.

Lazy-imports torch + chronos so the rails import cleanly without them; reports
``model_unavailable`` when the runtime is absent. Weights load from the local HF cache.
Capability only — produces a forecast band, never a signal or trade.
"""

from __future__ import annotations

from .forecast_contract import (
    MODEL_CHRONOS,
    STATUS_AVAILABLE,
    BarWindow,
    ForecastPoint,
    ForecastResult,
    errored,
    unavailable,
)

MODEL_REF = "amazon/chronos-bolt-small"


def forecast_chronos(window: BarWindow, horizon: int = 5) -> ForecastResult:
    horizon = max(1, int(horizon))
    closes = window.closes()
    if len(closes) < 8:
        return errored(MODEL_CHRONOS, MODEL_REF, window, horizon, "insufficient_history")
    try:
        import torch
        from chronos import BaseChronosPipeline
    except ImportError as exc:  # runtime not installed in this interpreter
        return unavailable(MODEL_CHRONOS, MODEL_REF, window, horizon,
                           f"runtime_not_installed:{getattr(exc, 'name', exc)}")
    try:
        pipe = BaseChronosPipeline.from_pretrained(MODEL_REF, device_map="cpu", torch_dtype=torch.float32)
        ctx = torch.tensor(closes, dtype=torch.float32)
        quantiles, _mean = pipe.predict_quantiles(
            ctx, prediction_length=horizon, quantile_levels=[0.1, 0.5, 0.9]
        )
        q = quantiles[0].tolist()  # [horizon, 3]
        points = [
            ForecastPoint(step=i + 1, median=round(q[i][1], 4), p10=round(q[i][0], 4), p90=round(q[i][2], 4))
            for i in range(horizon)
        ]
        return ForecastResult(model=MODEL_CHRONOS, modelRef=MODEL_REF, symbol=window.symbol,
                              timeframe=window.timeframe, horizon=horizon, status=STATUS_AVAILABLE, points=points)
    except Exception as exc:  # noqa: BLE001
        return errored(MODEL_CHRONOS, MODEL_REF, window, horizon, f"{type(exc).__name__}")
