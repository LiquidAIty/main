"""Kronos adapter — candle-native OHLCV forecast.

Loads the vendored Kronos repo code (top-level ``Kronos-main/``) + the cached HF weights.
Lazy-imports its runtime (torch via the repo's model module) so the rails import cleanly
without it; reports ``model_unavailable`` when the repo or runtime is absent. Capability
only — produces predicted candles, never a signal or trade.
"""

from __future__ import annotations

import sys
from pathlib import Path

from .forecast_contract import (
    MODEL_KRONOS,
    STATUS_AVAILABLE,
    BarWindow,
    ForecastPoint,
    ForecastResult,
    errored,
    unavailable,
)

MODEL_REF = "NeoQuasar/Kronos-small+Kronos-Tokenizer-base"
_TOKENIZER_REF = "NeoQuasar/Kronos-Tokenizer-base"
_MODEL_REF = "NeoQuasar/Kronos-small"


def _ensure_kronos_repo_on_path() -> bool:
    # Kronos-main is a top-level vendored repo at the repository root.
    repo = Path(__file__).resolve().parents[6] / "Kronos-main"
    if not repo.exists():
        return False
    path = str(repo)
    if path not in sys.path:
        sys.path.insert(0, path)
    return True


def forecast_kronos(window: BarWindow, horizon: int = 5) -> ForecastResult:
    horizon = max(1, int(horizon))
    if len(window.bars) < 16:
        return errored(MODEL_KRONOS, MODEL_REF, window, horizon, "insufficient_history")
    if not _ensure_kronos_repo_on_path():
        return unavailable(MODEL_KRONOS, MODEL_REF, window, horizon, "kronos_repo_absent:Kronos-main")
    try:
        import pandas as pd
        from model import Kronos, KronosPredictor, KronosTokenizer  # from Kronos-main/model
    except ImportError as exc:
        return unavailable(MODEL_KRONOS, MODEL_REF, window, horizon,
                           f"runtime_not_installed:{getattr(exc, 'name', exc)}")
    try:
        rows = [
            {"timestamps": b.timestamp, "open": b.open, "high": b.high, "low": b.low,
             "close": b.close, "volume": b.volume, "amount": b.close * b.volume}
            for b in window.bars
        ]
        df = pd.DataFrame(rows)
        df["timestamps"] = pd.to_datetime(df["timestamps"])
        tokenizer = KronosTokenizer.from_pretrained(_TOKENIZER_REF)
        model = Kronos.from_pretrained(_MODEL_REF)
        predictor = KronosPredictor(model, tokenizer, device="cpu", max_context=512)
        lookback = min(400, len(df) - 1)
        x_df = df.iloc[-lookback:][["open", "high", "low", "close", "volume", "amount"]].reset_index(drop=True)
        x_ts = df.iloc[-lookback:]["timestamps"].reset_index(drop=True)
        last = df["timestamps"].iloc[-1]
        y_ts = pd.Series(pd.bdate_range(last + pd.Timedelta(days=1), periods=horizon))
        pred = predictor.predict(
            df=x_df, x_timestamp=x_ts, y_timestamp=y_ts, pred_len=horizon,
            T=1.0, top_p=0.9, sample_count=1, verbose=False,
        )
        points = [
            ForecastPoint(
                step=i + 1,
                open=round(float(pred["open"].iloc[i]), 4),
                high=round(float(pred["high"].iloc[i]), 4),
                low=round(float(pred["low"].iloc[i]), 4),
                close=round(float(pred["close"].iloc[i]), 4),
                volume=round(float(pred["volume"].iloc[i]), 2),
            )
            for i in range(horizon)
        ]
        return ForecastResult(model=MODEL_KRONOS, modelRef=MODEL_REF, symbol=window.symbol,
                              timeframe=window.timeframe, horizon=horizon, status=STATUS_AVAILABLE, points=points)
    except Exception as exc:  # noqa: BLE001
        return errored(MODEL_KRONOS, MODEL_REF, window, horizon, f"{type(exc).__name__}:{str(exc)[:80]}")
