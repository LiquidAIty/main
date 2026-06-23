"""One typed forecast contract shared by every model adapter.

Input is a normalized OHLCV window (the recorded Alpaca bar shape); output is a typed
``ForecastResult`` whose points carry whichever fields the model actually produces —
Chronos emits a univariate price band (median + quantiles), Kronos emits full candles
(OHLCV). Pure-python: importing this never pulls torch, so the rails stay light.

This is a capability contract only. It produces no signal, decision, or trade.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

# ForecastResult.status
STATUS_AVAILABLE = "available"
MODEL_UNAVAILABLE = "model_unavailable"  # the model's runtime libs are not installed
STATUS_ERROR = "error"

# Known adapters.
MODEL_CHRONOS = "chronos-bolt"
MODEL_KRONOS = "kronos"


@dataclass(frozen=True)
class OhlcvBar:
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class BarWindow:
    """A recorded, normalized OHLCV window for an explicit instrument."""

    symbol: str
    timeframe: str
    source: str  # provenance, e.g. "alpaca_paper:iex"
    bars: list[OhlcvBar]

    def closes(self) -> list[float]:
        return [b.close for b in self.bars]


@dataclass(frozen=True)
class ForecastPoint:
    step: int  # 1-based future step
    # Univariate probabilistic (Chronos): median + optional quantile band.
    median: Optional[float] = None
    p10: Optional[float] = None
    p90: Optional[float] = None
    # Candle-native (Kronos): full predicted OHLCV.
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: Optional[float] = None
    volume: Optional[float] = None


@dataclass(frozen=True)
class ForecastResult:
    model: str  # MODEL_CHRONOS | MODEL_KRONOS
    modelRef: str  # HF id(s) the adapter loaded
    symbol: str
    timeframe: str
    horizon: int
    status: str  # available | model_unavailable | error
    points: list[ForecastPoint] = field(default_factory=list)
    generatedAt: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    diagnostics: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "points": [asdict(p) for p in self.points]}


def bar_window_from_alpaca(payload: Any, *, source: str = "alpaca") -> BarWindow:
    """Normalize the Alpaca HistoricalBars shape (dict from to_dict(), or the dataclass)
    into a {@link BarWindow}. No fabrication — only bars actually present are carried."""
    if isinstance(payload, dict):
        symbol = str(payload.get("symbol") or "")
        timeframe = str(payload.get("timeframe") or "")
        feed = payload.get("feed")
        raw_bars = payload.get("bars") or []
        get = lambda b, k: b.get(k)
    else:  # the HistoricalBars dataclass
        symbol = str(getattr(payload, "symbol", ""))
        timeframe = str(getattr(payload, "timeframe", ""))
        feed = getattr(payload, "feed", None)
        raw_bars = getattr(payload, "bars", []) or []
        get = lambda b, k: getattr(b, k)
    bars = [
        OhlcvBar(
            timestamp=str(get(b, "timestamp")),
            open=float(get(b, "open")),
            high=float(get(b, "high")),
            low=float(get(b, "low")),
            close=float(get(b, "close")),
            volume=float(get(b, "volume")),
        )
        for b in raw_bars
    ]
    src = f"{source}:{feed}" if feed else source
    return BarWindow(symbol=symbol, timeframe=timeframe, source=src, bars=bars)


def unavailable(model: str, model_ref: str, window: BarWindow, horizon: int, reason: str) -> ForecastResult:
    return ForecastResult(
        model=model, modelRef=model_ref, symbol=window.symbol, timeframe=window.timeframe,
        horizon=horizon, status=MODEL_UNAVAILABLE, points=[], diagnostics=reason,
    )


def errored(model: str, model_ref: str, window: BarWindow, horizon: int, reason: str) -> ForecastResult:
    return ForecastResult(
        model=model, modelRef=model_ref, symbol=window.symbol, timeframe=window.timeframe,
        horizon=horizon, status=STATUS_ERROR, points=[], diagnostics=reason,
    )
