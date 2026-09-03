from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.python_models.card_script import compile_card_script
from app.python_models.lumibot_lifecycle import run_lumibot_local_backtest
from app.python_models.trading_runtime import (
    _current_trading_card,
    TradingRuntimeError,
    deterministic_client_order_id,
    normalize_trade_plan,
    normalize_trading_configuration,
    read_lumibot_paper_snapshot,
    intervene_trade_job,
    validate_plan_against_configuration,
)


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

    with pytest.raises(TradingRuntimeError, match="trade_plan_missing_terms:stopConditions"):
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
        TradingRuntimeError,
        match="trading_execution_must_remain_unapproved_paper_only",
    ):
        normalize_trading_configuration(unsafe)


def test_plan_is_rejected_when_card_risk_is_incomplete_or_exceeded() -> None:
    plan = normalize_trade_plan(_plan())
    with pytest.raises(TradingRuntimeError, match="risk_configuration_incomplete"):
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
    with pytest.raises(TradingRuntimeError, match="loss_exceeds_card_risk"):
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
    with pytest.raises(TradingRuntimeError, match="risk_reward_below"):
        validate_plan_against_configuration(plan, ready, active_job_count=0)
    plan["expectedRiskReward"] = 3
    with pytest.raises(TradingRuntimeError, match="max_concurrent_jobs"):
        validate_plan_against_configuration(plan, ready, active_job_count=3)


def test_future_paper_order_identity_is_deterministic_but_places_nothing() -> None:
    job_id = str(uuid4())
    decision_id = str(uuid4())

    first = deterministic_client_order_id(job_id, decision_id)
    second = deterministic_client_order_id(job_id, decision_id)

    assert first == second
    assert first.startswith("paper-")
    assert len(first) == 30


class _HistoryFrame:
    def reset_index(self):
        return self

    def to_dict(self, *, orient: str):
        assert orient == "records"
        return [
            {"timestamp": "2026-09-01T00:00:00Z", "equity": 100_000},
            {"timestamp": "2026-09-02T00:00:00Z", "equity": 100_250},
        ]


class _PublicObserver:
    broker = SimpleNamespace(get_historical_account_value=lambda: {"day": _HistoryFrame()})

    @staticmethod
    def get_portfolio_value():
        return 100_250

    @staticmethod
    def get_cash():
        return 90_000

    @staticmethod
    def get_positions():
        return [SimpleNamespace(
            asset=SimpleNamespace(symbol="RDW"), side="long", quantity=25,
            avg_fill_price=10, current_price=11, market_value=275, pnl=25,
            strategy="reference",
        )]

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
    assert snapshot["account"]["dailyPnlUsd"] == 250
    assert snapshot["positions"][0]["symbol"] == "RDW"
    assert snapshot["orders"][0]["orderId"] == "paper-order-1"
    assert snapshot["account"]["buyingPowerUsd"] is None


def test_real_lumibot_local_lifecycle_produces_state_events_and_artifacts(tmp_path) -> None:
    lifecycle_run_id = str(uuid4())
    result = run_lumibot_local_backtest(
        card_id="card_trading_workbench",
        lifecycle_run_id=lifecycle_run_id,
        artifact_root=tmp_path,
    )

    assert result["status"] == "completed"
    assert result["paperOnly"] is True
    assert result["liveOrders"] is False
    assert result["modelProviderCalls"] is False
    assert result["portfolio"]["portfolioValueUsd"] is not None
    assert len(result["portfolio"]["equityCurve"]) > 1
    assert {event["action"] for event in result["events"]} >= {"ENTER", "EXIT"}
    assert any(event["kind"] == "fill" for event in result["events"])
    assert {order["status"] for order in result["orders"]} == {"fill"}
    assert {artifact["kind"] for artifact in result["artifacts"]} >= {
        "lumibot-stats", "trading-lifecycle-snapshot",
    }
    for artifact in result["artifacts"]:
        assert Path(artifact["locator"]).is_file()
        assert artifact["sizeBytes"] > 0
        assert artifact["contentSha256"]


class _CardCursor:
    def __init__(self, row: dict):
        self.row = row

    def execute(self, *_args, **_kwargs):
        return None

    def fetchone(self):
        return self.row


def test_trading_runtime_qualifies_by_saved_hermes_subsystem_not_card_name() -> None:
    row = {
        "current_revision_id": str(uuid4()),
        "runtime_kind": "hermes",
        "runtime_mode": "delegate",
        "runtime_profile": "isolated-profile",
        "runtime_extension_config": {
            "configuration": _configuration(),
            "subsystems": [{
                "id": "lumibot",
                "label": "LumiBot",
                "adapter": {
                    "kind": "python",
                    "contractVersion": "card-subsystem.v1",
                    "capabilities": ["state", "events", "commands", "artifacts", "readiness"],
                },
                "cardTab": {"enabled": True},
                "configurationSchema": "trading.card.v1",
            }],
        },
    }

    result = _current_trading_card(
        _CardCursor(row), "project-1", "deck_builder", "card_trading_variant",
    )

    assert result["runtime_profile"] == "isolated-profile"
    assert result["subsystem"]["id"] == "lumibot"


def test_trading_card_script_compiles_one_python_subsystem_boundary() -> None:
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
    with pytest.raises(TradingRuntimeError, match="trading_intervention_lifecycle_unavailable"):
        intervene_trade_job(
            project_id="project-1",
            deck_id="deck_builder",
            card_id="card_trading_workbench",
            job_id=str(uuid4()),
            action="PAUSE",
            reason="User requested pause.",
            actor="authenticated-user:user-1",
        )
