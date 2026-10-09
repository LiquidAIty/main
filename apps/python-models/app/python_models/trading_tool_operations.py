"""Trading state and decision Python tool handlers and definitions."""

from __future__ import annotations

import asyncio
from typing import Any

from app.python_models.operation_definition import OperationDefinition
from app.python_models.trading_forecast import forecast_market_bars

async def trading_get_state_tool(
    *, projectId: str, deckId: str, _callerCardId: str, _sourceRunId: str,
) -> dict[str, Any]:
    del _sourceRunId
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
    _sourceRunId: str,
) -> dict[str, Any]:
    from app.python_models.trading_jobs import accept_trade_assignment

    return await asyncio.to_thread(
        accept_trade_assignment,
        project_id=projectId,
        deck_id=deckId,
        card_id=_callerCardId,
        source_run_id=_sourceRunId,
        plan=plan,
        idempotency_key=idempotencyKey,
    )


async def trading_record_decision_tool(
    jobId: str,
    action: str,
    rationale: str,
    confidence: float,
    evidence: list[dict[str, Any]],
    missingTerms: list[str],
    idempotencyKey: str,
    *,
    projectId: str,
    deckId: str,
    _callerCardId: str,
    _sourceRunId: str,
) -> dict[str, Any]:
    from app.python_models.trading_jobs import record_trade_decision

    return await asyncio.to_thread(
        record_trade_decision,
        project_id=projectId,
        deck_id=deckId,
        card_id=_callerCardId,
        source_run_id=_sourceRunId,
        job_id=jobId,
        action=action,
        rationale=rationale,
        confidence=confidence,
        evidence=evidence,
        missing_terms=missingTerms,
        idempotency_key=idempotencyKey,
    )
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
            external_source_id="python_runtime",
            annotations=read_closed,
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId", "_sourceRunId",
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
            external_source_id="python_runtime",
            annotations=write_closed,
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId", "_sourceRunId",
            }),
        ),
        OperationDefinition(
            canonical_id="trading.record_decision",
            title="Record a paper trading decision",
            description=(
                "Journal one WAIT, ENTER, HOLD, REDUCE, EXIT, PAUSE, or FAIL_SAFE outcome "
                "against a durable Trade Job with evidence. A decision is not an order and "
                "executionRequested is always false."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "jobId": {"type": "string", "format": "uuid"},
                    "action": {"type": "string", "enum": ["WAIT", "ENTER", "HOLD", "REDUCE", "EXIT", "PAUSE", "FAIL_SAFE"]},
                    "rationale": {"type": "string", "minLength": 1, "maxLength": 8000},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "evidence": {"type": "array", "maxItems": 64, "items": {"type": "object"}},
                    "missingTerms": {"type": "array", "maxItems": 32, "items": {"type": "string", "minLength": 1}},
                    "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 160},
                },
                "required": ["jobId", "action", "rationale", "confidence", "evidence", "missingTerms", "idempotencyKey"],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=trading_record_decision_tool,
            available=True,
            publishers=internal,
            access="write",
            namespace="python",
            external_source_id="python_runtime",
            annotations=write_closed,
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId", "_sourceRunId",
            }),
        ),
        OperationDefinition(
            canonical_id="forecast_market_bars",
            title="Forecast market bars",
            description=(
                "Fetch one bounded real Alpaca paper-data history window and use Kronos "
                "to forecast the next OHLCV bars without creating a trade or order."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "minLength": 1},
                    "timeframe": {"type": "string", "pattern": r"^[1-9][0-9]*(Min|Hour|Day|Week|Month)$"},
                    "start": {"type": ["string", "null"]},
                    "end": {"type": ["string", "null"]},
                    "history_limit": {"type": "integer", "minimum": 16, "maximum": 400, "default": 128},
                    "horizon": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
                },
                "required": ["symbol", "timeframe"],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=forecast_market_bars,
            available=True,
            publishers=internal,
            access="read",
            namespace="trading",
            external_source_id="python_runtime",
            annotations={
                "readOnlyHint": True,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": True,
            },
        ),
    ]
