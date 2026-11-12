"""Allocation policy validation and non-authorizing account projections."""
# Entity: Trading
# Relationship: Tests user allocation constraints, exact holding assignments and the separation of observed funds, reservations and expected proceeds.

from copy import deepcopy

import pytest

from app.python_models.portfolio_policy import DEFAULT_POLICY, allocation_view, normalize_allocation_policy, policy_hash
from app.python_models.trading_contract import TradingBoundaryError, normalize_trading_configuration
from app.python_models.test_trading import _configuration
from app.python_models.saved_card_contract import CardDomainError, stable_card_record, validate_new_card_revision


def broker(**account):
    return {"connection": {"status": "available", "mode": "paper"},
            "account": {"portfolioValueUsd": 100000, "cashUsd": 75000, "buyingPowerUsd": 150000, **account},
            "positions": [{"instrumentId": "RDW", "symbol": "RDW", "marketValueUsd": 25000, "side": "long"}]}


def policy():
    result = deepcopy(DEFAULT_POLICY)
    result["positionCategories"] = {"RDW": "core"}
    result["minimumLiquidReservePercent"] = 15
    return result


def test_initial_preset_is_research_target_not_execution_or_saved_risk_override():
    value = normalize_allocation_policy()
    assert sum(row["targetPercent"] for row in value["categories"]) == 100
    assert value["categories"][0]["id"] == "options"
    assert value["categories"][0]["targetPercent"] == 25
    original = _configuration()
    normalized = normalize_trading_configuration(original)
    configured = deepcopy(original)
    configured["trading"]["allocationPolicy"] = value
    actual = normalize_trading_configuration(configured)
    assert actual["trading"].pop("allocationPolicy") == value
    assert actual == normalized
    assert actual["trading"]["executionApproved"] is False
    value["categories"][0]["targetPercent"] = 0
    assert normalize_allocation_policy()["categories"][0]["targetPercent"] == 25


def test_card_revision_rejects_invalid_policy_before_persistence_but_old_revision_remains_readable():
    configuration = _configuration()
    configuration["trading"]["allocationPolicy"] = policy()
    card = {"id": "trader", "templateId": "trading", "title": "Trader", "kind": "agent",
            "runtime": {"kind": "hermes", "mode": "delegate", "profile": "trading"},
            "runtimeOptions": {"provider": "openai", "accessMode": "chatgpt-account", "modelKey": "gpt-6.1-sol",
                               "configuration": configuration}}
    validate_new_card_revision(card)
    configuration["trading"]["allocationPolicy"]["categories"][0]["targetPercent"] = 99
    with pytest.raises(CardDomainError, match="targets_must_total_100"):
        validate_new_card_revision(card)
    assert stable_card_record(card)["runtimeExtensions"]["configuration"] == configuration


@pytest.mark.parametrize("change", [
    lambda p: p["categories"][0].update(targetPercent=30),
    lambda p: p["categories"][0].update(maximumPercent=24),
    lambda p: p["categories"][0].update(minimumPercent=26),
    lambda p: p["categories"][0].update(maximumRiskPercent=float("nan")),
    lambda p: p["categories"][0].update(id=[]),
    lambda p: p.update(maximumPositionLossPercent=True),
    lambda p: p.update(minimumLiquidReservePercent=-1),
    lambda p: p.update(positionCategories={"RDW": []}),
    lambda p: p.update(positionCategories={"RDW": "cash"}),
    lambda p: p.update(permittedInstrumentTypes=["equity", "equity"]),
    lambda p: p.update(extra=True),
    lambda p: p.update(preset=[]),
])
def test_invalid_user_policy_is_rejected_not_repaired_silently(change):
    value = policy()
    change(value)
    with pytest.raises(TradingBoundaryError):
        normalize_allocation_policy(value)


def test_observed_capital_and_category_room_never_include_expected_proceeds():
    result = allocation_view(policy(), broker(), reserved_capital=5000, expected_proceeds=20000)
    assert result["availableUnreservedCashUsd"] == 55000
    assert result["expectedExitProceedsUsd"] == 20000
    assert result["settledCashUsd"] is None
    assert result["brokerBuyingPowerUsd"] == 150000
    core = next(row for row in result["categories"] if row["id"] == "core")
    assert core["currentPercent"] == 25
    assert core["targetHeadroomUsd"] == 10000
    assert result["allocationComplete"] is True
    assert result["executionAuthorized"] is False
    assert result["policyHash"] == policy_hash(policy())


def test_missing_buying_power_is_not_invented_from_cash():
    result = allocation_view(policy(), broker(buyingPowerUsd=None), reserved_capital=0)
    assert result["availableUnreservedCashUsd"] is None
    assert result["reportedCashUsd"] == 75000


def test_unassigned_or_unvalued_positions_do_not_turn_into_headroom():
    value = policy()
    value["positionCategories"] = {}
    result = allocation_view(value, broker(), reserved_capital=0)
    assert result["unassignedPositions"] == ["RDW"]
    assert all(row["maximumHeadroomUsd"] is None for row in result["categories"])
    snapshot = broker()
    snapshot["positions"][0]["marketValueUsd"] = None
    result = allocation_view(policy(), snapshot, reserved_capital=0)
    assert result["positionsWithMissingValue"] == ["RDW"]
    assert result["unassignedValueUsd"] is None
    assert result["allocationComplete"] is False


def test_short_market_value_is_not_treated_as_freed_capital_or_long_only_allocation():
    snapshot = broker()
    snapshot["positions"][0].update(marketValueUsd=-25000, side="short")
    result = allocation_view(policy(), snapshot, reserved_capital=0)
    assert result["shortPositions"] == ["RDW"]
    assert result["allocationComplete"] is False
    assert all(row["maximumHeadroomUsd"] is None for row in result["categories"])


def test_unavailable_broker_never_projects_empty_holdings_as_measured_zero():
    snapshot = broker()
    snapshot["connection"]["status"] = "provider_error"
    snapshot["positions"] = []
    result = allocation_view(policy(), snapshot, reserved_capital=0)
    assert result["portfolioValueUsd"] is None
    assert result["availableUnreservedCashUsd"] is None
    assert result["allocationComplete"] is False
    assert all(row["currentValueUsd"] is None for row in result["categories"])
