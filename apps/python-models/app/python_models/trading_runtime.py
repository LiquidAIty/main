"""Deterministic, paper-only Trade Job state beneath the saved Trading Card.

Hermes owns reasoning, memory, skills, sessions, and optional Team use.  This
module owns only typed plan validation and durable state transitions.  It has no
live-broker client and deliberately exposes no order-submission function.
"""

from __future__ import annotations

import atexit
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import json
from datetime import datetime, timezone
from importlib import metadata
from threading import Lock
from time import monotonic
from typing import Any
from uuid import UUID, uuid4

from psycopg.rows import dict_row

from app.python_models.alpaca_market_data import (
    AlpacaInstrumentRef,
    get_historical_bars,
    get_market_snapshot,
)
from app.python_models.card_subsystem import normalize_card_subsystems
from app.python_models.lumibot_lifecycle import (
    LUMIBOT_PROOF_SYMBOL,
    LumibotLifecycleError,
    run_lumibot_local_backtest,
)
from app.python_models.postgres import connect_postgres
from app.python_models.provider_config import (
    DEFAULT_DATA_URL,
    DEFAULT_PAPER_TRADING_URL,
    MODE_PAPER,
    load_alpaca_config,
    resolve_alpaca_credentials,
)


TRADE_ACTIONS = ("WAIT", "ENTER", "HOLD", "REDUCE", "EXIT", "PAUSE", "FAIL_SAFE")
JOB_STATES = ("monitoring", "paused", "completed", "fail_safe")
_DIRECTIONS = frozenset({"long", "short"})
_ORDER_TYPES = frozenset({"market", "limit", "stop", "stop_limit"})
_REQUIRED_PLAN_FIELDS = frozenset({
    "instrument", "assetClass", "allowedDirections", "budgetCeilingUsd",
    "maxLossUsd", "expectedRiskReward", "entryConditions", "exitConditions", "stopConditions",
    "invalidationConditions", "horizon", "expiresAt", "allowedOrderTypes",
    "dataRequirements", "executionPolicy", "origin",
})
_MARKET_TIMEFRAMES = frozenset({"1Min", "5Min", "15Min", "1Hour", "1Day"})
_OBSERVATION_CACHE_SECONDS = 15.0
_MAX_MARKET_SYMBOLS = 50

_broker_lock = Lock()
_broker_read_lock = Lock()
_paper_broker: Any | None = None
_paper_observer: Any | None = None
_paper_broker_snapshot: tuple[float, dict[str, Any]] | None = None
_market_cache_lock = Lock()
_market_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}


class TradingRuntimeError(ValueError):
    """Typed fail-closed error from the deterministic trading boundary."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _text(value: Any, field: str, limit: int = 2_000) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TradingRuntimeError(f"trade_plan_{field}_required")
    result = value.strip()
    if len(result) > limit:
        raise TradingRuntimeError(f"trade_plan_{field}_too_long")
    return result


def _positive_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise TradingRuntimeError(f"trade_plan_{field}_positive_number_required")
    return float(value)


def _text_list(value: Any, field: str, *, allowed: frozenset[str] | None = None) -> list[str]:
    if not isinstance(value, list) or not value or len(value) > 32:
        raise TradingRuntimeError(f"trade_plan_{field}_nonempty_list_required")
    result = list(dict.fromkeys(_text(item, field, 500).lower() for item in value))
    if allowed is not None and any(item not in allowed for item in result):
        raise TradingRuntimeError(f"trade_plan_{field}_unsupported")
    return result


def normalize_trade_plan(value: Any) -> dict[str, Any]:
    """Validate every execution term; missing or extra terms never get invented."""

    if not isinstance(value, dict):
        raise TradingRuntimeError("trade_plan_object_required")
    missing = sorted(_REQUIRED_PLAN_FIELDS - set(value))
    extra = sorted(set(value) - _REQUIRED_PLAN_FIELDS)
    if missing:
        raise TradingRuntimeError(f"trade_plan_missing_terms:{','.join(missing)}")
    if extra:
        raise TradingRuntimeError(f"trade_plan_unknown_terms:{','.join(extra)}")
    instrument = value["instrument"]
    if not isinstance(instrument, dict) or set(instrument) != {"symbol", "venue"}:
        raise TradingRuntimeError("trade_plan_instrument_invalid")
    origin = value["origin"]
    if not isinstance(origin, dict) or set(origin) != {"kind", "id"}:
        raise TradingRuntimeError("trade_plan_origin_invalid")
    expires_at = _text(value["expiresAt"], "expires_at", 80)
    try:
        parsed_expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise TradingRuntimeError("trade_plan_expires_at_invalid") from error
    if parsed_expiry.tzinfo is None:
        raise TradingRuntimeError("trade_plan_expires_at_timezone_required")
    budget = _positive_number(value["budgetCeilingUsd"], "budget_ceiling_usd")
    max_loss = _positive_number(value["maxLossUsd"], "max_loss_usd")
    if max_loss > budget:
        raise TradingRuntimeError("trade_plan_max_loss_exceeds_budget")
    return {
        "instrument": {
            "symbol": _text(instrument["symbol"], "instrument_symbol", 32).upper(),
            "venue": _text(instrument["venue"], "instrument_venue", 40).upper(),
        },
        "assetClass": _text(value["assetClass"], "asset_class", 40).lower(),
        "allowedDirections": _text_list(
            value["allowedDirections"], "allowed_directions", allowed=_DIRECTIONS,
        ),
        "budgetCeilingUsd": budget,
        "maxLossUsd": max_loss,
        "expectedRiskReward": _positive_number(
            value["expectedRiskReward"], "expected_risk_reward",
        ),
        "entryConditions": _text_list(value["entryConditions"], "entry_conditions"),
        "exitConditions": _text_list(value["exitConditions"], "exit_conditions"),
        "stopConditions": _text_list(value["stopConditions"], "stop_conditions"),
        "invalidationConditions": _text_list(
            value["invalidationConditions"], "invalidation_conditions",
        ),
        "horizon": _text(value["horizon"], "horizon", 160),
        "expiresAt": parsed_expiry.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "allowedOrderTypes": _text_list(
            value["allowedOrderTypes"], "allowed_order_types", allowed=_ORDER_TYPES,
        ),
        "dataRequirements": _text_list(value["dataRequirements"], "data_requirements"),
        "executionPolicy": _text(value["executionPolicy"], "execution_policy", 4_000),
        "origin": {
            "kind": _text(origin["kind"], "origin_kind", 80),
            "id": _text(origin["id"], "origin_id", 160),
        },
    }


def normalize_trading_configuration(value: Any) -> dict[str, Any]:
    """Validate the card-owned slider/select configuration without filling omissions."""

    if not isinstance(value, dict) or set(value) != {"schemaVersion", "trading"}:
        raise TradingRuntimeError("trading_configuration_invalid")
    if value.get("schemaVersion") != "trading.card.v1" or not isinstance(value.get("trading"), dict):
        raise TradingRuntimeError("trading_configuration_schema_invalid")
    settings = value["trading"]
    required = {
        "paperOnly", "executionApproved", "paperBudgetUsd", "allocationPerJobPercent",
        "maxConcurrentJobs", "maxOpenPositions", "maxPlanLossPercent",
        "maxDailyLossPercent", "minimumConfidencePercent", "minimumRiskReward",
        "evaluationCadenceSeconds", "staleDataSeconds",
    }
    optional_defaults: dict[str, Any] = {
        "maxPortfolioDrawdownPercent": 0,
        "defaultStopLossPercent": 0,
        "heartbeatSeconds": 60,
        "failSafeCooldownMinutes": 60,
        "defaultTimeframe": "5Min",
        "chartWindowBars": 72,
        "compactChartHeightPx": 116,
        "brokerConnectionRef": "alpaca-paper",
        "marketSession": "regular",
        "strategyParameters": {},
    }
    if not required.issubset(settings) or set(settings) - required - set(optional_defaults):
        raise TradingRuntimeError("trading_configuration_fields_invalid")
    if settings["paperOnly"] is not True or settings["executionApproved"] is not False:
        raise TradingRuntimeError("trading_execution_must_remain_unapproved_paper_only")
    numeric_ranges = {
        "paperBudgetUsd": (0, 100_000_000),
        "allocationPerJobPercent": (0, 100),
        "maxConcurrentJobs": (1, 50),
        "maxOpenPositions": (0, 50),
        "maxPlanLossPercent": (0, 100),
        "maxDailyLossPercent": (0, 100),
        "maxPortfolioDrawdownPercent": (0, 100),
        "defaultStopLossPercent": (0, 100),
        "minimumConfidencePercent": (0, 100),
        "minimumRiskReward": (0, 20),
        "evaluationCadenceSeconds": (15, 86_400),
        "heartbeatSeconds": (15, 86_400),
        "failSafeCooldownMinutes": (1, 10_080),
        "staleDataSeconds": (15, 86_400),
        "chartWindowBars": (24, 500),
        "compactChartHeightPx": (80, 320),
    }
    normalized: dict[str, Any] = {"paperOnly": True, "executionApproved": False}
    for field, (minimum, maximum) in numeric_ranges.items():
        raw = settings.get(field, optional_defaults.get(field))
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not minimum <= raw <= maximum:
            raise TradingRuntimeError(f"trading_configuration_{field}_invalid")
        normalized[field] = int(raw) if field in {
            "maxConcurrentJobs", "maxOpenPositions", "evaluationCadenceSeconds",
            "heartbeatSeconds", "failSafeCooldownMinutes", "staleDataSeconds",
            "chartWindowBars", "compactChartHeightPx",
        } else float(raw)
    default_timeframe = settings.get("defaultTimeframe", optional_defaults["defaultTimeframe"])
    if default_timeframe not in _MARKET_TIMEFRAMES:
        raise TradingRuntimeError("trading_configuration_defaultTimeframe_invalid")
    normalized["defaultTimeframe"] = default_timeframe
    broker_ref = settings.get("brokerConnectionRef", optional_defaults["brokerConnectionRef"])
    if broker_ref != "alpaca-paper":
        raise TradingRuntimeError("trading_configuration_brokerConnectionRef_invalid")
    normalized["brokerConnectionRef"] = broker_ref
    market_session = settings.get("marketSession", optional_defaults["marketSession"])
    if market_session not in {"regular", "extended"}:
        raise TradingRuntimeError("trading_configuration_marketSession_invalid")
    normalized["marketSession"] = market_session
    strategy_parameters = settings.get("strategyParameters", optional_defaults["strategyParameters"])
    if (
        not isinstance(strategy_parameters, dict)
        or len(strategy_parameters) > 64
        or len(json.dumps(strategy_parameters, ensure_ascii=False)) > 20_000
        or any(not isinstance(key, str) or not key.strip() for key in strategy_parameters)
        or any(not isinstance(item, (str, int, float, bool)) for item in strategy_parameters.values())
    ):
        raise TradingRuntimeError("trading_configuration_strategyParameters_invalid")
    normalized["strategyParameters"] = dict(strategy_parameters)
    return {"schemaVersion": "trading.card.v1", "trading": normalized}


def validate_plan_against_configuration(
    plan: dict[str, Any], configuration: dict[str, Any], *, active_job_count: int,
) -> None:
    """Apply deterministic portfolio gates before accepting a Trade Job."""

    settings = normalize_trading_configuration(configuration)["trading"]
    if any(settings[field] <= 0 for field in (
        "paperBudgetUsd", "allocationPerJobPercent", "maxOpenPositions",
        "maxPlanLossPercent", "maxDailyLossPercent", "maxPortfolioDrawdownPercent",
        "defaultStopLossPercent",
    )):
        raise TradingRuntimeError("trading_risk_configuration_incomplete")
    if active_job_count >= settings["maxConcurrentJobs"]:
        raise TradingRuntimeError("trading_max_concurrent_jobs_reached")
    per_job_budget = settings["paperBudgetUsd"] * settings["allocationPerJobPercent"] / 100
    if plan["budgetCeilingUsd"] > per_job_budget:
        raise TradingRuntimeError("trade_plan_budget_exceeds_card_allocation")
    per_plan_loss = plan["budgetCeilingUsd"] * settings["maxPlanLossPercent"] / 100
    if plan["maxLossUsd"] > per_plan_loss:
        raise TradingRuntimeError("trade_plan_loss_exceeds_card_risk")
    if plan["expectedRiskReward"] < settings["minimumRiskReward"]:
        raise TradingRuntimeError("trade_plan_risk_reward_below_card_minimum")
    expiry = datetime.fromisoformat(str(plan["expiresAt"]).replace("Z", "+00:00"))
    if expiry <= datetime.now(timezone.utc):
        raise TradingRuntimeError("trade_plan_expired")


def deterministic_client_order_id(job_id: str, decision_id: str) -> str:
    """Create a stable future paper-order id without submitting an order."""

    try:
        UUID(job_id)
        UUID(decision_id)
    except (TypeError, ValueError) as error:
        raise TradingRuntimeError("trading_order_identity_invalid") from error
    digest = hashlib.sha256(f"{job_id}:{decision_id}".encode("utf-8")).hexdigest()[:24]
    return f"paper-{digest}"


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
            "nativeAgents": {
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
            "status": "bounded_local_backtest_available",
            "activeStrategies": 0,
            "scheduler": "not_started",
            "diagnostics": (
                "A fixed local replay may run for adapter proof. No continuous Trader starts "
                "before separate execution approval."
            ),
        },
        "nativeAgents": {
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


def _iso_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        value = value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    text = str(value).strip()
    return text or None


def _unavailable_broker_state(status: str, diagnostics: str) -> dict[str, Any]:
    return {
        "connection": {
            "provider": "alpaca",
            "status": status,
            "mode": "unavailable",
            "accountStatus": None,
            "fetchedAt": _now(),
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
            _iso_text(record.get(key))
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
        "createdAt": _iso_text(
            getattr(order, "date_created", None) or getattr(order, "created_at", None)
        ),
        "updatedAt": _iso_text(
            getattr(order, "broker_update_date", None) or getattr(order, "updated_at", None)
        ),
        "filledAt": _iso_text(getattr(order, "filled_at", None)),
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
                "fetchedAt": _now(),
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


def _market_observations(
    jobs: list[dict[str, Any]], timeframe: str, selected_job_id: str | None,
) -> dict[str, dict[str, Any]]:
    if timeframe not in _MARKET_TIMEFRAMES:
        raise TradingRuntimeError("trading_timeframe_invalid")
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


def _current_trading_card(cursor: Any, project_id: str, deck_id: str, card_id: str) -> dict[str, Any]:
    if not str(card_id or "").strip():
        raise TradingRuntimeError("trading_card_identity_required")
    cursor.execute(
        """
        SELECT card.current_revision_id, revision.runtime_kind, revision.runtime_mode,
               revision.runtime_profile, revision.runtime_extension_config
        FROM ag_catalog.agent_cards AS card
        JOIN ag_catalog.agent_card_revisions AS revision
          ON revision.revision_id = card.current_revision_id
        WHERE card.project_id=%s AND card.deck_id=%s AND card.card_id=%s
        """,
        (project_id, deck_id, card_id),
    )
    row = cursor.fetchone()
    if not row:
        raise TradingRuntimeError("trading_card_not_found")
    if (
        row["runtime_kind"] != "hermes"
        or row["runtime_mode"] != "delegate"
        or not str(row["runtime_profile"] or "").strip()
    ):
        raise TradingRuntimeError("trading_card_hermes_runtime_required")
    result = dict(row)
    extensions = result.get("runtime_extension_config")
    if not isinstance(extensions, dict):
        raise TradingRuntimeError("trading_card_extensions_required")
    try:
        subsystems = normalize_card_subsystems(extensions.get("subsystems"))
    except ValueError as error:
        raise TradingRuntimeError(str(error)) from error
    attachment = next((item for item in subsystems if item["id"] == "lumibot"), None)
    if (
        attachment is None
        or attachment.get("configurationSchema") != "trading.card.v1"
        or set(attachment["adapter"]["capabilities"])
        != {"state", "events", "commands", "artifacts", "readiness"}
    ):
        raise TradingRuntimeError("trading_card_lumibot_attachment_required")
    configuration = extensions.get("configuration") if isinstance(extensions, dict) else None
    result["configuration"] = normalize_trading_configuration(configuration)
    result["subsystem"] = attachment
    return result


def _public_lifecycle_run(row: dict[str, Any]) -> dict[str, Any]:
    snapshot = row.get("snapshot")
    if isinstance(snapshot, str):
        snapshot = json.loads(snapshot)
    events = row.get("lifecycle_events") or []
    if isinstance(events, str):
        events = json.loads(events)
    artifacts = row.get("artifacts") or []
    if isinstance(artifacts, str):
        artifacts = json.loads(artifacts)
    base = dict(snapshot) if isinstance(snapshot, dict) else {}
    return {
        **base,
        "lifecycleRunId": str(row.get("lifecycle_run_id") or base.get("lifecycleRunId") or ""),
        "cardId": str(row.get("card_id") or base.get("cardId") or ""),
        "mode": str(row.get("mode") or base.get("mode") or "local_backtest"),
        "status": str(row.get("status") or base.get("status") or "failed"),
        "paperOnly": row.get("paper_only") is not False,
        "liveOrders": row.get("live_orders") is True,
        "modelProviderCalls": row.get("model_provider_calls") is True,
        "symbol": str(row.get("symbol") or base.get("symbol") or ""),
        "dataProvenance": row.get("data_provenance") or base.get("dataProvenance") or {},
        "events": events,
        "artifacts": artifacts,
        "errorCode": row.get("error_code"),
        "startedAt": _iso_text(row.get("started_at") or base.get("startedAt")),
        "finishedAt": _iso_text(row.get("finished_at") or base.get("finishedAt")),
    }


def run_trading_lifecycle_proof(
    *, project_id: str, deck_id: str, card_id: str,
    idempotency_key: str, actor: str,
) -> dict[str, Any]:
    """Persist one card-scoped real local LumiBot lifecycle receipt."""

    key = _text(idempotency_key, "idempotency_key", 160)
    authenticated_actor = _text(actor, "actor", 240)
    if not authenticated_actor.startswith("authenticated-user:"):
        raise TradingRuntimeError("trading_lifecycle_authenticated_actor_required")
    lifecycle_run_id = str(uuid4())
    created = False
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            card = _current_trading_card(cursor, project_id, deck_id, card_id)
            cursor.execute(
                """
                INSERT INTO ag_catalog.trading_lifecycle_runs (
                  lifecycle_run_id, project_id, deck_id, card_id, card_revision_id,
                  idempotency_key, mode, status, symbol, data_provenance
                ) VALUES (%s,%s,%s,%s,%s,%s,'local_backtest','running',%s,%s::jsonb)
                ON CONFLICT (project_id, deck_id, card_id, idempotency_key) DO NOTHING
                RETURNING *
                """,
                (
                    lifecycle_run_id, project_id, deck_id, card_id,
                    card["current_revision_id"], key, LUMIBOT_PROOF_SYMBOL,
                    json.dumps({
                        "kind": "deterministic-local-replay",
                        "source": "bounded-adapter-proof-bars-v1",
                        "actor": authenticated_actor,
                    }),
                ),
            )
            row = cursor.fetchone()
            if row is None:
                cursor.execute(
                    """
                    SELECT * FROM ag_catalog.trading_lifecycle_runs
                    WHERE project_id=%s AND deck_id=%s AND card_id=%s AND idempotency_key=%s
                    """,
                    (project_id, deck_id, card_id, key),
                )
                row = cursor.fetchone()
            else:
                created = True
        connection.commit()
    if row is None:
        raise TradingRuntimeError("trading_lifecycle_receipt_missing")
    if not created:
        return _public_lifecycle_run(dict(row))

    try:
        result = run_lumibot_local_backtest(
            card_id=card_id, lifecycle_run_id=lifecycle_run_id,
        )
    except Exception as error:  # noqa: BLE001
        code = (
            str(error) if isinstance(error, LumibotLifecycleError)
            else f"lumibot_lifecycle_failed:{type(error).__name__}"
        )[:500]
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                UPDATE ag_catalog.trading_lifecycle_runs
                SET status='failed', error_code=%s, finished_at=NOW()
                WHERE lifecycle_run_id=%s
                RETURNING *
                """,
                (code, lifecycle_run_id),
            )
            failed = cursor.fetchone()
        if failed is None:
            raise TradingRuntimeError("trading_lifecycle_failure_receipt_missing") from error
        raise TradingRuntimeError(code) from error

    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            UPDATE ag_catalog.trading_lifecycle_runs
            SET status='completed', data_provenance=%s::jsonb, snapshot=%s::jsonb,
                lifecycle_events=%s::jsonb, artifacts=%s::jsonb, finished_at=NOW()
            WHERE lifecycle_run_id=%s AND status='running'
            RETURNING *
            """,
            (
                json.dumps(result["dataProvenance"]), json.dumps(result),
                json.dumps(result["events"]), json.dumps(result["artifacts"]),
                lifecycle_run_id,
            ),
        )
        completed = cursor.fetchone()
    if completed is None:
        raise TradingRuntimeError("trading_lifecycle_completion_receipt_missing")
    return _public_lifecycle_run(dict(completed))


def accept_trade_assignment(
    *, project_id: str, deck_id: str, card_id: str, source_run_id: str,
    plan: Any, idempotency_key: str,
) -> dict[str, Any]:
    normalized = normalize_trade_plan(plan)
    key = _text(idempotency_key, "idempotency_key", 160)
    source_run = _text(source_run_id, "source_run_id", 160)
    job_id = str(uuid4())
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            card = _current_trading_card(cursor, project_id, deck_id, card_id)
            cursor.execute(
                """
                SELECT COUNT(*) AS active_job_count
                FROM ag_catalog.trading_jobs
                WHERE project_id=%s AND deck_id=%s AND card_id=%s
                  AND state IN ('monitoring', 'paused')
                """,
                (project_id, deck_id, card_id),
            )
            active_job_count = int(cursor.fetchone()["active_job_count"])
            validate_plan_against_configuration(
                normalized, card["configuration"], active_job_count=active_job_count,
            )
            cursor.execute(
                """
                INSERT INTO ag_catalog.trading_jobs (
                  job_id, project_id, deck_id, card_id, card_revision_id,
                  source_run_id, idempotency_key, symbol, asset_class, plan,
                  state, current_action, execution_state, budget_ceiling_usd, max_loss_usd
                ) VALUES (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,
                  'monitoring','WAIT','blocked_pending_separate_approval',%s,%s
                )
                ON CONFLICT (project_id, deck_id, card_id, idempotency_key)
                DO UPDATE SET updated_at=ag_catalog.trading_jobs.updated_at
                RETURNING *
                """,
                (
                    job_id, project_id, deck_id, card_id, card["current_revision_id"],
                    source_run, key, normalized["instrument"]["symbol"],
                    normalized["assetClass"], json.dumps(normalized),
                    normalized["budgetCeilingUsd"], normalized["maxLossUsd"],
                ),
            )
            row = dict(cursor.fetchone())
        connection.commit()
    return _public_job(row)


def record_trade_decision(
    *, project_id: str, deck_id: str, card_id: str, source_run_id: str,
    job_id: str, action: str, rationale: str, confidence: Any,
    evidence: Any, missing_terms: Any, idempotency_key: str,
) -> dict[str, Any]:
    normalized_action = str(action or "").strip().upper()
    if normalized_action not in TRADE_ACTIONS:
        raise TradingRuntimeError("trading_decision_action_invalid")
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        raise TradingRuntimeError("trading_decision_confidence_invalid")
    if not isinstance(evidence, list) or len(evidence) > 64 or any(not isinstance(item, dict) for item in evidence):
        raise TradingRuntimeError("trading_decision_evidence_invalid")
    if not isinstance(missing_terms, list) or len(missing_terms) > 32 or any(
        not isinstance(item, str) or not item.strip() for item in missing_terms
    ):
        raise TradingRuntimeError("trading_decision_missing_terms_invalid")
    if normalized_action in {"ENTER", "HOLD", "REDUCE", "EXIT"} and missing_terms:
        raise TradingRuntimeError("trading_decision_missing_terms_fail_closed")
    normalized_job_id = str(UUID(_text(job_id, "job_id", 64)))
    decision_id = str(uuid4())
    key = _text(idempotency_key, "idempotency_key", 160)
    state = {
        "PAUSE": "paused", "FAIL_SAFE": "fail_safe", "EXIT": "completed",
    }.get(normalized_action, "monitoring")
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            _current_trading_card(cursor, project_id, deck_id, card_id)
            cursor.execute(
                """
                SELECT job_id FROM ag_catalog.trading_jobs
                WHERE job_id=%s AND project_id=%s AND deck_id=%s AND card_id=%s
                FOR UPDATE
                """,
                (normalized_job_id, project_id, deck_id, card_id),
            )
            if cursor.fetchone() is None:
                raise TradingRuntimeError("trading_job_not_found")
            cursor.execute(
                """
                INSERT INTO ag_catalog.trading_decisions (
                  decision_id, job_id, source_run_id, idempotency_key, action,
                  rationale, confidence, evidence, missing_terms, execution_requested
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,FALSE)
                ON CONFLICT (job_id, idempotency_key)
                DO UPDATE SET idempotency_key=ag_catalog.trading_decisions.idempotency_key
                RETURNING *
                """,
                (
                    decision_id, normalized_job_id, _text(source_run_id, "source_run_id", 160),
                    key, normalized_action, _text(rationale, "rationale", 8_000),
                    float(confidence), json.dumps(evidence),
                    json.dumps([item.strip() for item in missing_terms]),
                ),
            )
            decision = dict(cursor.fetchone())
            cursor.execute(
                """
                UPDATE ag_catalog.trading_jobs
                SET state=%s, current_action=%s, updated_at=NOW()
                WHERE job_id=%s
                RETURNING *
                """,
                (state, normalized_action, normalized_job_id),
            )
            job = dict(cursor.fetchone())
        connection.commit()
    return {"job": _public_job(job), "decision": _public_decision(decision)}


def intervene_trade_job(
    *, project_id: str, deck_id: str, card_id: str, job_id: str,
    action: str, reason: str, actor: str,
) -> dict[str, Any]:
    normalized_action = str(action or "").strip().upper()
    if normalized_action not in {"PAUSE", "RESUME"}:
        raise TradingRuntimeError("trading_intervention_action_invalid")
    raise TradingRuntimeError("trading_intervention_lifecycle_unavailable")


def read_trading_state(
    *, project_id: str, deck_id: str, card_id: str,
    timeframe: str = "5Min", selected_job_id: str | None = None,
) -> dict[str, Any]:
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        _current_trading_card(cursor, project_id, deck_id, card_id)
        cursor.execute(
            """
            SELECT * FROM ag_catalog.trading_lifecycle_runs
            WHERE project_id=%s AND deck_id=%s AND card_id=%s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (project_id, deck_id, card_id),
        )
        lifecycle_row = cursor.fetchone()
        lifecycle_proof = (
            _public_lifecycle_run(dict(lifecycle_row)) if lifecycle_row is not None else None
        )
        cursor.execute(
            """
            SELECT * FROM ag_catalog.trading_jobs
            WHERE project_id=%s AND deck_id=%s AND card_id=%s
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 100
            """,
            (project_id, deck_id, card_id),
        )
        jobs = [dict(row) for row in cursor.fetchall()]
        decisions: dict[str, list[dict[str, Any]]] = {str(row["job_id"]): [] for row in jobs}
        interventions: dict[str, list[dict[str, Any]]] = {
            str(row["job_id"]): [] for row in jobs
        }
        artifacts: dict[str, list[dict[str, Any]]] = {}
        source_runs: dict[str, dict[str, Any]] = {}
        if jobs:
            job_ids = [str(row["job_id"]) for row in jobs]
            cursor.execute(
                """
                SELECT decision.* FROM ag_catalog.trading_decisions AS decision
                WHERE decision.job_id = ANY(%s::uuid[])
                ORDER BY decision.created_at DESC
                """,
                (job_ids,),
            )
            for row in cursor.fetchall():
                decisions[str(row["job_id"])].append(_public_decision(dict(row)))
            cursor.execute(
                """
                SELECT * FROM ag_catalog.trading_interventions
                WHERE job_id = ANY(%s::uuid[])
                ORDER BY created_at DESC
                """,
                (job_ids,),
            )
            for row in cursor.fetchall():
                interventions[str(row["job_id"])].append(_public_intervention(dict(row)))
            run_ids = list(dict.fromkeys(
                str(row.get("source_run_id") or "") for row in jobs
                if str(row.get("source_run_id") or "")
            ))
            if run_ids:
                cursor.execute(
                    """
                    SELECT artifact_id, producing_run_id, artifact_kind, locator,
                           media_type, content_sha256, provenance_ref, size_bytes, created_at
                    FROM ag_catalog.run_artifacts
                    WHERE producing_run_id = ANY(%s::text[])
                    ORDER BY created_at DESC
                    """,
                    (run_ids,),
                )
                for row in cursor.fetchall():
                    run_id = str(row["producing_run_id"])
                    artifacts.setdefault(run_id, []).append(_public_artifact(dict(row)))
                cursor.execute(
                    """
                    SELECT run_id, state, started_at, finished_at, error_code, error_summary
                    FROM ag_catalog.agent_runs
                    WHERE run_id = ANY(%s::text[])
                    """,
                    (run_ids,),
                )
                source_runs = {str(row["run_id"]): dict(row) for row in cursor.fetchall()}

    broker_state = read_lumibot_paper_snapshot()
    market_by_symbol = _market_observations(jobs, timeframe, selected_job_id)
    account_orders = broker_state["orders"]
    account_positions = broker_state["positions"]
    public_jobs: list[dict[str, Any]] = []
    for row in jobs:
        job_id = str(row["job_id"])
        job_decisions = decisions.get(job_id, [])
        linked_client_order_ids = {
            deterministic_client_order_id(job_id, decision["decisionId"])
            for decision in job_decisions
        }
        linked_orders = [
            order for order in account_orders
            if order.get("clientOrderId") in linked_client_order_ids
        ]
        linked_position = next((
            position for position in account_positions
            if linked_orders and position.get("symbol") == str(row.get("symbol") or "").upper()
        ), None)
        fills = [
            {
                "fillId": f"{order['orderId']}:{order.get('filledAt') or order.get('updatedAt')}",
                "orderId": order["orderId"],
                "side": order.get("side"),
                "quantity": order.get("filledQuantity"),
                "price": order.get("averageFillPrice"),
                "timestamp": order.get("filledAt") or order.get("updatedAt"),
            }
            for order in linked_orders
            if (order.get("filledQuantity") or 0) > 0
            and order.get("averageFillPrice") is not None
        ]
        job_events = [
            {
                "eventId": decision["decisionId"],
                "kind": "decision",
                "source": "hermes",
                "action": decision["action"],
                "summary": decision["rationale"],
                "createdAt": decision["createdAt"],
            }
            for decision in job_decisions
        ] + [
            {
                "eventId": item["interventionId"],
                "kind": "intervention",
                "source": "user",
                "action": item["action"],
                "summary": item["reason"],
                "createdAt": item["createdAt"],
            }
            for item in interventions.get(job_id, [])
        ]
        source_run = source_runs.get(str(row.get("source_run_id") or ""))
        if source_run is not None:
            job_events.append({
                "eventId": f"run:{source_run['run_id']}:{source_run['state']}",
                "kind": "card_run",
                "source": "card",
                "action": source_run["state"],
                "summary": source_run.get("error_summary") or source_run.get("error_code")
                or f"Card Run {source_run['state']}",
                "createdAt": _iso_text(
                    source_run.get("finished_at") or source_run.get("started_at")
                ),
            })
        job_events.sort(key=lambda item: str(item.get("createdAt") or ""), reverse=True)
        symbol = str(row.get("symbol") or "").upper()
        market = market_by_symbol.get(symbol, {
            "status": "not_requested",
            "provider": "alpaca",
            "feed": None,
            "timeframe": timeframe,
            "fetchedAt": None,
            "observedAt": None,
            "freshness": None,
            "currentPrice": None,
            "bars": [],
            "diagnostics": "market evidence is loaded for active and selected jobs only",
        })
        public_jobs.append({
            **_public_job(row),
            "decisions": job_decisions,
            "interventions": interventions.get(job_id, []),
            "market": market,
            "position": linked_position,
            "orders": linked_orders,
            "fills": fills,
            "events": job_events,
            "artifacts": artifacts.get(str(row.get("source_run_id") or ""), []),
            "lifecycle": {
                "status": "broker_observed" if linked_orders else "not_attached",
                "diagnostics": None if linked_orders else (
                    "No deterministic broker order identity is linked to this Trade Job."
                ),
            },
        })
    realized = [float(row["realized_pnl_usd"]) for row in jobs if row.get("realized_pnl_usd") is not None]
    recorded_realized = sum(realized)
    return {
        "cardId": card_id,
        "paperOnly": True,
        "executionApproved": False,
        "timeframe": timeframe,
        "jobs": public_jobs,
        "portfolio": {
            **broker_state["account"],
            "realizedPnlUsd": recorded_realized,
            "recordedRealizedPnlUsd": recorded_realized,
            "wins": len([value for value in realized if value > 0]),
            "losses": len([value for value in realized if value < 0]),
            "flat": len([value for value in realized if value == 0]),
            "closedTrades": len(realized),
            "equityCurve": broker_state["equityCurve"],
        },
        "positions": account_positions,
        "connection": broker_state["connection"],
        "commands": {
            "pauseResume": {
                "available": False,
                "reason": "No approved LumiBot Trader lifecycle is running for this Card.",
            },
            "exit": {
                "available": False,
                "reason": "Paper order execution is blocked pending separate broker/risk approval.",
            },
            "cancel": {
                "available": False,
                "reason": "No approved broker cancellation command is registered for this Card.",
            },
        },
        "engine": lumibot_readiness(),
        "lifecycleProof": lifecycle_proof,
        "observedAt": _now(),
    }


def _public_job(row: dict[str, Any]) -> dict[str, Any]:
    plan = row.get("plan") if isinstance(row.get("plan"), dict) else json.loads(row.get("plan") or "{}")
    return {
        "jobId": str(row.get("job_id") or ""),
        "symbol": str(row.get("symbol") or ""),
        "assetClass": str(row.get("asset_class") or ""),
        "state": str(row.get("state") or ""),
        "action": str(row.get("current_action") or "WAIT"),
        "executionState": str(row.get("execution_state") or ""),
        "budgetCeilingUsd": float(row.get("budget_ceiling_usd") or 0),
        "maxLossUsd": float(row.get("max_loss_usd") or 0),
        "realizedPnlUsd": (
            float(row["realized_pnl_usd"]) if row.get("realized_pnl_usd") is not None else None
        ),
        "plan": plan,
        "sourceRunId": str(row.get("source_run_id") or ""),
        "createdAt": str(row.get("created_at") or ""),
        "updatedAt": str(row.get("updated_at") or ""),
    }


def _public_decision(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "decisionId": str(row.get("decision_id") or ""),
        "action": str(row.get("action") or ""),
        "rationale": str(row.get("rationale") or ""),
        "confidence": float(row.get("confidence") or 0),
        "evidence": row.get("evidence") or [],
        "missingTerms": row.get("missing_terms") or [],
        "executionRequested": row.get("execution_requested") is True,
        "sourceRunId": str(row.get("source_run_id") or ""),
        "createdAt": str(row.get("created_at") or ""),
    }


def _public_intervention(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "interventionId": str(row.get("intervention_id") or ""),
        "action": str(row.get("action") or ""),
        "reason": str(row.get("reason") or ""),
        "actor": str(row.get("actor") or ""),
        "createdAt": str(row.get("created_at") or ""),
    }


def _public_artifact(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "artifactId": str(row.get("artifact_id") or ""),
        "kind": str(row.get("artifact_kind") or ""),
        "locator": str(row.get("locator") or ""),
        "mediaType": row.get("media_type"),
        "contentSha256": row.get("content_sha256"),
        "provenanceRef": row.get("provenance_ref"),
        "sizeBytes": row.get("size_bytes"),
        "createdAt": str(row.get("created_at") or ""),
    }
