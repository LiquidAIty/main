# Entity: Trading
# Relationship: Verifies deterministic paper-only plans, risk gates, order identity, public LumiBot projection, saved Card qualification, Card Script access, and intervention refusal through controlled fixtures.

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import sys
from uuid import uuid4

import pytest

from app.python_models import trading_forecast
from app.python_models.card_script import compile_card_script
from app.python_models.trading_broker_observation import read_lumibot_paper_snapshot
from app.python_models.trading_contract import (
    TradingBoundaryError,
    deterministic_client_order_id,
    normalize_trade_plan,
    normalize_trading_configuration,
    validate_plan_against_configuration,
)
from app.python_models.trading_jobs import intervene_trade_job, require_trading_card


def _plan() -> dict:
    return {
        "instrument": {"symbol": "rdw", "venue": "nyse"},
        "assetClass": "equity",
        "allowedDirections": ["long"],
        "budgetCeilingUsd": 10_000,
        "maxLossUsd": 250,
        "expectedRiskReward": 2.5,
        "entryConditions": ["Signal Packet confirms the approved catalyst."],
        "exitConditions": ["Approved target is reached."],
        "stopConditions": ["Approved stop level is reached."],
        "invalidationConditions": ["The cited catalyst is invalidated."],
        "horizon": "Up to five trading days.",
        "expiresAt": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
        "allowedOrderTypes": ["limit", "stop"],
        "dataRequirements": ["Fresh Alpaca IEX quote", "WorldSignals packet"],
        "executionPolicy": "No order. Journal a typed decision only.",
        "origin": {"kind": "main", "id": "run-123"},
    }


def _configuration() -> dict:
    return {
        "schemaVersion": "trading.card.v1",
        "trading": {
            "paperOnly": True,
            "executionApproved": False,
            "paperBudgetUsd": 0,
            "allocationPerJobPercent": 0,
            "maxConcurrentJobs": 3,
            "maxOpenPositions": 0,
            "maxPlanLossPercent": 0,
            "maxDailyLossPercent": 0,
            "minimumConfidencePercent": 70,
            "minimumRiskReward": 2,
            "evaluationCadenceSeconds": 60,
            "staleDataSeconds": 90,
        },
    }


def test_trade_plan_requires_every_execution_term_without_defaults() -> None:
    plan = _plan()
    del plan["stopConditions"]

    with pytest.raises(TradingBoundaryError, match="trade_plan_missing_terms:stopConditions"):
        normalize_trade_plan(plan)


def test_trade_plan_normalizes_only_explicit_valid_terms() -> None:
    result = normalize_trade_plan(_plan())

    assert result["instrument"] == {"symbol": "RDW", "venue": "NYSE"}
    assert result["allowedDirections"] == ["long"]
    assert result["budgetCeilingUsd"] == 10_000
    assert result["maxLossUsd"] == 250


def test_trading_configuration_is_paper_only_and_execution_unapproved() -> None:
    normalized = normalize_trading_configuration(_configuration())
    assert normalized["trading"]["paperOnly"] is True
    assert normalized["trading"]["executionApproved"] is False
    assert normalized["trading"]["maxPortfolioDrawdownPercent"] == 0
    assert normalized["trading"]["defaultTimeframe"] == "5Min"
    assert normalized["trading"]["brokerConnectionRef"] == "alpaca-paper"
    unsafe = _configuration()
    unsafe["trading"]["executionApproved"] = True

    with pytest.raises(
        TradingBoundaryError,
        match="trading_execution_must_remain_unapproved_paper_only",
    ):
        normalize_trading_configuration(unsafe)


def test_plan_is_rejected_when_card_risk_is_incomplete_or_exceeded() -> None:
    plan = normalize_trade_plan(_plan())
    with pytest.raises(TradingBoundaryError, match="risk_configuration_incomplete"):
        validate_plan_against_configuration(plan, _configuration(), active_job_count=0)

    ready = _configuration()
    ready["trading"].update({
        "paperBudgetUsd": 100_000,
        "allocationPerJobPercent": 10,
        "maxOpenPositions": 4,
        "maxPlanLossPercent": 2,
        "maxDailyLossPercent": 4,
        "maxPortfolioDrawdownPercent": 10,
        "defaultStopLossPercent": 2,
    })
    with pytest.raises(TradingBoundaryError, match="loss_exceeds_card_risk"):
        validate_plan_against_configuration(plan, ready, active_job_count=0)
    plan["maxLossUsd"] = 100
    validate_plan_against_configuration(plan, ready, active_job_count=0)


def test_plan_respects_concurrency_and_minimum_risk_reward() -> None:
    ready = _configuration()
    ready["trading"].update({
        "paperBudgetUsd": 100_000,
        "allocationPerJobPercent": 10,
        "maxOpenPositions": 4,
        "maxPlanLossPercent": 5,
        "maxDailyLossPercent": 4,
        "maxPortfolioDrawdownPercent": 10,
        "defaultStopLossPercent": 2,
        "minimumRiskReward": 3,
    })
    plan = normalize_trade_plan(_plan())
    with pytest.raises(TradingBoundaryError, match="risk_reward_below"):
        validate_plan_against_configuration(plan, ready, active_job_count=0)
    plan["expectedRiskReward"] = 3
    with pytest.raises(TradingBoundaryError, match="max_concurrent_jobs"):
        validate_plan_against_configuration(plan, ready, active_job_count=3)


def test_future_paper_order_identity_is_deterministic_but_places_nothing() -> None:
    job_id = str(uuid4())
    decision_id = str(uuid4())

    first = deterministic_client_order_id(job_id, decision_id)
    second = deterministic_client_order_id(job_id, decision_id)

    assert first == second
    assert first.startswith("paper-")
    assert len(first) == 30


def _portfolio_history(history_filter):
    from alpaca.trading.requests import GetPortfolioHistoryRequest
    assert isinstance(history_filter, GetPortfolioHistoryRequest)
    assert history_filter.period == "12M" and history_filter.timeframe == "1D"
    return SimpleNamespace(timestamp=[1788220800, 1788307200], equity=[100000, 100250])


class _PublicObserver:
    broker = SimpleNamespace(
        api=SimpleNamespace(
            get_account=lambda: SimpleNamespace(equity="100250", cash="90000", buying_power="180000", status="ACTIVE"),
            get_portfolio_history=_portfolio_history,
            get_all_positions=lambda: [SimpleNamespace(symbol="RDW", asset_class="us_equity", side="long", qty="25",
                avg_entry_price="10", current_price="11", market_value="275", unrealized_pl="25")],
        ),
    )

    @staticmethod
    def get_orders():
        return [SimpleNamespace(
            identifier="paper-order-1", asset=SimpleNamespace(symbol="RDW"),
            side="buy", quantity=25, filled_quantity=25, order_type="limit",
            status="fill", limit_price=10, stop_price=None, avg_fill_price=10,
            date_created="2026-09-01T00:00:00Z", broker_update_date="2026-09-01T00:01:00Z",
            filled_at="2026-09-01T00:01:00Z",
        )]


def test_snapshot_uses_only_public_lumibot_observer_contract() -> None:
    snapshot = read_lumibot_paper_snapshot(observer=_PublicObserver())

    assert snapshot["connection"]["status"] == "available"
    assert snapshot["account"]["portfolioValueUsd"] == 100_250
    assert snapshot["account"]["dailyEquityChangeUsd"] == 250
    assert snapshot["account"]["dailyPnlUsd"] is None  # Cash flows are not reconciled trade P&L.
    assert snapshot["positions"][0]["symbol"] == "RDW"
    assert snapshot["orders"][0]["orderId"] == "paper-order-1"
    assert snapshot["account"]["buyingPowerUsd"] == 180_000
    assert snapshot["account"]["settledCashUsd"] is None
    assert snapshot["positions"][0]["marketValueUsd"] == 275
    assert snapshot["positions"][0]["instrumentId"] == "RDW"


def test_broker_projection_preserves_exact_option_identity_and_unknown_metrics():
    observer = _PublicObserver()
    observer.broker = SimpleNamespace(api=SimpleNamespace(
        get_account=lambda: SimpleNamespace(equity="100000", cash="NaN", buying_power=None, status="ACTIVE"),
        get_all_positions=lambda: [SimpleNamespace(symbol="RDW270115C00015000", asset_class="us_option", side="long",
            qty="2", market_value=None, unrealized_pl=None)],
        get_portfolio_history=lambda _: SimpleNamespace(timestamp=[], equity=[]),
    ))
    result = read_lumibot_paper_snapshot(observer=observer)
    assert result["positions"][0]["instrumentId"] == "RDW270115C00015000"
    assert result["positions"][0]["assetClass"] == "us_option"
    assert result["account"]["cashUsd"] is None
    assert result["account"]["buyingPowerUsd"] is None
    assert result["account"]["totalUnrealizedPnlUsd"] is None
    assert result["account"]["maxDrawdownPercent"] is None


def test_history_failure_does_not_erase_real_account_and_position_observations(monkeypatch):
    def unavailable(_):
        raise TimeoutError('Provider history unavailable')
    observer = _PublicObserver()
    monkeypatch.setattr(observer.broker.api, 'get_portfolio_history', unavailable)
    result = read_lumibot_paper_snapshot(observer=observer)
    assert result['connection']['status'] == 'available'
    assert result['connection']['diagnostics'] == 'portfolio_history_unavailable:TimeoutError'
    assert result['account']['buyingPowerUsd'] == 180000
    assert result['positions'][0]['marketValueUsd'] == 275
    assert result['equityCurve'] == []
    assert result['account']['dailyPnlUsd'] is None


class _CardCursor:
    def __init__(self, row: dict):
        self.row = row

    def execute(self, *_args, **_kwargs):
        return None

    def fetchone(self):
        return self.row


def test_trading_card_qualifies_by_saved_hermes_runtime_and_configuration() -> None:
    row = {
        "current_revision_id": str(uuid4()),
        "runtime_kind": "hermes",
        "runtime_mode": "delegate",
        "runtime_profile": "isolated-profile",
        "runtime_extension_config": {
            "configuration": _configuration(),
        },
    }

    result = require_trading_card(
        _CardCursor(row), "project-1", "deck_builder", "card_trading_variant",
    )

    assert result["runtime_profile"] == "isolated-profile"
    assert result["configuration"]["schemaVersion"] == "trading.card.v1"
    assert result["configuration"]["trading"]["maxConcurrentJobs"] == 3
    assert result["configuration"]["trading"]["brokerConnectionRef"] == "alpaca-paper"


def test_trading_card_script_compiles_one_python_tool_recipe() -> None:
    source = '''CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {"type": "object", "properties": {"mission": {"type": "string"}}, "required": ["mission"]},
    "output": {"type": "object", "properties": {"state": {"type": "object"}, "agent": {"type": "object", "properties": {"run": {"type": "boolean"}, "prompt": {"type": "string"}}, "required": ["run"]}}, "required": ["state", "agent"]},
    "max_tool_calls": 1,
}
from hermes_tools import SCRIPT, input, output, tools
tools.trading.get_state = SCRIPT
state = tools.call("trading.get_state")
output.emit({"state": state, "agent": {"run": True, "prompt": input.mission}})
'''
    compiled = compile_card_script(source, selected_tools=["trading.get_state"])
    assert compiled["toolHandles"] == ["trading.get_state"]
    assert compiled["scriptToolIds"] == ["trading.get_state"]
    assert compiled["maxToolCalls"] == 1


def test_pause_resume_fails_closed_until_a_real_trader_lifecycle_exists() -> None:
    with pytest.raises(TradingBoundaryError, match="trading_intervention_lifecycle_unavailable"):
        intervene_trade_job(
            project_id="project-1",
            deck_id="deck_builder",
            card_id="card_trading_workbench",
            job_id=str(uuid4()),
            action="PAUSE",
            reason="User requested pause.",
            actor="authenticated-user:user-1",
        )


def test_kronos_package_load_is_namespaced_without_mutating_import_paths() -> None:
    # Exercise the actual vendor package, not substitute classes whose imports differ.
    before_path = list(sys.path)
    prior_model_module = sys.modules.get("model")
    module = trading_forecast._kronos_module()
    assert sys.path == before_path
    assert sys.modules.get("model") is prior_model_module
    assert module.Kronos.__module__ == trading_forecast._KRONOS_PACKAGE_NAME + ".kronos"
    assert callable(module.KronosTokenizer.from_pretrained)
    assert callable(module.KronosPredictor.predict_batch)
