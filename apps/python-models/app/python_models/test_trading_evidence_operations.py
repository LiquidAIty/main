"""MCP SDK dispatch and real observation calculations; market I/O remains a fixture."""
# Entity: Trading
# Relationship: Proves saved grant and Hermes provenance injection for the proposal workflow, plus honest incomplete/observed outcomes from bounded completed-bar reads.

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from jsonschema import Draft202012Validator
from mcp.types import CallToolRequestParams

from app import mcp_auth, mcp_catalog_runtime, mcp_host
from app.python_models import alpaca_market_data as market, trading_evidence as records
from app.python_models.trading_tool_operations import trading_tool_operation_definitions
from app.python_models.test_trading_proposals import proposal, option
from app.python_models.trading_proposals import parse_proposal, invert_terms


@pytest.fixture
def dispatch(monkeypatch):
    context = dict(projectId="project-a", deckId="deck-a", callerCardId="designer-card", conversationId="conversation-a",
                   grantedTools=["trading.record_proposal", "trading.read_evidence"])
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: context)
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: {"kind": "card-runtime", "profile": "designer"})
    monkeypatch.setattr(mcp_catalog_runtime, "published_mcp_tool_names", lambda: frozenset(context["grantedTools"]))
    save = Mock(return_value={"proposal_id": "saved-by-existing-owner"})
    monkeypatch.setattr(records, "record_proposal", save)
    return context, save


def call(name, arguments, meta=None):
    return asyncio.run(mcp_host._server_call_tool(None, CallToolRequestParams(name=name, arguments=arguments, meta=meta))).model_dump(by_alias=True)


def test_proposal_sdk_handler_uses_injected_card_and_native_execution(dispatch):
    execution = dict(profile="designer", sessionId="session", turnId="turn", toolCallId="call")
    result = call("trading.record_proposal", {"proposal": proposal(), "idempotencyKey": "original"}, {"hermes.execution": execution})
    assert result["isError"] is False
    values = dispatch[1].call_args.kwargs
    assert values["card_id"] == "designer-card" and values["project_id"] == "project-a"
    assert values["source_execution"] == {"runtime": "hermes", **execution}


@pytest.mark.parametrize("forged", [{"projectId": "foreign"}, {"_callerCardId": "trader"}, {"_sourceExecution": {}}])
def test_forged_scope_never_reaches_proposal_writer(dispatch, forged):
    assert call("trading.record_proposal", {"proposal": proposal(), "idempotencyKey": "original", **forged})["isError"]
    dispatch[1].assert_not_called()


def test_ungranted_or_no_execution_write_never_reaches_proposal_writer(dispatch):
    assert call("trading.record_proposal", {"proposal": proposal(), "idempotencyKey": "original"})["isError"]
    dispatch[0]["grantedTools"] = []
    assert call("trading.record_proposal", {"proposal": proposal(), "idempotencyKey": "original"})["isError"]
    dispatch[1].assert_not_called()


def test_sdk_exact_forecast_read_needs_no_assessment_or_execution_reference(dispatch, monkeypatch):
    reader = Mock(return_value={'receipts': []})
    monkeypatch.setattr(records, 'read_evidence', reader)
    forecast_id = '00000000-0000-0000-0000-000000000001'
    result = call('trading.read_evidence', {'forecastId': forecast_id})
    assert result['isError'] is False
    assert reader.call_args.kwargs['forecast_id'] == forecast_id
    assert reader.call_args.kwargs['assessment_id'] is None
    assert reader.call_args.kwargs['card_id'] == 'designer-card'


def test_completed_backtest_is_not_discarded_when_optional_retention_fails(monkeypatch):
    from contextlib import nullcontext
    import psycopg
    from app.python_models import trading_backtest as backtest
    cursor = Mock()
    cursor.fetchone.side_effect = [{'current_revision_id': 'revision', 'runtime_profile': 'quant'}, None]
    connection = SimpleNamespace(cursor=lambda **kwargs: nullcontext(cursor))
    monkeypatch.setattr(backtest, 'connect_postgres', lambda **kwargs: nullcontext(connection))
    result = {'kind': 'historical_simulation_only', 'sources': [], 'inputSnapshotSha256': 'fixture',
              'dataCutoffExclusive': '2026-11-01', 'brokerOrdersSubmitted': False, '_inputSnapshot': []}
    monkeypatch.setattr(backtest, '_run', lambda **kwargs: dict(result))
    retain = Mock(side_effect=psycopg.OperationalError('isolated retention failure'))
    monkeypatch.setattr(backtest, '_retain_backtest', retain)
    execution = {'runtime': 'hermes', 'profile': 'quant', 'sessionId': 's', 'turnId': 't', 'toolCallId': 'c'}
    returned = backtest._run_and_retain('project', 'deck', 'quant', execution, 'buy_and_hold',
        ['RDW'], '2026-10-01', '2026-11-01', 10000, 0, 0)
    assert returned['kind'] == 'historical_simulation_only'
    assert returned['brokerOrdersSubmitted'] is False
    assert returned['persistence']['status'] == 'unconfirmed'
    assert 'backtestId' not in returned
    assert returned['persistence']['reference'] == retain.call_args.args[-1]
    assert returned['sourceExecution'] == execution


def test_catalog_schemas_resolve_nested_proposal_terms_and_never_offer_order_tools():
    definitions = trading_tool_operation_definitions()
    for definition in definitions:
        Draft202012Validator.check_schema(definition.parameters_schema)
    write = next(item for item in definitions if item.canonical_id == "trading.record_proposal")
    Draft202012Validator(write.parameters_schema).validate({"proposal": proposal(), "idempotencyKey": "one"})
    assert "_sourceExecution" not in write.parameters_schema["properties"]
    assert not any("order" in item.canonical_id for item in definitions)


@pytest.mark.parametrize("price,expected", [(8, "opposing"), (12, "original"), (10, "neither")])
def test_later_real_bar_shape_scores_both_sides_independently_without_fills(monkeypatch, price, expected):
    original = parse_proposal(proposal(borrow=dict(status="available", annual_rate=0,
        observed_at="2026-10-01T19:59:00Z", source_reference="fixture borrow")))
    opposite = parse_proposal(invert_terms(original)["exact_counterparty"]["proposal"])
    query = Mock(return_value=SimpleNamespace(status="available", truncated=False, provider="fixture-alpaca", feed="iex",
        fetchedAt="2026-11-02T00:00:00Z", bars=[market.MarketBar(timestamp="2026-10-30T04:00:00Z",
            open=10, high=max(10, price), low=min(10, price), close=price, volume=100)]))
    monkeypatch.setattr(market, "get_historical_bars", query)
    result = records._observe_equity_pair(original, opposite)
    assert result["kind"] == "SHADOW" and result["status"] == "observed"
    assert result["bar"]["close"] == price
    assert result["original"]["net_pnl"] > 0 if expected == "original" else result["original"]["net_pnl"] < 0
    assert result["opposing"]["net_pnl"] > 0 if expected == "opposing" else result["opposing"]["net_pnl"] < 0
    assert query.call_args.kwargs["limit"] == 10
    assert query.call_args.kwargs["start"].startswith("2026-10-30")


def test_pending_missing_and_option_outcomes_are_not_fabricated(monkeypatch):
    query = Mock(return_value=SimpleNamespace(status="available", truncated=False, bars=[]))
    monkeypatch.setattr(market, "get_historical_bars", query)
    original = parse_proposal(proposal())
    opposite = parse_proposal(invert_terms(original)["exact_counterparty"]["proposal"])
    assert records._observe_equity_pair(original, opposite)["status"] == "incomplete"
    future = original.model_copy(update={"horizon_end": datetime.now(timezone.utc) + timedelta(days=1)})
    assert records._observe_equity_pair(future, opposite)["status"] == "pending"
    query.reset_mock()
    assert records._observe_equity_pair(parse_proposal(option()), parse_proposal(option(right="put")))["status"] == "unavailable"
    query.assert_not_called()
