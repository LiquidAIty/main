"""One read-only Trading Card forecast tool backed by Alpaca data and Kronos.

The model receives only real, bounded historical bars from the existing Alpaca
paper-data boundary.  It returns predicted OHLCV bars with explicit model and
market-data provenance; it never creates a trade, signal, position, or order.
"""

from __future__ import annotations

import asyncio
import re
import sys
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any

from app.python_models.alpaca_market_data import (
    STATUS_AVAILABLE,
    AlpacaInstrumentRef,
    HistoricalBars,
    get_historical_bars,
)


KRONOS_MODEL_REF = "NeoQuasar/Kronos-small"
KRONOS_TOKENIZER_REF = "NeoQuasar/Kronos-Tokenizer-base"
_REPO_ROOT = Path(__file__).resolve().parents[4]
_KRONOS_ROOT = _REPO_ROOT / "agent-products" / "kronos"
_TIMEFRAME = re.compile(r"^(?P<count>[1-9][0-9]*)(?P<unit>Min|Hour|Day|Week|Month)$")
_PREDICTION_LOCK = Lock()


class TradingForecastError(ValueError):
    """Invalid forecast input or unavailable controlled Kronos source."""


def _future_timestamps(last_timestamp: str, timeframe: str, horizon: int) -> Any:
    import pandas as pd

    matched = _TIMEFRAME.fullmatch(str(timeframe or "").strip())
    if matched is None:
        raise TradingForecastError("trading_forecast_timeframe_unsupported")
    count = int(matched.group("count"))
    unit = matched.group("unit")
    last = pd.Timestamp(last_timestamp)
    if unit == "Min":
        offset = pd.Timedelta(minutes=count)
    elif unit == "Hour":
        offset = pd.Timedelta(hours=count)
    elif unit == "Day":
        offset = pd.offsets.BusinessDay(count)
    elif unit == "Week":
        offset = pd.offsets.Week(count)
    else:
        offset = pd.DateOffset(months=count)
    return pd.Series([last + offset * step for step in range(1, horizon + 1)])


@lru_cache(maxsize=1)
def _kronos_predictor() -> Any:
    if not _KRONOS_ROOT.is_dir():
        raise TradingForecastError("kronos_source_unavailable")
    source_root = str(_KRONOS_ROOT)
    if source_root not in sys.path:
        sys.path.insert(0, source_root)
    from model import Kronos, KronosPredictor, KronosTokenizer

    tokenizer = KronosTokenizer.from_pretrained(KRONOS_TOKENIZER_REF)
    model = Kronos.from_pretrained(KRONOS_MODEL_REF)
    return KronosPredictor(model, tokenizer, device="cpu", max_context=512)


def _market_data_provenance(bars: HistoricalBars) -> dict[str, Any]:
    return {
        "provider": bars.provider,
        "feed": bars.feed,
        "symbol": bars.symbol,
        "timeframe": bars.timeframe,
        "status": bars.status,
        "fetchedAt": bars.fetchedAt,
        "start": bars.start,
        "end": bars.end,
        "barCount": len(bars.bars),
        "firstObservedAt": bars.bars[0].timestamp if bars.bars else None,
        "lastObservedAt": bars.bars[-1].timestamp if bars.bars else None,
    }


def _forecast_market_bars(
    symbol: str,
    timeframe: str,
    *,
    start: str | None,
    end: str | None,
    history_limit: int,
    horizon: int,
) -> dict[str, Any]:
    canonical_symbol = str(symbol or "").strip().upper()
    canonical_timeframe = str(timeframe or "").strip()
    if not canonical_symbol:
        raise TradingForecastError("trading_forecast_symbol_required")
    if not isinstance(history_limit, int) or isinstance(history_limit, bool) or not 16 <= history_limit <= 400:
        raise TradingForecastError("trading_forecast_history_limit_out_of_range_16_400")
    if not isinstance(horizon, int) or isinstance(horizon, bool) or not 1 <= horizon <= 20:
        raise TradingForecastError("trading_forecast_horizon_out_of_range_1_20")
    matched = _TIMEFRAME.fullmatch(canonical_timeframe)
    if matched is None:
        raise TradingForecastError("trading_forecast_timeframe_unsupported")

    bars = get_historical_bars(
        AlpacaInstrumentRef(symbol=canonical_symbol),
        canonical_timeframe,
        start=start,
        end=end,
        limit=history_limit,
        feed="iex",
    )
    result: dict[str, Any] = {
        "schemaVersion": "trading.forecast.v1",
        "status": bars.status,
        "model": "kronos",
        "modelRef": KRONOS_MODEL_REF,
        "tokenizerRef": KRONOS_TOKENIZER_REF,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "marketData": _market_data_provenance(bars),
        "horizon": horizon,
        "points": [],
        "diagnostics": bars.diagnostics,
    }
    if bars.status != STATUS_AVAILABLE:
        return result
    if len(bars.bars) < 16:
        return {**result, "status": "insufficient_history", "diagnostics": "at_least_16_bars_required"}

    try:
        import pandas as pd

        frame = pd.DataFrame([
            {
                "open": bar.open,
                "high": bar.high,
                "low": bar.low,
                "close": bar.close,
                "volume": bar.volume,
                "amount": bar.close * bar.volume,
            }
            for bar in bars.bars
        ])
        observed = pd.Series(pd.to_datetime([bar.timestamp for bar in bars.bars], utc=True))
        future = _future_timestamps(bars.bars[-1].timestamp, canonical_timeframe, horizon)
        with _PREDICTION_LOCK:
            prediction = _kronos_predictor().predict(
                df=frame,
                x_timestamp=observed,
                y_timestamp=future,
                pred_len=horizon,
                T=1.0,
                top_p=0.9,
                sample_count=1,
                verbose=False,
            )
        points = [
            {
                "step": index + 1,
                "timestamp": future.iloc[index].isoformat(),
                "open": round(float(prediction["open"].iloc[index]), 6),
                "high": round(float(prediction["high"].iloc[index]), 6),
                "low": round(float(prediction["low"].iloc[index]), 6),
                "close": round(float(prediction["close"].iloc[index]), 6),
                "volume": round(float(prediction["volume"].iloc[index]), 3),
            }
            for index in range(horizon)
        ]
        return {**result, "status": "available", "points": points, "diagnostics": None}
    except (ImportError, ModuleNotFoundError, OSError) as error:
        return {
            **result,
            "status": "model_unavailable",
            "diagnostics": f"kronos_model_unavailable:{type(error).__name__}",
        }
    except Exception as error:  # noqa: BLE001 - return a bounded typed model failure
        return {
            **result,
            "status": "model_error",
            "diagnostics": f"kronos_model_error:{type(error).__name__}",
        }


async def forecast_market_bars(
    symbol: str,
    timeframe: str,
    start: str | None = None,
    end: str | None = None,
    history_limit: int = 128,
    horizon: int = 5,
) -> dict[str, Any]:
    """Fetch one real Alpaca window and forecast its next Kronos OHLCV bars."""

    return await asyncio.to_thread(
        _forecast_market_bars,
        symbol,
        timeframe,
        start=start,
        end=end,
        history_limit=history_limit,
        horizon=horizon,
    )
