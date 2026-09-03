from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.python_models.trading_runtime import (
    TradingRuntimeError,
    deterministic_client_order_id,
    normalize_trade_plan,
    normalize_trading_configuration,
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
    assert normalize_trading_configuration(_configuration()) == _configuration()
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
