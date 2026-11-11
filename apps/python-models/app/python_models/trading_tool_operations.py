"""Trading state and decision Python tool handlers and definitions."""
# Entity: Trading
# Relationship: Publishes explicitly grantable Trade Job, decision-journal, LumiBot simulation, and bounded forecast operations without adding broker order execution.

from __future__ import annotations

import asyncio
from typing import Any

from app.application_tool_error import ApplicationToolError
from app.python_models.operation_definition import OperationDefinition
from app.python_models.trading_contract import TradingBoundaryError
from app.python_models.trading_forecast import forecast_market_bars
from app.python_models.trading_backtest import trading_list_bots, trading_backtest, trading_get_backtest

async def trading_get_state_tool(
    *, projectId: str, deckId: str, _callerCardId: str,
) -> dict[str, Any]:
    from app.python_models.trading_jobs import read_trading_state

    return await asyncio.to_thread(
        read_trading_state,
        project_id=projectId,
        deck_id=deckId,
        card_id=_callerCardId,
    )


async def trading_accept_assignment_tool(
    plan: dict[str, Any],
    idempotencyKey: str,
    *,
    projectId: str,
    deckId: str,
    _callerCardId: str,
    _sourceExecution: dict[str, Any],
) -> dict[str, Any]:
    from app.python_models.trading_jobs import accept_trade_assignment

    try:
        return await asyncio.to_thread(
            accept_trade_assignment, project_id=projectId, deck_id=deckId,
            card_id=_callerCardId, source_execution=_sourceExecution,
            plan=plan, idempotency_key=idempotencyKey,
        )
    except TradingBoundaryError as error:
        raise ApplicationToolError(str(error)) from None


async def trading_record_decision_tool(
    action: str,
    rationale: str,
    confidence: float,
    evidence: list[dict[str, Any]],
    missingTerms: list[str],
    idempotencyKey: str,
    jobId: str | None = None,
    subject: str | None = None,
    *,
    projectId: str,
    deckId: str,
    _callerCardId: str,
    _sourceExecution: dict[str, Any],
) -> dict[str, Any]:
    from app.python_models.trading_jobs import record_trade_decision

    try:
        return await asyncio.to_thread(
            record_trade_decision, project_id=projectId, deck_id=deckId,
            card_id=_callerCardId, source_execution=_sourceExecution,
            job_id=jobId, subject=subject, action=action, rationale=rationale,
            confidence=confidence, evidence=evidence, missing_terms=missingTerms,
            idempotency_key=idempotencyKey,
        )
    except TradingBoundaryError as error:
        raise ApplicationToolError(str(error)) from None
def _annotations(
    *, read_only: bool, destructive: bool, idempotent: bool, open_world: bool,
) -> dict[str, bool]:
    return {
        "readOnlyHint": read_only,
        "destructiveHint": destructive,
        "idempotentHint": idempotent,
        "openWorldHint": open_world,
    }
def trading_tool_operation_definitions() -> list[OperationDefinition]:
    internal = frozenset({"internal-plugin"})
    read_closed = _annotations(
        read_only=True, destructive=False, idempotent=True, open_world=False,
    )
    write_closed = _annotations(
        read_only=False, destructive=False, idempotent=True, open_world=False,
    )
    return [
        OperationDefinition(
            canonical_id="trading.list_bots", title="Read available LumiBot strategies",
            description="Inspect the installed, supported LumiBot strategy examples and their exact rules and limits. Does not run a bot or submit orders.",
            parameters_schema={"type": "object", "properties": {}, "additionalProperties": False},
            output_schema={"type": "object"}, handler=trading_list_bots, available=True, publishers=internal,
            access="read", namespace="trading", grant_eligible=True, external_source_id="python_runtime", annotations=read_closed,
        ),
        OperationDefinition(
            canonical_id="trading.backtest", title="Backtest a LumiBot strategy",
            description="Run one installed LumiBot example on validated historical US stock/ETF daily Alpaca IEX bars. "
                        "Historical simulation only: no broker connection or orders. Explicit 7-366 day dates, end exclusive. "
                        "Persists the completed result and input snapshot in Trading with actual producing Card/Hermes references. "
                        "Returns a backtestId, native metrics, equity and actual data/cost assumptions; not proof of profitable execution. "
                        "Inspect trading.list_bots before choosing a bot. No background queue or arbitrary code.",
            parameters_schema={"type": "object", "properties": {
                "bot": {"type": "string", "enum": ["buy_and_hold", "momentum_rotation"]},
                "symbols": {"type": "array", "minItems": 1, "maxItems": 5, "uniqueItems": True,
                            "items": {"type": "string", "minLength": 1}},
                "start": {"type": "string", "format": "date"}, "end": {"type": "string", "format": "date"},
                "capital": {"type": "number", "exclusiveMinimum": 0, "maximum": 1000000},
                "fee_bps": {"type": "number", "minimum": 0, "maximum": 1000, "default": 0},
                "slippage_per_share": {"type": "number", "minimum": 0, "maximum": 100, "default": 0},
            }, "required": ["bot", "symbols", "start", "end", "capital"], "additionalProperties": False},
            output_schema={"type": "object"}, handler=trading_backtest, available=True, publishers=internal,
            access="write", namespace="trading", grant_eligible=True, external_source_id="python_runtime",
            dispatcher_context_arguments=frozenset({"projectId", "deckId", "_callerCardId", "_sourceExecution"}),
            annotations=_annotations(read_only=False, destructive=False, idempotent=False, open_world=True),
        ),
        OperationDefinition(
            canonical_id="trading.get_backtest", title="Read a saved backtest",
            description="Read one exact completed Trading backtest in this Project/deck, preserving its producing Card, native execution references, data cutoff, costs, assumptions and actual results. This does not rerun a strategy or submit an order.",
            parameters_schema={"type": "object", "properties": {
                "backtestId": {"type": "string", "format": "uuid"},
            }, "required": ["backtestId"], "additionalProperties": False},
            output_schema={"type": "object"}, handler=trading_get_backtest,
            available=True, publishers=internal, access="read", namespace="trading", grant_eligible=True,
            external_source_id="python_runtime", annotations=read_closed,
            dispatcher_context_arguments=frozenset({"projectId", "deckId"}),
        ),
        OperationDefinition(
            canonical_id="trading.get_state",
            title="Read paper trading state",
            description=(
                "Read this authenticated Trading Card's durable paper Trade Jobs, typed "
                "decisions, evidence, execution-block state, and recorded portfolio outcomes."
            ),
            parameters_schema={"type": "object", "properties": {}, "required": []},
            output_schema={"type": "object"},
            handler=trading_get_state_tool,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            grant_eligible=True,
            external_source_id="python_runtime",
            annotations=read_closed,
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId",
            }),
        ),
        OperationDefinition(
            canonical_id="trading.accept_assignment",
            title="Accept a paper trade assignment",
            description=(
                "Validate and persist one complete structured paper trade assignment as a "
                "Trade Job. Missing execution terms fail closed. This never submits an order."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "plan": {"type": "object"},
                    "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 160},
                },
                "required": ["plan", "idempotencyKey"],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=trading_accept_assignment_tool,
            available=True,
            publishers=internal,
            access="write",
            namespace="python",
            grant_eligible=True,
            external_source_id="python_runtime",
            annotations=write_closed,
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId", "_sourceExecution",
            }),
        ),
        OperationDefinition(
            canonical_id="trading.record_decision",
            title="Record a paper trading decision",
            description=(
                "Journal one WAIT, ENTER, HOLD, REDUCE, EXIT, PAUSE, or FAIL_SAFE outcome "
                "with evidence. Specify an owned jobId OR a research subject without inventing a funded job. "
                "Use evidence entries with backtestId for exact saved simulation references. "
                "Reuse an idempotencyKey only for the exact same decision. A decision is not an order; executionRequested is always false."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "jobId": {"type": "string", "format": "uuid"},
                    "subject": {"type": "string", "minLength": 1, "maxLength": 500,
                                "description": "Research idea or instrument being assessed; use instead of jobId for an unfunded decision."},
                    "action": {"type": "string", "enum": ["WAIT", "ENTER", "HOLD", "REDUCE", "EXIT", "PAUSE", "FAIL_SAFE"]},
                    "rationale": {"type": "string", "minLength": 1, "maxLength": 8000},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "evidence": {"type": "array", "maxItems": 64, "items": {"type": "object"}},
                    "missingTerms": {"type": "array", "maxItems": 32, "items": {"type": "string", "minLength": 1}},
                    "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 160},
                },
                "required": ["action", "rationale", "confidence", "evidence", "missingTerms", "idempotencyKey"],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=trading_record_decision_tool,
            available=True,
            publishers=internal,
            access="write",
            namespace="python",
            grant_eligible=True,
            external_source_id="python_runtime",
            annotations=write_closed,
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId", "_sourceExecution",
            }),
        ),
        OperationDefinition(
            canonical_id="forecast_market_bars",
            title="Forecast market bars",
            description=(
                "Fetch one bounded real Alpaca paper-data history window and use Kronos "
                "to forecast and retain the next OHLCV bars without creating a trade or order. "
                "Omit end for a current forecast: the server uses invocation time. An explicit end "
                "is a historical information cutoff (timezone required) and must not be in the future. "
                "Daily bars are accepted only "
                "after 20:00 New York time. Invalid model candles remain flagged, not repaired."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "minLength": 1},
                    "timeframe": {"type": "string", "enum": ["1Min", "5Min", "15Min", "1Hour", "1Day"]},
                    "start": {"type": ["string", "null"]},
                    "end": {"type": ["string", "null"]},
                    "history_limit": {"type": "integer", "minimum": 16, "maximum": 400, "default": 128},
                    "horizon": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
                    "model_variant": {"type": "string", "enum": ["mini", "small", "base"], "default": "mini"},
                    "sample_count": {"type": "integer", "minimum": 1, "maximum": 64, "default": 4,
                                     "description": "CPU capacity: up to 64 paths for mini, 16 for small or base."},
                    "seed": {"type": "integer", "minimum": 0, "maximum": 2147483647, "default": 443},
                    "temperature": {"type": "number", "exclusiveMinimum": 0, "default": 1.0},
                    "top_p": {"type": "number", "exclusiveMinimum": 0, "maximum": 1, "default": 0.9},
                    "top_k": {"type": "integer", "minimum": 0, "default": 0,
                              "description": "0 uses top-p; positive top-k replaces top-p. 1 is greedy and collapses repeated paths."},
                },
                "required": ["symbol", "timeframe"],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=forecast_market_bars,
            available=True,
            publishers=internal,
            access="write",
            namespace="trading",
            grant_eligible=True,
            external_source_id="python_runtime",
            dispatcher_context_arguments=frozenset({"projectId", "deckId", "_callerCardId"}),
            annotations={
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": True,
            },
        ),
    ]
