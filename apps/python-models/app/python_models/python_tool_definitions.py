"""Literal definitions and handlers for Python-owned product tools."""

from __future__ import annotations

import asyncio
import ast
import json
import operator
from datetime import datetime, timezone
from typing import Any, Callable

from app.python_models.alpaca_market_data import (
    AlpacaInstrumentRef,
    get_historical_bars,
    get_market_snapshot,
    get_paper_account_readiness,
)
from app.python_models.operation_definition import OperationDefinition
from app.python_models.sec_filing_signals import (
    IssuerRef,
    SecFilingQuery,
    find_recent_sec_filing_signals,
)
from app.python_models.trading_forecast import forecast_market_bars
from app.python_models.web_search import web_search
from app.python_models.worldsignals_client import (
    collect_worldsignals_signal_package,
    worldsignals_batch,
    worldsignals_capabilities,
    worldsignals_command,
    worldsignals_poll,
    worldsignals_stream_events,
)


_SAFE_BIN_OPS: dict[type[ast.AST], Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_SAFE_UNARY_OPS: dict[type[ast.AST], Callable[[Any], Any]] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}


def _eval_arithmetic(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _eval_arithmetic(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_BIN_OPS:
        return _SAFE_BIN_OPS[type(node.op)](
            _eval_arithmetic(node.left), _eval_arithmetic(node.right)
        )
    if isinstance(node, ast.UnaryOp) and type(node.op) in _SAFE_UNARY_OPS:
        return _SAFE_UNARY_OPS[type(node.op)](_eval_arithmetic(node.operand))
    raise ValueError(f"calculator_unsupported_expression: {ast.dump(node)}")


def tool_current_datetime() -> str:
    """Return the current UTC date and time in ISO-8601 format."""

    return datetime.now(timezone.utc).isoformat()


def tool_calculator(expression: str) -> str:
    """Evaluate a basic arithmetic expression."""

    return str(_eval_arithmetic(ast.parse(expression, mode="eval")))


async def web_search_tool(query: str, max_results: int = 5) -> dict[str, Any]:
    """Return the existing Tavily JSON result as its truthful object."""

    payload = json.loads(await web_search(query=query, max_results=max_results))
    if not isinstance(payload, dict):
        raise RuntimeError("web_search_result_invalid")
    return payload


async def find_recent_sec_filing_signals_tool(
    form_types: list[str],
    from_date: str,
    to_date: str,
    issuer_ticker: str | None = None,
    issuer_cik: str | None = None,
    issuer_company_name: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    query = SecFilingQuery(
        issuer=IssuerRef(
            ticker=(str(issuer_ticker).strip() or None) if issuer_ticker else None,
            cik=(str(issuer_cik).strip() or None) if issuer_cik else None,
            companyName=(
                (str(issuer_company_name).strip() or None)
                if issuer_company_name else None
            ),
        ),
        formTypes=[str(value).strip() for value in form_types or [] if str(value).strip()],
        fromDate=str(from_date or "").strip(),
        toDate=str(to_date or "").strip(),
        limit=limit if isinstance(limit, int) else 10,
    )
    return (await asyncio.to_thread(find_recent_sec_filing_signals, query)).to_dict()


async def get_market_snapshot_tool(
    symbol: str, feed: str = "iex",
) -> dict[str, Any]:
    instrument = AlpacaInstrumentRef(symbol=str(symbol or "").strip())
    return (await asyncio.to_thread(
        lambda: get_market_snapshot(instrument, feed=feed)
    )).to_dict()


async def get_historical_bars_tool(
    symbol: str,
    timeframe: str,
    start: str | None = None,
    end: str | None = None,
    limit: int = 100,
    feed: str = "iex",
) -> dict[str, Any]:
    instrument = AlpacaInstrumentRef(symbol=str(symbol or "").strip())
    return (await asyncio.to_thread(
        lambda: get_historical_bars(
            instrument,
            str(timeframe or "").strip(),
            start=start,
            end=end,
            limit=limit if isinstance(limit, int) else 100,
            feed=feed,
        )
    )).to_dict()


async def get_paper_account_readiness_tool() -> dict[str, Any]:
    return (await asyncio.to_thread(get_paper_account_readiness)).to_dict()


async def worldsignals_package_tool(
    command: str,
    reason: str,
    arguments: dict[str, Any] | None = None,
    domains: list[str] | None = None,
    sourceRefs: list[str] | None = None,
    maxAgeSeconds: int | None = None,
    limit: int = 25,
    *,
    projectId: str,
    deckId: str,
    _sourceCardId: str,
    _sourceRunId: str,
) -> dict[str, Any]:
    """Collect one scoped read-only WorldSignals evidence package."""

    if not all((projectId, deckId, _sourceCardId, _sourceRunId)):
        raise ValueError("worldsignals_package_card_context_required")
    package = await asyncio.to_thread(
        collect_worldsignals_signal_package,
        command=command,
        arguments=arguments or {},
        project_id=projectId,
        deck_id=deckId,
        requesting_card_id=_sourceCardId,
        requesting_run_id=_sourceRunId,
        reason=reason,
        producer_card_id=_sourceCardId,
        producer_run_id=_sourceRunId,
        domains=[str(value) for value in domains or []],
        source_refs=[str(value) for value in sourceRefs or []],
        max_age_seconds=maxAgeSeconds,
        limit=limit,
    )
    return package.model_dump(mode="json")


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


def _worldsignals_operation_definitions(
    internal: frozenset[str],
    read_open: dict[str, bool],
) -> list[OperationDefinition]:
    return [
        OperationDefinition(
            canonical_id="worldsignals.capabilities",
            title="WorldSignals capabilities",
            description=(
                "Read a bounded live WorldSignals capability/command view. Filter by domain, "
                "exact command, keyword, or read/write operation class; an exact command match "
                "returns that command's current parameter schema."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "domain": {"type": "string"},
                    "command": {"type": "string"},
                    "keyword": {"type": "string"},
                    "operation_class": {"type": "string", "enum": ["read", "write"]},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 25},
                },
                "required": [],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=worldsignals_capabilities,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
        ),
        OperationDefinition(
            canonical_id="worldsignals.command",
            title="Run a WorldSignals command",
            description="Run one real command from the WorldSignals command manifest.",
            parameters_schema={
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "arguments": {"type": "object"},
                },
                "required": ["command"],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=worldsignals_command,
            available=True,
            publishers=internal,
            access="write",
            namespace="python",
            external_source_id="python_runtime",
            annotations=_annotations(
                read_only=False, destructive=True, idempotent=False, open_world=True,
            ),
        ),
        OperationDefinition(
            canonical_id="worldsignals.batch",
            title="Run WorldSignals commands",
            description="Run up to twenty real WorldSignals commands through its batch channel.",
            parameters_schema={
                "type": "object",
                "properties": {
                    "commands": {
                        "type": "array",
                        "maxItems": 20,
                        "items": {
                            "type": "object",
                            "properties": {
                                "cmd": {"type": "string", "minLength": 1},
                                "args": {"type": "object"},
                            },
                            "required": ["cmd"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["commands"],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=worldsignals_batch,
            available=True,
            publishers=internal,
            access="write",
            namespace="python",
            external_source_id="python_runtime",
            annotations=_annotations(
                read_only=False, destructive=True, idempotent=False, open_world=True,
            ),
        ),
        OperationDefinition(
            canonical_id="worldsignals.poll",
            title="Poll WorldSignals results",
            description="Destructively read and consume completed command results and pending WorldSignals tasks.",
            parameters_schema={
                "type": "object", "properties": {}, "required": [],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=worldsignals_poll,
            available=True,
            publishers=internal,
            access="write",
            namespace="python",
            external_source_id="python_runtime",
            annotations=_annotations(
                read_only=False, destructive=True, idempotent=False, open_world=True,
            ),
        ),
        OperationDefinition(
            canonical_id="worldsignals.stream_events",
            title="Stream WorldSignals events",
            description="Read a bounded set of real-time events from the WorldSignals SSE channel.",
            parameters_schema={
                "type": "object",
                "properties": {
                    "max_events": {"type": "integer", "minimum": 1, "maximum": 20, "default": 1},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 30, "default": 15},
                },
                "required": [],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=worldsignals_stream_events,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
        ),
        OperationDefinition(
            canonical_id="worldsignals.package",
            title="Collect a WorldSignals evidence package",
            description=(
                "Run one live WorldSignals command only when its manifest classifies it "
                "as read-only, then return one provenance-bound signal.package.v1 envelope. "
                "Project, deck, Card, and Run scope are injected by the authenticated runtime."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "command": {"type": "string", "minLength": 1},
                    "reason": {"type": "string", "minLength": 1, "maxLength": 4000},
                    "arguments": {"type": "object"},
                    "domains": {"type": "array", "maxItems": 16, "items": {"type": "string", "minLength": 1}},
                    "sourceRefs": {"type": "array", "maxItems": 32, "items": {"type": "string", "minLength": 1}},
                    "maxAgeSeconds": {"type": ["integer", "null"], "minimum": 1, "maximum": 2592000},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
                },
                "required": ["command", "reason"],
                "additionalProperties": False,
            },
            output_schema={
                "type": "object",
                "properties": {
                    "schemaVersion": {"const": "signal.package.v1"},
                    "packageId": {"type": "string"},
                    "query": {"type": "object"},
                    "candidates": {"type": "array", "maxItems": 100},
                },
                "required": ["schemaVersion", "packageId", "query", "candidates"],
            },
            handler=worldsignals_package_tool,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_sourceCardId", "_sourceRunId",
            }),
        ),
    ]


def _general_operation_definitions(
    internal: frozenset[str],
    read_closed: dict[str, bool],
    read_open: dict[str, bool],
) -> list[OperationDefinition]:
    return [
        OperationDefinition(
            canonical_id="current_datetime",
            title="Current date and time",
            description="Return the current UTC date and time in ISO-8601 format.",
            parameters_schema={
                "type": "object", "properties": {}, "required": [],
                "additionalProperties": False,
            },
            output_schema={"type": "string", "description": "ISO-8601 UTC datetime"},
            handler=tool_current_datetime,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_closed,
        ),
        OperationDefinition(
            canonical_id="calculator",
            title="Calculator",
            description="Evaluate a basic arithmetic expression and return the numeric result.",
            parameters_schema={
                "type": "object",
                "properties": {"expression": {"type": "string"}},
                "required": ["expression"],
                "additionalProperties": False,
            },
            output_schema={"type": "string", "description": "numeric result as a string"},
            handler=tool_calculator,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_closed,
        ),
        OperationDefinition(
            canonical_id="web_search",
            title="Search the web",
            description=(
                "Real web search via Tavily. Returns real result pages (url, title, domain, "
                "content excerpt, published date) for the agent to read and select. Read-only "
                "and never fabricates results; pair with graphiti.add_memory to persist selected "
                "real sources with provenance. Does not run automatically — the agent decides "
                "when a task needs external web sources."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_results": {"type": "integer", "default": 5},
                },
                "required": ["query"],
                "additionalProperties": False,
            },
            output_schema={
                "type": "object",
                "description": "Web-search result with per-result source metadata.",
                "properties": {
                    "ok": {"type": "boolean"},
                    "query": {"type": "string"},
                    "result_count": {"type": "integer"},
                    "results": {"type": "array"},
                    "error": {"type": "string"},
                },
            },
            handler=web_search_tool,
            available=True,
            publishers=frozenset({"internal-plugin", "external-mcp"}),
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
        ),
    ]


def _market_operation_definitions(
    internal: frozenset[str],
    read_open: dict[str, bool],
) -> list[OperationDefinition]:
    return [
        OperationDefinition(
            canonical_id="find_recent_sec_filing_signals",
            title="Find recent SEC filing signals",
            description=(
                "Find recent SEC filings for an EXPLICITLY supplied issuer, form types, and "
                "bounded time window via the SEC filing provider. Read-only WorldSignals lane: "
                "returns typed filing-signal envelopes with provider status, issuer identity, "
                "form type, filing timestamp, the canonical SEC.gov filing URL, and a replay "
                "identity. Use it only when the selected task explicitly asks for an issuer's "
                "recent filings. Do not call it merely because a ticker is mentioned. It performs "
                "no graph write, no research execution, and no trade. Returns provider_unconfigured "
                "when the SEC provider is not configured; never fabricates filings."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "form_types": {"type": "array", "items": {"type": "string"}},
                    "from_date": {"type": "string"},
                    "to_date": {"type": "string"},
                    "issuer_ticker": {"type": ["string", "null"]},
                    "issuer_cik": {"type": ["string", "null"]},
                    "issuer_company_name": {"type": ["string", "null"]},
                    "limit": {"type": "integer", "default": 10},
                },
                "required": ["form_types", "from_date", "to_date"],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": [
                        "available", "provider_unconfigured", "provider_error",
                        "invalid_response",
                    ]},
                    "provider": {"type": "string"},
                    "fetchedAt": {"type": "string"},
                    "replay": {"type": "object"},
                    "envelopes": {"type": "array"},
                    "error": {"type": ["string", "null"]},
                },
            },
            handler=find_recent_sec_filing_signals_tool,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
        ),
        OperationDefinition(
            canonical_id="get_market_snapshot",
            title="Get a market snapshot",
            description=(
                "Read-only Alpaca latest market snapshot for an EXPLICITLY supplied symbol "
                "(paper data feed). Returns provider/feed identity, latest trade/quote, observed "
                "timestamp, freshness, and status. Use only when the selected task explicitly "
                "needs a symbol's latest market data. It places no order, mutates no position or "
                "account, and never calls a live trading endpoint. Returns provider_unconfigured "
                "when paper credentials are not configured; never fabricates a snapshot."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "feed": {"type": "string", "default": "iex"},
                },
                "required": ["symbol"],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "feed": {"type": ["string", "null"]},
                    "symbol": {"type": "string"},
                    "status": {"type": "string"},
                    "observedAt": {"type": ["string", "null"]},
                    "latestTradePrice": {"type": ["number", "null"]},
                    "freshness": {"type": ["string", "null"]},
                },
            },
            handler=get_market_snapshot_tool,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
        ),
        OperationDefinition(
            canonical_id="get_historical_bars",
            title="Get historical market bars",
            description=(
                "Read-only Alpaca bounded historical bars for an EXPLICITLY supplied symbol and "
                "timeframe (paper data feed). Returns provider/feed identity, the bars, and "
                "status. Use only when the selected task explicitly needs historical bars. It "
                "places no order, mutates nothing, does no streaming, and never calls a live "
                "endpoint. Returns provider_unconfigured when paper credentials are not configured."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "timeframe": {"type": "string"},
                    "start": {"type": ["string", "null"]},
                    "end": {"type": ["string", "null"]},
                    "limit": {"type": "integer", "default": 100},
                    "feed": {"type": "string", "default": "iex"},
                },
                "required": ["symbol", "timeframe"],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "feed": {"type": ["string", "null"]},
                    "symbol": {"type": "string"},
                    "timeframe": {"type": "string"},
                    "status": {"type": "string"},
                    "bars": {"type": "array"},
                },
            },
            handler=get_historical_bars_tool,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
        ),
        OperationDefinition(
            canonical_id="get_paper_account_readiness",
            title="Check paper account readiness",
            description=(
                "Confirm Alpaca PAPER account availability and status only. Read-only: it returns "
                "no positions, no orders, no balances, and mutates nothing. Use only to verify the "
                "paper account is reachable. Returns provider_unconfigured when paper credentials "
                "are not configured; never fabricates account state."
            ),
            parameters_schema={
                "type": "object", "properties": {}, "required": [],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "status": {"type": "string"},
                    "mode": {"type": "string"},
                    "accountStatus": {"type": ["string", "null"]},
                },
            },
            handler=get_paper_account_readiness_tool,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
        ),
    ]


def _trading_operation_definitions(
    internal: frozenset[str],
    read_closed: dict[str, bool],
    write_closed: dict[str, bool],
) -> list[OperationDefinition]:
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


def python_operation_definitions() -> list[OperationDefinition]:
    """Return literal definitions for operations executed in Python rails."""

    internal = frozenset({"internal-plugin"})
    read_closed = _annotations(
        read_only=True, destructive=False, idempotent=True, open_world=False,
    )
    read_open = _annotations(
        read_only=True, destructive=False, idempotent=True, open_world=True,
    )
    write_closed = _annotations(
        read_only=False, destructive=False, idempotent=True, open_world=False,
    )
    return [
        *_worldsignals_operation_definitions(internal, read_open),
        *_general_operation_definitions(internal, read_closed, read_open),
        *_market_operation_definitions(internal, read_open),
        *_trading_operation_definitions(internal, read_closed, write_closed),
    ]
