"""User-owned allocation policy, separate from holdings and execution permission."""
# Entity: Trading
# Relationship: Validates Investment Category targets and risk limits, computes observed allocation headroom, and compares explicit candidate capital and loss bounds with that same policy without authorizing execution.

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import math
from typing import Any

from app.python_models.trading_contract import TradingBoundaryError

CATEGORIES = {
    "options": "Options", "day_trading": "Day Trading", "swing_trading": "Swing Trading",
    "microcaps": "Microcaps", "core": "Core Investments", "defensive": "Bonds / Defensive Investments",
    "crypto": "Crypto", "prediction_markets": "Prediction Markets", "cash": "Cash / Liquid Reserves",
}
_TARGETS = {"options": 25, "day_trading": 0, "swing_trading": 10, "microcaps": 5,
            "core": 35, "defensive": 10, "crypto": 0, "prediction_markets": 0, "cash": 15}
INSTRUMENT_TYPES = frozenset({"equity", "etf", "option", "bond", "future", "forex", "crypto", "prediction_market", "cash"})
DEFAULT_POLICY = {
    "schemaVersion": "portfolio.policy.v1", "preset": "High Options",
    "categories": [{"id": key, "targetPercent": _TARGETS[key], "minimumPercent": 0,
                    "maximumPercent": 100, "maximumRiskPercent": None} for key in CATEGORIES],
    "positionCategories": {}, "permittedInstrumentTypes": ["equity", "etf", "option"],
    "minimumLiquidReservePercent": 0, "maximumPositionLossPercent": None,
    "maximumPositionWeightPercent": None,
}


def _percent(value: Any, name: str, *, nullable=False):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 100:
        raise TradingBoundaryError("portfolio_policy_" + name + "_invalid")
    return float(value)


def normalize_allocation_policy(value: Any = None) -> dict:
    if value is None:
        return deepcopy(DEFAULT_POLICY)
    if not isinstance(value, dict) or set(value) != set(DEFAULT_POLICY) or value.get("schemaVersion") != "portfolio.policy.v1":
        raise TradingBoundaryError("portfolio_policy_fields_invalid")
    if not isinstance(value["preset"], str) or value["preset"] not in {"High Options", "Custom"}:
        raise TradingBoundaryError("portfolio_policy_preset_invalid")
    rows = value["categories"]
    if not isinstance(rows, list) or len(rows) != len(CATEGORIES):
        raise TradingBoundaryError("portfolio_policy_categories_invalid")
    categories = {}
    for row in rows:
        if (not isinstance(row, dict) or set(row) != {"id", "targetPercent", "minimumPercent", "maximumPercent", "maximumRiskPercent"}
                or not isinstance(row["id"], str) or row["id"] not in CATEGORIES or row["id"] in categories):
            raise TradingBoundaryError("portfolio_policy_category_invalid")
        parsed = {"id": row["id"], **{field: _percent(row[field], field, nullable=field == "maximumRiskPercent")
                                       for field in ("targetPercent", "minimumPercent", "maximumPercent", "maximumRiskPercent")}}
        if not parsed["minimumPercent"] <= parsed["targetPercent"] <= parsed["maximumPercent"]:
            raise TradingBoundaryError("portfolio_policy_target_outside_limits")
        categories[row["id"]] = parsed
    if abs(sum(row["targetPercent"] for row in categories.values()) - 100) > 1e-6:
        raise TradingBoundaryError("portfolio_policy_targets_must_total_100")
    assignments = value["positionCategories"]
    if (not isinstance(assignments, dict) or len(assignments) > 200 or any(
            not isinstance(key, str) or not key.strip() or key != key.strip() or len(key) > 160
            or not isinstance(category, str) or category not in CATEGORIES or category == "cash" for key, category in assignments.items())):
        raise TradingBoundaryError("portfolio_policy_position_categories_invalid")
    allowed = value["permittedInstrumentTypes"]
    if (not isinstance(allowed, list) or not allowed or any(not isinstance(item, str) or item not in INSTRUMENT_TYPES for item in allowed)
            or len(allowed) != len(set(allowed))):
        raise TradingBoundaryError("portfolio_policy_instrument_types_invalid")
    reserve = _percent(value["minimumLiquidReservePercent"], "minimumLiquidReservePercent")
    if reserve > categories["cash"]["maximumPercent"]:
        raise TradingBoundaryError("portfolio_policy_reserve_exceeds_cash_limit")
    return {"schemaVersion": "portfolio.policy.v1", "preset": value["preset"],
            "categories": [categories[key] for key in CATEGORIES], "positionCategories": dict(assignments),
            "permittedInstrumentTypes": list(allowed), "minimumLiquidReservePercent": reserve,
            "maximumPositionLossPercent": _percent(value["maximumPositionLossPercent"], "maximumPositionLossPercent", nullable=True),
            "maximumPositionWeightPercent": _percent(value["maximumPositionWeightPercent"], "maximumPositionWeightPercent", nullable=True)}


def policy_hash(policy: dict) -> str:
    return hashlib.sha256(json.dumps(normalize_allocation_policy(policy), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def allocation_view(policy: dict, broker: dict, *, reserved_capital: float, expected_proceeds: float | None = None) -> dict:
    policy = normalize_allocation_policy(policy)
    account = broker.get("account") or {}
    positions = broker.get("positions") or []
    equity, cash, buying_power = (account.get(key) for key in ("portfolioValueUsd", "cashUsd", "buyingPowerUsd"))
    def number(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    if not number(reserved_capital) or reserved_capital < 0:
        raise TradingBoundaryError("portfolio_reserved_capital_invalid")
    if expected_proceeds is not None and (not number(expected_proceeds) or expected_proceeds < 0):
        raise TradingBoundaryError("portfolio_expected_proceeds_invalid")
    observed = broker.get("connection", {}).get("status") == "available"
    equity, cash, buying_power = (value if observed and number(value) else None for value in (equity, cash, buying_power))
    usable_equity = number(equity) and equity > 0
    classified = {key: 0.0 if observed else None for key in CATEGORIES}
    classified["cash"] = cash if number(cash) else None
    unknown_value, unknown_positions = 0.0, []
    incomplete_positions, short_positions = [], []
    for position in positions:
        instrument = str(position.get("instrumentId") or position.get("symbol") or "")
        category = policy["positionCategories"].get(instrument)
        amount = position.get("marketValueUsd")
        if position.get("side") == "short" or (number(amount) and amount < 0):
            short_positions.append(instrument)
        if not number(amount):
            incomplete_positions.append(instrument)
            if category:
                classified[category] = None
            continue
        if not category:
            unknown_value += amount
            unknown_positions.append(instrument)
        elif classified[category] is not None:
            classified[category] += amount
    reserve_requirement = equity * policy["minimumLiquidReservePercent"] / 100 if usable_equity else None
    available = (max(0.0, min(cash - reserve_requirement, buying_power) - reserved_capital)
                 if usable_equity and number(cash) and number(buying_power) else None)
    reconciled = (usable_equity and not incomplete_positions and not unknown_positions and not short_positions
                  and all(number(value) and value >= 0 for value in classified.values())
                  and abs(sum(classified.values()) - equity) <= max(1.0, equity * 0.0001))
    rows = []
    # Unknown classifications remain unknown, never guessed from ticker or prose.
    for target in policy["categories"]:
        key = target["id"]
        amount = classified[key]
        allocation_known = bool(reconciled and number(amount))
        current_percent = amount / equity * 100 if usable_equity and number(amount) else None
        rows.append({**target, "name": CATEGORIES[key], "currentValueUsd": amount,
            "currentPercent": current_percent, "targetValueUsd": equity * target["targetPercent"] / 100 if usable_equity else None,
            "maximumHeadroomUsd": max(0, equity * target["maximumPercent"] / 100 - amount) if allocation_known else None,
            "targetHeadroomUsd": max(0, equity * target["targetPercent"] / 100 - amount) if allocation_known else None})
    return {"policy": policy, "policyHash": policy_hash(policy), "categories": rows,
            "portfolioValueUsd": equity, "reportedCashUsd": cash,
            "settledCashUsd": account.get("settledCashUsd"), "brokerBuyingPowerUsd": buying_power,
            "reservedCapitalUsd": reserved_capital, "expectedExitProceedsUsd": expected_proceeds,
            "minimumLiquidReserveUsd": reserve_requirement, "availableUnreservedCashUsd": available,
            "unassignedValueUsd": unknown_value if observed and not incomplete_positions else None,
            "unassignedPositions": unknown_positions, "positionsWithMissingValue": incomplete_positions,
            "shortPositions": short_positions, "allocationComplete": bool(observed and reconciled),
            "executionAuthorized": False, "connection": broker.get("connection"),
            "limitations": ["Targets are preferences, not investments or permitted losses.",
                            "Expected proceeds are not included in available capital.",
                            "Category values are signed market values, not margin requirements or maximum losses; short exposure prevents a long-only allocation pie/headroom estimate.",
                            "Research headroom is not order authorization; refresh broker state and risk evidence before an entry.",
                            "Cash is not labeled settled unless the provider explicitly supplies that fact."]}


def proposal_portfolio_effect(proposal: Any, terms: dict, portfolio: dict, lane: str) -> dict:
    """Incremental cash/weight/loss analysis; never substitutes for a full-book risk model."""
    if lane not in CATEGORIES or lane == "cash":
        raise TradingBoundaryError("portfolio_allocation_lane_invalid")
    allocation = portfolio["allocation"]
    policy = allocation["policy"]
    category = next(row for row in allocation["categories"] if row["id"] == lane)
    equity = allocation["portfolioValueUsd"]
    observed = allocation["allocationComplete"] and isinstance(equity, (int, float)) and equity > 0
    supported = proposal.market == "US" and proposal.asset_class in {"equity", "option"}
    price, cost = terms.get("entry_price"), terms.get("cost_assumption")
    units = proposal.quantity * (proposal.option.multiplier if proposal.option else 1)
    capital = (price * units + cost if supported and proposal.side == "long"
               and price is not None and cost is not None else None)
    loss = (terms.get("maximum_loss") or {}).get("including_assumed_costs") if supported else None
    held = [row for row in portfolio["positions"] if row.get("instrumentId") == proposal.instrument_identifier]
    existing_value = sum(row["marketValueUsd"] for row in held) if observed else None
    new_weight = ((existing_value + capital) / equity * 100
                  if observed and capital is not None else None)
    loss_percent = loss / equity * 100 if observed and loss is not None else None
    cash = allocation["availableUnreservedCashUsd"]
    target = category["targetHeadroomUsd"]
    headroom = category["maximumHeadroomUsd"]
    checks = {
        "savedPolicy": allocation["policySaved"],
        "reconciledHoldings": bool(observed),
        "permittedInstrument": proposal.asset_class in policy["permittedInstrumentTypes"],
        "unreservedCash": capital <= cash if capital is not None and cash is not None else None,
        "categoryMaximum": capital <= headroom if capital is not None and headroom is not None else None,
        "positionWeight": new_weight <= policy["maximumPositionWeightPercent"]
            if new_weight is not None and policy["maximumPositionWeightPercent"] is not None else None,
        "positionLoss": loss_percent <= policy["maximumPositionLossPercent"]
            if loss_percent is not None and policy["maximumPositionLossPercent"] is not None else None,
        "candidateCategoryLoss": loss_percent <= category["maximumRiskPercent"]
            if loss_percent is not None and category["maximumRiskPercent"] is not None else None,
    }
    return {"allocationLane": lane, "instrumentId": proposal.instrument_identifier,
            "status": "limit_exceeded_or_unapproved" if any(value is False for value in checks.values())
                else "incomplete" if any(value is None for value in checks.values()) else "within_checked_limits",
            "incrementalCapitalUsd": capital, "maximumLossUsd": loss,
            "maximumLossPercentOfEquity": loss_percent, "resultingInstrumentWeightPercent": new_weight,
            "existingInstrumentValueUsd": existing_value,
            "withinTargetHeadroom": capital <= target if capital is not None and target is not None else None,
            "checks": checks, "executionAuthorized": False,
            "limitations": [
                "Current broker snapshot and saved policy, compared with the proposal's retained quote; refresh quotes before a decision.",
                "Targets are preferences, not entry requirements. WAIT leaves the observed portfolio unchanged.",
                "Cash uses reported cash minus reserves and reservations; it is not proof of settled cash or executable liquidity.",
                "Short-position collateral and non-US currency conversion are not inferred.",
                "Existing holdings' maximum loss, correlation, Greeks, sector exposure and hedge effectiveness are not established by weight checks.",
                "Candidate category-loss check excludes other positions' risk; it is not a whole-category risk pass.",
            ]}
