"""Actual read-only LumiBot and Alpaca observation for paper trading state."""

from __future__ import annotations

import atexit
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from importlib import metadata
from threading import Lock
from time import monotonic
from typing import Any

from app.python_models.alpaca_market_data import (
    AlpacaInstrumentRef,
    get_historical_bars,
    get_market_snapshot,
)
from app.python_models.provider_config import (
    DEFAULT_DATA_URL,
    DEFAULT_PAPER_TRADING_URL,
    MODE_PAPER,
    load_alpaca_config,
    resolve_alpaca_credentials,
)
from app.python_models.trading_contract import (
    MARKET_TIMEFRAMES,
    TradingBoundaryError,
    optional_iso_text,
    utc_now_text,
)


_OBSERVATION_CACHE_SECONDS = 15.0
_MAX_MARKET_SYMBOLS = 50

_broker_lock = Lock()
_broker_read_lock = Lock()
_paper_broker: Any | None = None
_paper_observer: Any | None = None
_paper_broker_snapshot: tuple[float, dict[str, Any]] | None = None
_market_cache_lock = Lock()
_market_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}


def lumibot_readiness() -> dict[str, Any]:
    """Read installed Lumibot identity without instantiating a broker or strategy."""

    try:
        version = metadata.version("lumibot")
        from lumibot.strategies.strategy import Strategy  # noqa: PLC0415
        from lumibot.traders.trader import Trader  # noqa: PLC0415
    except (ImportError, metadata.PackageNotFoundError) as error:
        return {
            "status": "dependency_unavailable",
            "version": None,
            "strategyClassAvailable": False,
            "traderClassAvailable": False,
            "paperOnly": True,
            "orderSubmission": "blocked_pending_separate_approval",
            "diagnostics": type(error).__name__,
            "adapter": {
                "contractVersion": "card-subsystem.v1",
                "publicApiOnly": True,
                "capabilities": ["state", "events", "commands", "artifacts", "readiness"],
            },
            "lifecycle": {
                "status": "dependency_unavailable",
                "activeStrategies": 0,
                "scheduler": "not_started",
                "diagnostics": type(error).__name__,
            },
            "subsystemAgents": {
                "enabled": False,
                "authority": "hermes",
                "diagnostics": "Direct subsystem model providers are disabled.",
            },
        }
    return {
        "status": "available",
        "version": version,
        "strategyClassAvailable": isinstance(Strategy, type),
        "traderClassAvailable": isinstance(Trader, type),
        "paperOnly": True,
        "orderSubmission": "blocked_pending_separate_approval",
        "diagnostics": None,
        "adapter": {
            "contractVersion": "card-subsystem.v1",
            "publicApiOnly": True,
            "capabilities": ["state", "events", "commands", "artifacts", "readiness"],
        },
        "lifecycle": {
            "status": "not_started",
            "activeStrategies": 0,
            "scheduler": "not_started",
            "diagnostics": "No continuous Trader starts before separate execution approval.",
        },
        "subsystemAgents": {
            "enabled": False,
            "authority": "hermes",
            "diagnostics": "Use the saved Card's Hermes Team; direct subsystem providers are disabled.",
        },
    }


def _optional_number(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _enum_text(value: Any) -> str | None:
    if value is None:
        return None
    raw = getattr(value, "value", value)
    text = str(raw or "").strip()
    return text or None


def _unavailable_broker_state(status: str, diagnostics: str) -> dict[str, Any]:
    return {
        "connection": {
            "provider": "alpaca",
            "status": status,
            "mode": "unavailable",
            "accountStatus": None,
            "fetchedAt": utc_now_text(),
            "diagnostics": diagnostics,
        },
        "account": {
            "portfolioValueUsd": None,
            "cashUsd": None,
            "buyingPowerUsd": None,
            "dailyPnlUsd": None,
            "totalUnrealizedPnlUsd": None,
            "maxDrawdownUsd": None,
            "maxDrawdownPercent": None,
            "unavailableMetrics": [
                "portfolioValueUsd", "cashUsd", "buyingPowerUsd",
                "dailyPnlUsd", "totalUnrealizedPnlUsd", "maxDrawdownUsd",
                "maxDrawdownPercent",
            ],
        },
        "positions": [],
        "orders": [],
        "equityCurve": [],
    }


def _cleanup_paper_broker() -> None:
    global _paper_broker, _paper_observer
    broker = _paper_broker
    _paper_broker = None
    _paper_observer = None
    if broker is not None:
        try:
            broker.cleanup_streams()
        except Exception:  # pragma: no cover - process shutdown best effort
            pass


atexit.register(_cleanup_paper_broker)


def _resolve_paper_observer() -> tuple[Any | None, dict[str, Any] | None]:
    """Create one process-owned LumiBot observer in strict paper mode.

    Construction and reads use only LumiBot's public Strategy/Broker API. The
    observer is never added to a Trader, so no strategy heartbeat or order path
    starts before the separate execution approval.
    """

    global _paper_broker, _paper_observer
    config = load_alpaca_config()
    if config.readiness != "ready" or config.mode != MODE_PAPER:
        return None, _unavailable_broker_state(
            "provider_unconfigured" if config.readiness == "unconfigured" else "invalid_configuration",
            "alpaca paper credentials are not configured" if config.readiness == "unconfigured"
            else "live or invalid Alpaca configuration is rejected",
        )
    credentials = resolve_alpaca_credentials()
    if credentials is None:
        return None, _unavailable_broker_state(
            "provider_unconfigured", "alpaca paper credentials are not configured",
        )
    if (
        credentials.paper_trading_url != DEFAULT_PAPER_TRADING_URL
        or credentials.data_url != DEFAULT_DATA_URL
    ):
        return None, _unavailable_broker_state(
            "invalid_configuration",
            "the pinned LumiBot Alpaca adapter cannot prove custom paper endpoints",
        )
    with _broker_lock:
        if _paper_observer is None:
            try:
                from lumibot.brokers import Alpaca  # noqa: PLC0415
                from lumibot.strategies import Strategy  # noqa: PLC0415

                _paper_broker = Alpaca({
                    "API_KEY": credentials.key_id,
                    "API_SECRET": credentials.secret_key,
                    "PAPER": True,
                }, connect_stream=False)
                _paper_observer = Strategy(
                    broker=_paper_broker,
                    name="TradingCardPaperObserver",
                    benchmark_asset=None,
                    should_backup_variables_to_database=False,
                    should_send_summary_to_discord=False,
                    save_logfile=False,
                )
            except Exception as error:  # noqa: BLE001
                _paper_broker = None
                _paper_observer = None
                return None, _unavailable_broker_state(
                    "provider_error", f"lumibot_paper_broker_error:{type(error).__name__}",
                )
    return _paper_observer, None


def _history_points(history: Any) -> list[dict[str, Any]]:
    day = history.get("day") if isinstance(history, dict) else None
    if day is None or not hasattr(day, "reset_index"):
        return []
    try:
        records = day.reset_index().to_dict(orient="records")
    except Exception:  # noqa: BLE001
        return []
    points: list[dict[str, Any]] = []
    peak: float | None = None
    for record in records[-90:]:
        if not isinstance(record, dict):
            continue
        value = _optional_number(record.get("equity"))
        if value is None:
            value = _optional_number(record.get("portfolio_value"))
        timestamp = next((
            optional_iso_text(record.get(key))
            for key in ("timestamp", "date", "index")
            if record.get(key) is not None
        ), None)
        if value is not None and timestamp:
            peak = value if peak is None else max(peak, value)
            drawdown = value - peak
            points.append({
                "timestamp": timestamp,
                "valueUsd": value,
                "drawdownUsd": drawdown,
                "drawdownPercent": (drawdown / peak * 100) if peak else 0.0,
            })
    return points


def _public_position(position: Any) -> dict[str, Any]:
    asset = getattr(position, "asset", None)
    return {
        "symbol": str(getattr(asset, "symbol", "") or getattr(position, "symbol", "")).upper(),
        "side": _enum_text(getattr(position, "side", None)),
        "quantity": _optional_number(getattr(position, "quantity", None)),
        "averageEntryPrice": _optional_number(getattr(position, "avg_fill_price", None)),
        "currentPrice": _optional_number(getattr(position, "current_price", None)),
        "marketValueUsd": _optional_number(getattr(position, "market_value", None)),
        "unrealizedPnlUsd": _optional_number(getattr(position, "pnl", None)),
        "strategy": _enum_text(getattr(position, "strategy", None)),
    }


def _public_order(order: Any) -> dict[str, Any]:
    asset = getattr(order, "asset", None)
    return {
        "orderId": str(getattr(order, "identifier", "") or getattr(order, "id", "") or ""),
        "clientOrderId": str(getattr(order, "client_order_id", "") or ""),
        "symbol": str(getattr(asset, "symbol", "") or getattr(order, "symbol", "") or "").upper(),
        "side": _enum_text(getattr(order, "side", None)),
        "quantity": _optional_number(
            getattr(order, "quantity", None) or getattr(order, "qty", None)
        ),
        "filledQuantity": _optional_number(
            getattr(order, "filled_quantity", None) or getattr(order, "filled_qty", None)
        ),
        "type": _enum_text(getattr(order, "order_type", None) or getattr(order, "type", None)),
        "status": _enum_text(getattr(order, "status", None)),
        "limitPrice": _optional_number(getattr(order, "limit_price", None)),
        "stopPrice": _optional_number(getattr(order, "stop_price", None)),
        "averageFillPrice": _optional_number(
            getattr(order, "avg_fill_price", None) or getattr(order, "filled_avg_price", None)
        ),
        "createdAt": optional_iso_text(
            getattr(order, "date_created", None) or getattr(order, "created_at", None)
        ),
        "updatedAt": optional_iso_text(
            getattr(order, "broker_update_date", None) or getattr(order, "updated_at", None)
        ),
        "filledAt": optional_iso_text(getattr(order, "filled_at", None)),
    }


def read_lumibot_paper_snapshot(*, observer: Any | None = None) -> dict[str, Any]:
    """Read account, positions, tracked orders and history through public LumiBot APIs."""

    global _paper_broker_snapshot
    supplied_observer = observer is not None
    now_mono = monotonic()
    if not supplied_observer and _paper_broker_snapshot is not None:
        recorded_at, cached = _paper_broker_snapshot
        if now_mono - recorded_at < _OBSERVATION_CACHE_SECONDS:
            return deepcopy(cached)
    unavailable: dict[str, Any] | None = None
    if observer is None:
        observer, unavailable = _resolve_paper_observer()
    if observer is None:
        return unavailable or _unavailable_broker_state(
            "provider_error", "lumibot paper broker unavailable",
        )
    try:
        with _broker_read_lock:
            portfolio_value = _optional_number(observer.get_portfolio_value())
            cash = _optional_number(observer.get_cash())
            positions = [_public_position(item) for item in observer.get_positions()]
            orders = [_public_order(item) for item in observer.get_orders()]
            history = observer.broker.get_historical_account_value()
        equity_curve = _history_points(history)
        daily_pnl = None
        if len(equity_curve) >= 2:
            daily_pnl = equity_curve[-1]["valueUsd"] - equity_curve[-2]["valueUsd"]
        unrealized_values = [
            item["unrealizedPnlUsd"] for item in positions
            if item["unrealizedPnlUsd"] is not None
        ]
        unavailable_metrics = ["buyingPowerUsd"]
        if daily_pnl is None:
            unavailable_metrics.append("dailyPnlUsd")
        result = {
            "connection": {
                "provider": "alpaca",
                "status": "available",
                "mode": "paper",
                "accountStatus": None,
                "fetchedAt": utc_now_text(),
                "diagnostics": None,
            },
            "account": {
                "portfolioValueUsd": portfolio_value,
                "cashUsd": cash,
                "buyingPowerUsd": None,
                "dailyPnlUsd": daily_pnl,
                "totalUnrealizedPnlUsd": sum(unrealized_values) if unrealized_values else 0.0,
                "maxDrawdownUsd": min(
                    (point["drawdownUsd"] for point in equity_curve), default=0.0,
                ),
                "maxDrawdownPercent": min(
                    (point["drawdownPercent"] for point in equity_curve), default=0.0,
                ),
                "unavailableMetrics": unavailable_metrics,
            },
            "positions": positions,
            "orders": orders,
            "equityCurve": equity_curve,
        }
    except Exception as error:  # noqa: BLE001
        result = _unavailable_broker_state(
            "provider_error", f"lumibot_paper_read_error:{type(error).__name__}",
        )
    if not supplied_observer:
        _paper_broker_snapshot = (now_mono, deepcopy(result))
    return result


def _read_market_observation(symbol: str, timeframe: str) -> dict[str, Any]:
    key = (symbol, timeframe)
    now_mono = monotonic()
    with _market_cache_lock:
        cached = _market_cache.get(key)
        if cached is not None and now_mono - cached[0] < _OBSERVATION_CACHE_SECONDS:
            return deepcopy(cached[1])
    snapshot = get_market_snapshot(AlpacaInstrumentRef(symbol)).to_dict()
    bars = get_historical_bars(
        AlpacaInstrumentRef(symbol), timeframe, limit=72,
    ).to_dict()
    status = (
        "available" if snapshot.get("status") == "available"
        and bars.get("status") in {"available", "empty"}
        else str(snapshot.get("status") or bars.get("status") or "unavailable")
    )
    result = {
        "status": status,
        "provider": snapshot.get("provider") or bars.get("provider"),
        "feed": snapshot.get("feed") or bars.get("feed"),
        "timeframe": timeframe,
        "fetchedAt": snapshot.get("fetchedAt") or bars.get("fetchedAt"),
        "observedAt": snapshot.get("observedAt"),
        "freshness": snapshot.get("freshness"),
        "currentPrice": snapshot.get("latestTradePrice"),
        "bars": bars.get("bars") or [],
        "diagnostics": snapshot.get("diagnostics") or bars.get("diagnostics"),
    }
    with _market_cache_lock:
        _market_cache[key] = (now_mono, deepcopy(result))
    return result


def market_observations(
    jobs: list[dict[str, Any]], timeframe: str, selected_job_id: str | None,
) -> dict[str, dict[str, Any]]:
    if timeframe not in MARKET_TIMEFRAMES:
        raise TradingBoundaryError("trading_timeframe_invalid")
    selected_symbol = next((
        str(job.get("symbol") or "") for job in jobs
        if str(job.get("job_id") or "") == selected_job_id
    ), "")
    symbols = list(dict.fromkeys(
        str(job.get("symbol") or "").upper()
        for job in jobs
        if job.get("state") in {"monitoring", "paused"}
    ))
    if selected_symbol and selected_symbol.upper() not in symbols:
        symbols.append(selected_symbol.upper())
    symbols = [symbol for symbol in symbols if symbol][:_MAX_MARKET_SYMBOLS]
    if not symbols:
        return {}
    with ThreadPoolExecutor(max_workers=min(12, len(symbols))) as executor:
        values = executor.map(lambda item: _read_market_observation(item, timeframe), symbols)
        return dict(zip(symbols, values, strict=True))
