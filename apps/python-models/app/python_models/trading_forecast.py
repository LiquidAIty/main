"""Kronos forecasts: model output, never broker orders or sourced Knows."""
# Entity: Trading
# Relationship: Fetches completed Alpaca history and returns pinned Kronos samples plus optional same-input GARCH comparison, reporting retention separately so storage failure does not discard completed calculations.

from __future__ import annotations

import asyncio
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
from threading import Lock
from time import perf_counter
from typing import Any
from uuid import uuid4

from app.application_tool_error import ApplicationToolError
from app.python_models.alpaca_market_data import (
    STATUS_AVAILABLE, AlpacaInstrumentRef, HistoricalBars, get_historical_bars,
)

KRONOS_MODEL_REF = "NeoQuasar/Kronos-mini"
KRONOS_TOKENIZER_REF = "NeoQuasar/Kronos-Tokenizer-2k"
KRONOS_SOURCE_REVISION = "67b630e67f6a18c9e9be918d9b4337c960db1e9a+relative-import"
_MODELS = {
    "mini": (KRONOS_MODEL_REF, "f4e68697d9d5aed55cef5c96aabc3376bcad9f81", KRONOS_TOKENIZER_REF, "26966d0035065a0cae0ebad7af8ece35bc1fb51c", 2048),
    "small": ("NeoQuasar/Kronos-small", "901c26c1332695a2a8f243eb2f37243a37bea320", "NeoQuasar/Kronos-Tokenizer-base", "0e0117387f39004a9016484a186a908917e22426", 512),
    "base": ("NeoQuasar/Kronos-base", "2b554741eca47781b64468546e77fef3e85130e6", "NeoQuasar/Kronos-Tokenizer-base", "0e0117387f39004a9016484a186a908917e22426", 512),
}
_KRONOS_ROOT = Path(__file__).resolve().parents[4] / "agent-products" / "kronos"
_KRONOS_PACKAGE_NAME = "_liquidaity_kronos_model"
_PREDICTION_LOCK = Lock()
_INTERVALS = {"1Min": 1, "5Min": 5, "15Min": 15, "1Hour": 60, "1Day": 0}


class TradingForecastError(ValueError):
    """Invalid request or unavailable forecast boundary."""


@lru_cache(maxsize=1)
def _kronos_module() -> Any:
    package_root = _KRONOS_ROOT / "model"
    spec = importlib.util.spec_from_file_location(
        _KRONOS_PACKAGE_NAME, package_root / "__init__.py",
        submodule_search_locations=[str(package_root)],
    )
    if spec is None or spec.loader is None:
        raise TradingForecastError("kronos_source_unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[_KRONOS_PACKAGE_NAME] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        for name in list(sys.modules):
            if name == _KRONOS_PACKAGE_NAME or name.startswith(f"{_KRONOS_PACKAGE_NAME}."):
                sys.modules.pop(name, None)
        raise
    return module


@lru_cache(maxsize=1)
def _kronos_predictor(model_variant: str = "mini") -> Any:
    module = _kronos_module()
    model_ref, revision, tokenizer_ref, tokenizer_revision, context = _MODELS[model_variant]
    tokenizer = module.KronosTokenizer.from_pretrained(tokenizer_ref, revision=tokenizer_revision)
    model = module.Kronos.from_pretrained(model_ref, revision=revision)
    tokenizer.eval()
    model.eval()
    return module.KronosPredictor(model, tokenizer, device="cpu", max_context=context)


def _timestamp(value: str) -> Any:
    import pandas as pd
    try:
        stamp = pd.Timestamp(value)
        if stamp.tzinfo is None or pd.isna(stamp):
            raise ValueError()
        return stamp.tz_convert("UTC")
    except (ValueError, TypeError):
        raise TradingForecastError("trading_forecast_timestamp_invalid") from None


def _bar_windows(start: Any, end: Any, timeframe: str) -> list[tuple[Any, Any]]:
    """Provider bar-start labels and exchange closes, including early closes/DST."""
    import pandas as pd
    import pandas_market_calendars as calendars
    if timeframe not in _INTERVALS:
        raise TradingForecastError("trading_forecast_timeframe_unsupported")
    schedule = calendars.get_calendar("NYSE").schedule(
        start_date=start.tz_convert("America/New_York").date(),
        end_date=end.tz_convert("America/New_York").date(),
    )
    windows = []
    for day, row in schedule.iterrows():
        if timeframe == "1Day":
            label = pd.Timestamp(day.date()).tz_localize("America/New_York").tz_convert("UTC")
            # Alpaca daily aggregates include extended trading. At a historical
            # 16:00 cutoff the final daily bar can contain later prints: exclude it.
            windows.append((label, label.tz_convert("America/New_York") + pd.Timedelta(hours=20)))
        else:
            step = pd.Timedelta(minutes=_INTERVALS[timeframe])
            label = row.market_open.floor(f"{_INTERVALS[timeframe]}min")
            while label < row.market_close:
                windows.append((label, min(label + step, row.market_close)))
                label += step
    return windows


def _future_timestamps(last_timestamp: str, timeframe: str, horizon: int) -> Any:
    import pandas as pd
    last = _timestamp(last_timestamp)
    future = [label for label, _ in _bar_windows(last, last + pd.Timedelta(days=60), timeframe) if label > last]
    if len(future) < horizon:
        raise TradingForecastError("trading_forecast_calendar_unavailable")
    return pd.Series(future[:horizon])


def _valid_bar(bar: dict[str, Any]) -> bool:
    values = [bar.get(k) for k in ("open", "high", "low", "close", "volume")]
    if any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) for v in values):
        return False
    o, h, l, c, v = values
    return 0 < l <= min(o, c) <= max(o, c) <= h and v >= 0


def _prepare_history(bars: HistoricalBars, cutoff: Any, history_limit: int, *, require_full_window: bool = True) -> tuple[list[dict[str, Any]], list[str]]:
    if bars.diagnostics:
        raise TradingForecastError("trading_forecast_history_incomplete")
    rows = [asdict(bar) for bar in bars.bars]
    if any(not _valid_bar(row) for row in rows):
        raise TradingForecastError("trading_forecast_invalid_observed_bar")
    rows.sort(key=lambda row: _timestamp(row["timestamp"]))
    stamps = [_timestamp(row["timestamp"]) for row in rows]
    if len(set(stamps)) != len(stamps):
        raise TradingForecastError("trading_forecast_duplicate_observed_timestamp")
    windows = dict(_bar_windows(stamps[0] if stamps else cutoff, cutoff, bars.timeframe))
    completed = [{**row, "availableAfter": windows[stamp].isoformat()} for row, stamp in zip(rows, stamps) if stamp in windows and windows[stamp] <= cutoff]
    warnings = ["Alpaca raw IEX bars; not consolidated SIP. Provider aggregates may include extended-hours prints.",
                "Historical archives fetched today may contain later corrections; cutoff filtering is not proof of an as-known-at-the-time data vintage.",
                "Model output is not a calibrated probability or an order. Amount is estimated from OHLC mean × volume."]
    if len(completed) != len(rows):
        warnings.append("Incomplete or out-of-session bar labels excluded before inference.")
    if len(completed) < (history_limit if require_full_window else 16):
        raise TradingForecastError(f"trading_forecast_insufficient_history:{len(completed)}/{history_limit}")
    return completed[-history_limit:], warnings


def read_forecast_history(project_id: str, deck_id: str, card_id: str, symbol: str, timeframe: str) -> dict[str, Any]:
    from app.python_models.trading_forecast_store import require_forecast_card
    require_forecast_card(project_id, deck_id, card_id)
    if timeframe not in _INTERVALS:
        raise TradingForecastError("trading_forecast_timeframe_unsupported")
    cutoff = _timestamp(datetime.now(timezone.utc).isoformat())
    bars = get_historical_bars(AlpacaInstrumentRef(symbol=symbol), timeframe,
                              start=(cutoff - timedelta(days=1214)).isoformat(), end=cutoff.isoformat(),
                              limit=1000, feed="iex", sort="desc")
    if bars.status != STATUS_AVAILABLE:
        return {"status": bars.status, "history": [], "diagnostics": bars.diagnostics}
    history, warnings = _prepare_history(bars, cutoff, 400, require_full_window=False)
    return {"status": "available", "history": history, "warnings": warnings, "symbol": bars.symbol,
            "timeframe": bars.timeframe, "fetchedAt": bars.fetchedAt, "feed": bars.feed}


def _serialize_prediction(prediction: Any, future: Any) -> list[dict[str, Any]]:
    points = []
    for index, timestamp in enumerate(future):
        point = {key: float(prediction[key].iloc[index]) for key in ("open", "high", "low", "close", "volume", "amount")}
        point["valid"] = _valid_bar(point)
        # JSON cannot represent NaN/Infinity. Retain invalidity, never clamp prices.
        point.update({key: None for key, value in point.items() if isinstance(value, float) and not math.isfinite(value)})
        points.append({"step": index + 1, "timestamp": timestamp.isoformat(), **point})
    return points


def _summarize_paths(paths: list[dict[str, Any]], last_close: float) -> dict[str, Any]:
    import numpy as np
    valid = [path for path in paths if path["valid"]]
    steps = []
    if valid:
        for index, point in enumerate(valid[0]["points"]):
            closes = [path["points"][index]["close"] for path in valid]
            p10, median, p90 = np.quantile(closes, [.1, .5, .9], method="linear")
            steps.append({"timestamp": point["timestamp"], "min": min(closes), "max": max(closes),
                          "p10": float(p10), "median": float(median), "p90": float(p90)})
    terminals = [path["points"][-1]["close"] for path in valid]
    return {"basis": "fully_valid_sample_paths", "sampleCount": len(paths), "validPathCount": len(valid),
            "invalidPathCount": len(paths) - len(valid), "lastObservedClose": last_close,
            "terminalAbove": sum(value > last_close for value in terminals),
            "terminalBelow": sum(value < last_close for value in terminals),
            "terminalUnchanged": sum(value == last_close for value in terminals), "steps": steps}


def _predict_history(history: list[dict[str, Any]], future: Any, model_variant: str, sample_count: int, seed: int,
                     *, temperature: float = 1.0, top_p: float = 0.9, top_k: int = 0) -> dict[str, Any]:
    import numpy as np
    import pandas as pd
    import torch
    frame = pd.DataFrame(history)
    observed = pd.Series(pd.to_datetime(frame.pop("timestamp"), utc=True))
    with _PREDICTION_LOCK, torch.random.fork_rng(devices=[]):
        # Loading weights initializes modules and consumes RNG. Seed only after
        # loading so a cold model and a cached model produce the same draws.
        predictor = _kronos_predictor(model_variant)
        torch.manual_seed(seed)
        # The public batch API preserves one output per input series. Repeating
        # this exact history with ONE sample per series retains actual draws
        # without changing upstream's internal sample-averaging implementation.
        predictions = predictor.predict_batch(
            df_list=[frame] * sample_count, x_timestamp_list=[observed] * sample_count,
            y_timestamp_list=[future] * sample_count, pred_len=len(future),
            T=temperature, top_p=top_p, top_k=top_k, sample_count=1, verbose=False,
        )
    if len(predictions) != sample_count or any(len(prediction) != len(future) for prediction in predictions):
        raise RuntimeError("kronos_sample_shape_mismatch")
    paths = []
    for index, prediction in enumerate(predictions):
        points = _serialize_prediction(prediction, future)
        paths.append({"sampleIndex": index + 1, "valid": all(point["valid"] for point in points), "points": points})
    # Mean uses every raw draw, without silently dropping invalid samples.
    mean = pd.DataFrame(np.mean(np.stack([prediction.to_numpy(dtype=float) for prediction in predictions]), axis=0),
                        columns=predictions[0].columns)
    return {"points": _serialize_prediction(mean, future), "samplePaths": paths,
            "distribution": _summarize_paths(paths, history[-1]["close"])}


def _forecast_market_bars(symbol: str, timeframe: str, *, start: str | None = None, end: str | None = None,
                          history_limit: int = 128, horizon: int = 5, model_variant: str = "mini",
                          sample_count: int = 4, seed: int = 443, temperature: float = 1.0,
                          top_p: float = 0.9, top_k: int = 0) -> dict[str, Any]:
    for value, lo, hi, field in ((history_limit, 16, 400, "history_limit"), (horizon, 1, 20, "horizon"),
                                (sample_count, 1, 64 if model_variant == "mini" else 16, "sample_count"),
                                (seed, 0, 2**31-1, "seed")):
        if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
            raise TradingForecastError(f"trading_forecast_{field}_invalid")
    for value, field in ((temperature, "temperature"), (top_p, "top_p")):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise TradingForecastError(f"trading_forecast_{field}_invalid")
    if top_p > 1:
        raise TradingForecastError("trading_forecast_top_p_invalid")
    if isinstance(top_k, bool) or not isinstance(top_k, int) or top_k < 0:
        raise TradingForecastError("trading_forecast_top_k_invalid")
    if model_variant not in _MODELS or timeframe not in _INTERVALS:
        raise TradingForecastError("trading_forecast_model_or_timeframe_invalid")
    now = datetime.now(timezone.utc)
    cutoff = _timestamp(end or now.isoformat())
    if cutoff > now:
        raise TradingForecastError("trading_forecast_cutoff_in_future")
    begin = _timestamp(start) if start else cutoff - timedelta(days=history_limit * 3 + 14)
    if begin >= cutoff:
        raise TradingForecastError("trading_forecast_window_invalid")
    started = perf_counter()
    bars = get_historical_bars(AlpacaInstrumentRef(symbol=symbol), timeframe,
                               start=begin.isoformat(), end=cutoff.isoformat(), limit=1000, feed="iex", sort="desc")
    model_ref, revision, tokenizer_ref, tokenizer_revision, _ = _MODELS[model_variant]
    result: dict[str, Any] = {
        "schemaVersion": "trading.forecast.v1", "status": bars.status, "model": "kronos", "modelExecution": "not_attempted",
        "modelRef": model_ref, "modelRevision": revision, "tokenizerRef": tokenizer_ref,
        "tokenizerRevision": tokenizer_revision, "sourceRevision": KRONOS_SOURCE_REVISION,
        "generatedAt": now.isoformat(), "cutoff": cutoff.isoformat(), "horizon": horizon,
        "parameters": {"historyLimit": history_limit, "sampleCount": sample_count, "seed": seed,
                       "temperature": temperature, "topP": top_p, "topK": top_k},
        "aggregation": "sample" if sample_count == 1 else "arithmetic_mean_of_samples",
        "marketData": {"provider": bars.provider, "feed": bars.feed, "adjustment": "raw", "calendar": "NYSE",
                       "symbol": bars.symbol, "timeframe": timeframe, "fetchedAt": bars.fetchedAt},
        "history": [], "points": [], "samplePaths": [], "warnings": [], "diagnostics": bars.diagnostics,
        "runtime": {"device": "cpu", "seconds": None},
    }
    if bars.status != STATUS_AVAILABLE:
        return result
    try:
        history, warnings = _prepare_history(bars, cutoff, history_limit)
        future = _future_timestamps(history[-1]["timestamp"], timeframe, horizon)
        result.update(history=history, warnings=warnings, lastObservedAt=history[-1]["timestamp"],
                      inputSha256=hashlib.sha256(json.dumps(history, sort_keys=True).encode()).hexdigest())
        prediction = _predict_history(history, future, model_variant, sample_count, seed,
                                      temperature=temperature, top_p=top_p, top_k=top_k)
        result["modelExecution"] = "completed"
        valid = all(point["valid"] for point in prediction["points"]) and all(path["valid"] for path in prediction["samplePaths"])
        result.update(status="available" if valid else "invalid_prediction", **prediction,
                      diagnostics=None if valid else "Raw model output contains invalid OHLCV; not suitable for risk calculations.")
        result["samplingMethod"] = "upstream_predict_batch_one_draw_per_identical_history"
        if top_k:
            result["warnings"].append("Positive top-k replaces top-p filtering in Kronos. Top-k 1 is greedy: repeated paths do not represent independent scenarios.")
        result["warnings"].append("Sample ranges and up/down counts describe these model draws, not calibrated probabilities. The mean is not a most-likely path; invalid paths are retained but excluded from range and direction summaries.")
        closes = [row["close"] for row in history]
        result["observedIndicators"] = {"lastClose": closes[-1], "sma20": sum(closes[-20:]) / 20 if len(closes) >= 20 else None}
    except TradingForecastError as error:
        result.update(status="invalid_history", diagnostics=str(error))
    except (ImportError, OSError) as error:
        result.update(status="model_unavailable", modelExecution="unavailable", diagnostics=f"kronos_model_unavailable:{type(error).__name__}")
    except Exception as error:
        result.update(status="model_error", modelExecution="failed", diagnostics=f"kronos_model_error:{type(error).__name__}")
    result["completedAt"] = datetime.now(timezone.utc).isoformat()
    result["runtime"]["seconds"] = round(perf_counter() - started, 3)
    return result


async def forecast_market_bars(symbol: str, timeframe: str, start: str | None = None, end: str | None = None,
                               history_limit: int = 128, horizon: int = 5, model_variant: str = "mini",
                               sample_count: int = 4, seed: int = 443, temperature: float = 1.0,
                               top_p: float = 0.9, top_k: int = 0, include_volatility: bool = False, *, projectId: str, deckId: str,
                               _callerCardId: str) -> dict[str, Any]:
    from app.python_models.trading_forecast_store import require_forecast_card, save_forecast
    if type(include_volatility) is not bool:
        raise ApplicationToolError("trading_forecast_include_volatility_invalid")
    card = await asyncio.to_thread(require_forecast_card, projectId, deckId, _callerCardId)
    try:
        result = await asyncio.to_thread(_forecast_market_bars, symbol, timeframe, start=start, end=end,
                                        history_limit=history_limit, horizon=horizon, model_variant=model_variant,
                                        sample_count=sample_count, seed=seed, temperature=temperature,
                                        top_p=top_p, top_k=top_k)
    except TradingForecastError as error:
        guidance = ("; omit end to use invocation time, or supply a timezone-qualified cutoff no later than now. "
                    "Do not repeat the same future cutoff for other symbols."
                    if str(error) == "trading_forecast_cutoff_in_future" else "")
        raise ApplicationToolError(str(error) + guidance) from None
    if include_volatility and result["history"]:
        from app.python_models.trading_statistics import volatility_comparison
        result["parameters"]["includeVolatility"] = True
        result["volatilityComparison"] = await asyncio.to_thread(
            volatility_comparison, result["history"], horizon, timeframe)
    if result["points"]:
        import psycopg
        forecast_id = str(uuid4())
        try:
            await asyncio.to_thread(save_forecast, projectId, deckId, _callerCardId,
                                   {**result, "forecastId": forecast_id}, str(card["current_revision_id"]))
        except psycopg.Error:
            # The calculation already completed under the saved Card's authority.
            # A lost commit acknowledgement is not proof that no row exists.
            result["persistence"] = {"status": "unconfirmed", "reference": forecast_id,
                "reason": "Forecast calculation completed; PostgreSQL retention was not confirmed. Do not claim this result is saved."}
        else:
            result["forecastId"] = forecast_id
            result["persistence"] = {"status": "saved"}
    return result
