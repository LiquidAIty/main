"""Fail-closed contracts for the paper-only Trading Card boundary."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from typing import Any
from uuid import UUID


TRADE_ACTIONS = ("WAIT", "ENTER", "HOLD", "REDUCE", "EXIT", "PAUSE", "FAIL_SAFE")
_DIRECTIONS = frozenset({"long", "short"})
_ORDER_TYPES = frozenset({"market", "limit", "stop", "stop_limit"})
_REQUIRED_PLAN_FIELDS = frozenset({
    "instrument", "assetClass", "allowedDirections", "budgetCeilingUsd",
    "maxLossUsd", "expectedRiskReward", "entryConditions", "exitConditions", "stopConditions",
    "invalidationConditions", "horizon", "expiresAt", "allowedOrderTypes",
    "dataRequirements", "executionPolicy", "origin",
})
MARKET_TIMEFRAMES = frozenset({"1Min", "5Min", "15Min", "1Hour", "1Day"})


class TradingBoundaryError(ValueError):
    """Typed fail-closed error from the deterministic trading boundary."""


def utc_now_text() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def required_trade_text(value: Any, field: str, limit: int = 2_000) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TradingBoundaryError(f"trade_plan_{field}_required")
    result = value.strip()
    if len(result) > limit:
        raise TradingBoundaryError(f"trade_plan_{field}_too_long")
    return result


def _positive_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise TradingBoundaryError(f"trade_plan_{field}_positive_number_required")
    return float(value)


def _text_list(
    value: Any,
    field: str,
    *,
    allowed: frozenset[str] | None = None,
) -> list[str]:
    if not isinstance(value, list) or not value or len(value) > 32:
        raise TradingBoundaryError(f"trade_plan_{field}_nonempty_list_required")
    result = list(dict.fromkeys(required_trade_text(item, field, 500).lower() for item in value))
    if allowed is not None and any(item not in allowed for item in result):
        raise TradingBoundaryError(f"trade_plan_{field}_unsupported")
    return result


def normalize_trade_plan(value: Any) -> dict[str, Any]:
    """Validate every execution term; missing or extra terms never get invented."""

    if not isinstance(value, dict):
        raise TradingBoundaryError("trade_plan_object_required")
    missing = sorted(_REQUIRED_PLAN_FIELDS - set(value))
    extra = sorted(set(value) - _REQUIRED_PLAN_FIELDS)
    if missing:
        raise TradingBoundaryError(f"trade_plan_missing_terms:{','.join(missing)}")
    if extra:
        raise TradingBoundaryError(f"trade_plan_unknown_terms:{','.join(extra)}")
    instrument = value["instrument"]
    if not isinstance(instrument, dict) or set(instrument) != {"symbol", "venue"}:
        raise TradingBoundaryError("trade_plan_instrument_invalid")
    origin = value["origin"]
    if not isinstance(origin, dict) or set(origin) != {"kind", "id"}:
        raise TradingBoundaryError("trade_plan_origin_invalid")
    expires_at = required_trade_text(value["expiresAt"], "expires_at", 80)
    try:
        parsed_expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise TradingBoundaryError("trade_plan_expires_at_invalid") from error
    if parsed_expiry.tzinfo is None:
        raise TradingBoundaryError("trade_plan_expires_at_timezone_required")
    budget = _positive_number(value["budgetCeilingUsd"], "budget_ceiling_usd")
    max_loss = _positive_number(value["maxLossUsd"], "max_loss_usd")
    if max_loss > budget:
        raise TradingBoundaryError("trade_plan_max_loss_exceeds_budget")
    return {
        "instrument": {
            "symbol": required_trade_text(instrument["symbol"], "instrument_symbol", 32).upper(),
            "venue": required_trade_text(instrument["venue"], "instrument_venue", 40).upper(),
        },
        "assetClass": required_trade_text(value["assetClass"], "asset_class", 40).lower(),
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
        "horizon": required_trade_text(value["horizon"], "horizon", 160),
        "expiresAt": parsed_expiry.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "allowedOrderTypes": _text_list(
            value["allowedOrderTypes"], "allowed_order_types", allowed=_ORDER_TYPES,
        ),
        "dataRequirements": _text_list(value["dataRequirements"], "data_requirements"),
        "executionPolicy": required_trade_text(value["executionPolicy"], "execution_policy", 4_000),
        "origin": {
            "kind": required_trade_text(origin["kind"], "origin_kind", 80),
            "id": required_trade_text(origin["id"], "origin_id", 160),
        },
    }


def normalize_trading_configuration(value: Any) -> dict[str, Any]:
    """Validate the card-owned slider/select configuration without filling omissions."""

    if not isinstance(value, dict) or set(value) != {"schemaVersion", "trading"}:
        raise TradingBoundaryError("trading_configuration_invalid")
    if value.get("schemaVersion") != "trading.card.v1" or not isinstance(value.get("trading"), dict):
        raise TradingBoundaryError("trading_configuration_schema_invalid")
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
        raise TradingBoundaryError("trading_configuration_fields_invalid")
    if settings["paperOnly"] is not True or settings["executionApproved"] is not False:
        raise TradingBoundaryError("trading_execution_must_remain_unapproved_paper_only")
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
            raise TradingBoundaryError(f"trading_configuration_{field}_invalid")
        normalized[field] = int(raw) if field in {
            "maxConcurrentJobs", "maxOpenPositions", "evaluationCadenceSeconds",
            "heartbeatSeconds", "failSafeCooldownMinutes", "staleDataSeconds",
            "chartWindowBars", "compactChartHeightPx",
        } else float(raw)
    default_timeframe = settings.get("defaultTimeframe", optional_defaults["defaultTimeframe"])
    if default_timeframe not in MARKET_TIMEFRAMES:
        raise TradingBoundaryError("trading_configuration_defaultTimeframe_invalid")
    normalized["defaultTimeframe"] = default_timeframe
    broker_ref = settings.get("brokerConnectionRef", optional_defaults["brokerConnectionRef"])
    if broker_ref != "alpaca-paper":
        raise TradingBoundaryError("trading_configuration_brokerConnectionRef_invalid")
    normalized["brokerConnectionRef"] = broker_ref
    market_session = settings.get("marketSession", optional_defaults["marketSession"])
    if market_session not in {"regular", "extended"}:
        raise TradingBoundaryError("trading_configuration_marketSession_invalid")
    normalized["marketSession"] = market_session
    strategy_parameters = settings.get("strategyParameters", optional_defaults["strategyParameters"])
    if (
        not isinstance(strategy_parameters, dict)
        or len(strategy_parameters) > 64
        or len(json.dumps(strategy_parameters, ensure_ascii=False)) > 20_000
        or any(not isinstance(key, str) or not key.strip() for key in strategy_parameters)
        or any(not isinstance(item, (str, int, float, bool)) for item in strategy_parameters.values())
    ):
        raise TradingBoundaryError("trading_configuration_strategyParameters_invalid")
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
        raise TradingBoundaryError("trading_risk_configuration_incomplete")
    if active_job_count >= settings["maxConcurrentJobs"]:
        raise TradingBoundaryError("trading_max_concurrent_jobs_reached")
    per_job_budget = settings["paperBudgetUsd"] * settings["allocationPerJobPercent"] / 100
    if plan["budgetCeilingUsd"] > per_job_budget:
        raise TradingBoundaryError("trade_plan_budget_exceeds_card_allocation")
    per_plan_loss = plan["budgetCeilingUsd"] * settings["maxPlanLossPercent"] / 100
    if plan["maxLossUsd"] > per_plan_loss:
        raise TradingBoundaryError("trade_plan_loss_exceeds_card_risk")
    if plan["expectedRiskReward"] < settings["minimumRiskReward"]:
        raise TradingBoundaryError("trade_plan_risk_reward_below_card_minimum")
    expiry = datetime.fromisoformat(str(plan["expiresAt"]).replace("Z", "+00:00"))
    if expiry <= datetime.now(timezone.utc):
        raise TradingBoundaryError("trade_plan_expired")


def deterministic_client_order_id(job_id: str, decision_id: str) -> str:
    """Create a stable future paper-order id without submitting an order."""

    try:
        UUID(job_id)
        UUID(decision_id)
    except (TypeError, ValueError) as error:
        raise TradingBoundaryError("trading_order_identity_invalid") from error
    digest = hashlib.sha256(f"{job_id}:{decision_id}".encode("utf-8")).hexdigest()[:24]
    return f"paper-{digest}"


def optional_iso_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        value = value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    text = str(value).strip()
    return text or None
