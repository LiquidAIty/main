"""T001 ToolRegistry: typed, loud-failing card tool resolution.

The agent card Tools tab is the only allowed source of tool access. The
registry exposes only selected, enabled, schema-complete ToolSpecs and fails
loudly for unknown, disabled, unselected, empty-name, or schema-missing
tools. There is no fallback, substitution, guessing, auto-selection, or tool
invention.

The real tool callables (``tool_current_datetime``, ``tool_calculator``) live
here and keep executing through real AutoGen ``FunctionTool`` behavior;
``magentic_runtime.build_card_tools`` resolves through this registry.
"""

from __future__ import annotations

import asyncio
import ast
import json
import operator
import os
import re
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from autogen_core.tools import FunctionTool

from app.python_models.web_search import web_search
from app.python_models.orchestration_contracts import ContextPack, ToolSpec
from app.python_models.sec_filing_signals import (
    IssuerRef,
    SecFilingQuery,
    find_recent_sec_filing_signals,
)
from app.python_models.alpaca_market_data import (
    AlpacaInstrumentRef,
    get_historical_bars,
    get_market_snapshot,
    get_paper_account_readiness,
)
from app.python_models.worldsignals_client import (
    worldsignals_batch,
    worldsignals_capabilities,
    worldsignals_command,
    worldsignals_poll,
    worldsignals_stream_events,
)


# ---------------------------------------------------------------------------
# Real tool callables (moved verbatim from magentic_runtime.py).
# ---------------------------------------------------------------------------

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
        return _SAFE_BIN_OPS[type(node.op)](_eval_arithmetic(node.left), _eval_arithmetic(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _SAFE_UNARY_OPS:
        return _SAFE_UNARY_OPS[type(node.op)](_eval_arithmetic(node.operand))
    raise ValueError(f"calculator_unsupported_expression: {ast.dump(node)}")


def tool_current_datetime() -> str:
    """Return the current UTC date and time in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat()


def tool_calculator(expression: str) -> str:
    """Evaluate a basic arithmetic expression (+ - * / // % ** and parentheses)."""
    parsed = ast.parse(expression, mode="eval")
    return str(_eval_arithmetic(parsed))



# ---------------------------------------------------------------------------
# SEC filing WorldSignals tool (explicit issuer, read-only, no graph write).
# ---------------------------------------------------------------------------


async def find_recent_sec_filing_signals_tool(
    form_types: list[str],
    from_date: str,
    to_date: str,
    issuer_ticker: str | None = None,
    issuer_cik: str | None = None,
    issuer_company_name: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    """Mag One tool: find recent SEC filings for an EXPLICIT issuer/form/window.

    Read-only WorldSignals lane. Returns typed filing-signal envelopes (provider
    status, issuer identity, form type, filing timestamp, the canonical SEC.gov filing
    URL, and a replay identity). Registering the tool never runs it; it performs no
    graph write, no research execution, and no trade. An explicit issuer is required —
    it never auto-runs from ticker wording. Returns provider_unconfigured when the SEC
    provider is not configured.
    """
    query = SecFilingQuery(
        issuer=IssuerRef(
            ticker=(str(issuer_ticker).strip() or None) if issuer_ticker else None,
            cik=(str(issuer_cik).strip() or None) if issuer_cik else None,
            companyName=(
                (str(issuer_company_name).strip() or None) if issuer_company_name else None
            ),
        ),
        formTypes=[str(f).strip() for f in (form_types or []) if str(f).strip()],
        fromDate=str(from_date or "").strip(),
        toDate=str(to_date or "").strip(),
        limit=limit if isinstance(limit, int) else 10,
    )
    # Blocking urllib call (only when configured) runs off the event loop.
    result = await asyncio.to_thread(find_recent_sec_filing_signals, query)
    return result.to_dict()


# ---------------------------------------------------------------------------
# Alpaca read-only market-data + paper-account-readiness tools (no execution).
# ---------------------------------------------------------------------------


async def get_market_snapshot_tool(symbol: str, feed: str = "iex") -> dict[str, Any]:
    """Mag One tool: latest Alpaca snapshot for an EXPLICIT symbol (read-only, paper feed).

    Returns provider/feed identity, observed timestamp, freshness, and status. No order,
    no position/account mutation, no live endpoint. Honest provider_unconfigured without
    paper credentials.
    """
    instrument = AlpacaInstrumentRef(symbol=str(symbol or "").strip())
    result = await asyncio.to_thread(lambda: get_market_snapshot(instrument, feed=feed))
    return result.to_dict()


async def get_historical_bars_tool(
    symbol: str,
    timeframe: str,
    start: str | None = None,
    end: str | None = None,
    limit: int = 100,
    feed: str = "iex",
) -> dict[str, Any]:
    """Mag One tool: bounded Alpaca historical bars for an EXPLICIT symbol + timeframe.

    Read-only. No order/position/account mutation, no live endpoint, no streaming. Honest
    provider_unconfigured without paper credentials.
    """
    instrument = AlpacaInstrumentRef(symbol=str(symbol or "").strip())
    result = await asyncio.to_thread(
        lambda: get_historical_bars(
            instrument, str(timeframe or "").strip(), start=start, end=end,
            limit=limit if isinstance(limit, int) else 100, feed=feed,
        )
    )
    return result.to_dict()


async def get_paper_account_readiness_tool() -> dict[str, Any]:
    """Mag One tool: confirm Alpaca PAPER account availability/status only.

    No positions, no orders, no balances, no mutation. Honest provider_unconfigured
    without paper credentials.
    """
    result = await asyncio.to_thread(get_paper_account_readiness)
    return result.to_dict()


def _backend_base_url() -> str:
    return os.environ.get("LIQUIDAITY_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")


def _post_backend_json_sync(path: str, payload: dict[str, Any]) -> str:
    request = Request(
        f"{_backend_base_url()}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=60) as response:  # noqa: S310 — loopback backend only
            return response.read().decode("utf-8")
    except HTTPError as err:
        body = ""
        try:
            body = err.read().decode("utf-8")
        except Exception:
            body = ""
        # Honest error pass-through: the bridge returns structured JSON errors.
        return body or json.dumps({"ok": False, "error": f"backend_http_{err.code}"})
    except URLError as err:
        return json.dumps({"ok": False, "error": f"backend_unreachable: {err.reason}"})


# ---------------------------------------------------------------------------
# AgentGraph assignment authority for stable WorldSignals references.
# ---------------------------------------------------------------------------

ACTIVE_AGENT_ASSIGNMENT_CONTEXT: ContextVar[dict[str, str] | None] = ContextVar(
    "active_agent_assignment_context",
    default=None,
)


def _worldsignals_reference_ids(
    operation: str,
    result: dict[str, Any],
) -> list[str]:
    """Return only native WorldSignals identities that its API actually emits."""
    references: list[str] = []

    def add(kind: str, value: Any) -> None:
        identity = str(value or "").strip()
        if identity:
            reference = f"worldsignals:{kind}:{identity}"
            if reference not in references:
                references.append(reference)

    add(operation, result.get("command_id") or result.get("task_id") or result.get("id"))
    for key, kind in (
        ("results", "command"),
        ("commands", "command"),
        ("tasks", "task"),
        ("events", "event"),
    ):
        values = result.get(key)
        if not isinstance(values, list):
            continue
        for item in values[:20]:
            if not isinstance(item, dict):
                continue
            payload = item.get("data")
            payload = payload if isinstance(payload, dict) else {}
            add(
                kind,
                item.get("command_id")
                or item.get("task_id")
                or item.get("id")
                or payload.get("command_id")
                or payload.get("task_id")
                or payload.get("id"),
            )
    return references


def _record_worldsignals_reference(operation: str, result: dict[str, Any]) -> dict[str, Any]:
    """Attach native result identities; WorldSignals retains its payload."""
    authority = ACTIVE_AGENT_ASSIGNMENT_CONTEXT.get()
    if authority is None:
        return result
    reference_ids = _worldsignals_reference_ids(operation, result)
    if not reference_ids:
        return result
    from app.python_models import agentgraph

    agentgraph.add_assignment_references(
        project_id=authority["projectId"],
        assignment_id=authority["assignmentId"],
        receiver_card_id=authority["receiverCardId"],
        references=[
            {
                "referenceId": reference_id,
                "referenceType": "worldsignals",
                "required": False,
            }
            for reference_id in reference_ids
        ],
    )
    return result


def assignment_worldsignals_command(
    command: str,
    arguments: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return _record_worldsignals_reference(
        "command",
        worldsignals_command(command, arguments),
    )


def assignment_worldsignals_batch(
    commands: list[dict[str, Any]],
) -> dict[str, Any]:
    return _record_worldsignals_reference(
        "batch",
        worldsignals_batch(commands),
    )


def assignment_worldsignals_poll() -> dict[str, Any]:
    return _record_worldsignals_reference("poll", worldsignals_poll())


def assignment_worldsignals_stream_events(
    max_events: int = 1,
    timeout_seconds: int = 15,
) -> dict[str, Any]:
    return _record_worldsignals_reference(
        "events",
        worldsignals_stream_events(max_events, timeout_seconds),
    )


# ---------------------------------------------------------------------------
# Coder tool — Mag One → Coder through the ONE canonical doorway.
# ---------------------------------------------------------------------------


def build_coder_subagent_tool(card_id: str) -> FunctionTool:
    """Create a Mag One→Coder tool bound to the saved Coder card identity.

    Decision 1a/2yes (2026-08-05): there is ONE Coder runtime. Mag One invokes
    the saved Coder card through the canonical backend doorway
    ``/api/coder/mcp-bridge/run_coder_subagent`` (authority=mag_one_execution),
    which resolves the saved card provider/model/tools, opens the single
    OpenClaude console session, and records one CoderReport + AgentGraph
    lineage. No headless alternate engine exists anymore.
    """
    card_id = str(card_id or "").strip()

    async def _run_coder(**kwargs: Any) -> str:
        # Server-owned identity is injected by the backend mcp-bridge route;
        # the model supplies only the logical task. The active assignment
        # supplies project/card identity when present.
        payload: dict[str, Any] = {
            "approvedPrompt": str(kwargs.get("objective") or "").strip(),
            "authority": "mag_one_execution",
            "cardId": card_id,
        }
        authority = ACTIVE_AGENT_ASSIGNMENT_CONTEXT.get()
        if authority is not None:
            project_id = str(authority.get("projectId") or "").strip()
            receiver_card = str(authority.get("receiverCardId") or "").strip()
            if project_id:
                payload["projectId"] = project_id
            # The saved Coder card is the receiver; only fall back to the bound
            # card id if assignment context does not name a receiver.
            if receiver_card:
                payload["cardId"] = receiver_card
        return await asyncio.to_thread(
            _post_backend_json_sync,
            "/api/coder/mcp-bridge/run_coder_subagent",
            payload,
        )

    return FunctionTool(
        _run_coder,
        description=DEFAULT_TOOL_REGISTRY.spec("run_coder_subagent").description,
        name="run_coder_subagent",
    )


async def run_coder_subagent(
    objective: str,
    guardrails: list[str] | None = None,
    proof_required: list[str] | None = None,
    stop_conditions: list[str] | None = None,
    project_id: str = "",
) -> str:
    """Run a real coding task through the canonical Coder doorway; return its CoderReport.

    The model supplies ONLY the logical coding task. The backend mcp-bridge
    owns project/deck/card identity and the saved Coder card's provider/model/
    tools; it opens the one OpenClaude console session and returns the
    authoritative CoderReport JSON verbatim — no fabricated success and no
    fallback: a blocked/failed run is reported honestly.
    """
    payload: dict[str, Any] = {
        "approvedPrompt": str(objective or "").strip(),
        "authority": "mag_one_execution",
        **(dict(projectId=str(project_id)) if str(project_id or "").strip() else {}),
        **(dict(guardrails=[str(x) for x in guardrails]) if guardrails else {}),
        **(dict(proofRequired=[str(x) for x in proof_required]) if proof_required else {}),
        **(dict(stopConditions=[str(x) for x in stop_conditions]) if stop_conditions else {}),
    }
    authority = ACTIVE_AGENT_ASSIGNMENT_CONTEXT.get()
    if authority is not None:
        project_id_ = str(authority.get("projectId") or "").strip()
        if project_id_:
            payload["projectId"] = project_id_
        receiver_card = str(authority.get("receiverCardId") or "").strip()
        if receiver_card:
            payload["cardId"] = receiver_card
    return await asyncio.to_thread(
        _post_backend_json_sync,
        "/api/coder/mcp-bridge/run_coder_subagent",
        payload,
    )


# ---------------------------------------------------------------------------
# ToolRegistry.
# ---------------------------------------------------------------------------

class ToolRegistry:
    """Resolves selected card tools to real FunctionTools, loudly or not at all."""

    def __init__(self) -> None:
        self._specs: dict[str, ToolSpec] = {}
        self._adapters: dict[str, Callable[..., Any]] = {}

    def register(self, spec: ToolSpec, adapter: Callable[..., Any]) -> None:
        if not isinstance(spec, ToolSpec):
            raise RuntimeError(f"card_tool_spec_invalid: {type(spec).__name__}")
        if spec.name in self._specs:
            raise RuntimeError(f"card_tool_already_registered: {spec.name}")
        if not callable(adapter):
            raise RuntimeError(f"card_tool_adapter_missing: {spec.name}")
        self._specs[spec.name] = spec
        self._adapters[spec.name] = adapter

    def known_names(self) -> list[str]:
        return sorted(self._specs)

    def spec(self, name: str) -> ToolSpec | None:
        return self._specs.get(str(name or "").strip())

    def resolve_one(self, name: str) -> FunctionTool:
        canonical_name = str(name or "").strip()
        if not canonical_name:
            raise RuntimeError("card_tool_name_empty")
        spec = self._specs.get(canonical_name)
        if spec is None:
            raise RuntimeError(
                f"card_tool_unknown: {canonical_name} (known: {','.join(self.known_names())})"
            )
        if not spec.enabled:
            raise RuntimeError(f"card_tool_disabled: {canonical_name}")
        # ToolSpec validation already guarantees complete schemas; re-check so a
        # mutated spec can never resolve silently.
        if not spec.inputSchema or not spec.outputSchema:
            raise RuntimeError(f"card_tool_schema_missing: {canonical_name}")
        return FunctionTool(
            self._adapters[canonical_name],
            description=spec.description,
            name=spec.name,
        )

    def resolve_selected(self, selected_names: list[str]) -> list[FunctionTool]:
        """Resolve exactly the card Tools tab selection.

        Registered but unselected tools are never returned; any invalid
        selection aborts the whole resolution rather than degrading silently.
        """
        resolved: list[FunctionTool] = []
        runtime_names: set[str] = set()
        for name in selected_names or []:
            tool = self.resolve_one(name)
            if tool.name in runtime_names:
                raise RuntimeError(f"card_tool_runtime_name_collision: {tool.name}")
            runtime_names.add(tool.name)
            resolved.append(tool)
        return resolved


def build_default_tool_registry() -> ToolRegistry:
    """The canonical runtime registry."""
    registry = ToolRegistry()
    for spec, adapter in [
        (
            ToolSpec(
                name="worldsignals.capabilities",
                description=(
                    "Read a bounded live WorldSignals capability/command view. Filter by domain, "
                    "exact command, keyword, or read/write operation class; an exact command match "
                    "returns that command's current parameter schema."
                ),
                enabled=True,
                inputSchema={
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
                outputSchema={"type": "object"},
            ),
            worldsignals_capabilities,
        ),
        (ToolSpec(name="worldsignals.command", description="Run one real command from the WorldSignals command manifest.", enabled=True, inputSchema={"type": "object", "properties": {"command": {"type": "string"}, "arguments": {"type": "object"}}, "required": ["command"], "additionalProperties": False}, outputSchema={"type": "object"}), assignment_worldsignals_command),
        (
            ToolSpec(
                name="worldsignals.batch",
                description="Run up to twenty real WorldSignals commands through its batch channel.",
                enabled=True,
                inputSchema={
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
                        }
                    },
                    "required": ["commands"],
                    "additionalProperties": False,
                },
                outputSchema={"type": "object"},
            ),
            assignment_worldsignals_batch,
        ),
        (ToolSpec(name="worldsignals.poll", description="Poll completed command results and pending WorldSignals tasks.", enabled=True, inputSchema={"type": "object", "properties": {}, "required": [], "additionalProperties": False}, outputSchema={"type": "object"}), assignment_worldsignals_poll),
        (ToolSpec(name="worldsignals.stream_events", description="Read a bounded set of real-time events from the WorldSignals SSE channel.", enabled=True, inputSchema={"type": "object", "properties": {"max_events": {"type": "integer", "minimum": 1, "maximum": 20, "default": 1}, "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 30, "default": 15}}, "required": [], "additionalProperties": False}, outputSchema={"type": "object"}), assignment_worldsignals_stream_events),
    ]:
        registry.register(spec, adapter)
    registry.register(
        ToolSpec(
            name="run_local_coder",
            description=(
                "Run a real coding task through the LocalCoder engine and return its "
                "authoritative CoderReport. Supply ONLY the logical task (objective, "
                "plan_excerpt, context_summary, guardrails, allowed_files, proof_required, "
                "stop_conditions, forbidden_work, code_anchors, report_format, write_mode). "
                "The coder's filesystem root is injected server-side (trusted, never chosen "
                "by the model). Reports blocked/failed honestly; no fake success."
            ),
            enabled=True,
            inputSchema={
                "type": "object",
                "properties": {
                    "objective": {"type": "string"},
                    "plan_excerpt": {"type": "string"},
                    "context_summary": {"type": "string"},
                    "guardrails": {"type": "array", "items": {"type": "string"}},
                    "allowed_files": {"type": "array", "items": {"type": "string"}},
                    "forbidden_work": {"type": "array", "items": {"type": "string"}},
                    "proof_required": {"type": "array", "items": {"type": "string"}},
                    "stop_conditions": {"type": "array", "items": {"type": "string"}},
                    "code_anchors": {"type": "array", "items": {"type": "string"}},
                    "cbm_queries": {"type": "array", "items": {"type": "string"}},
                    "report_format": {"type": "string"},
                    "write_mode": {"type": "string", "enum": ["read-only", "edit"]},
                    "project_id": {"type": "string"},
                },
                "required": ["objective"],
            },
            outputSchema={"type": "object", "description": "authoritative CoderReport JSON"},
        ),
        run_local_coder,
    )
    registry.register(
        ToolSpec(
            name="current_datetime",
            description="Return the current UTC date and time in ISO-8601 format.",
            enabled=True,
            inputSchema={"type": "object", "properties": {}, "required": []},
            outputSchema={"type": "string", "description": "ISO-8601 UTC datetime"},
        ),
        tool_current_datetime,
    )
    registry.register(
        ToolSpec(
            name="calculator",
            description="Evaluate a basic arithmetic expression and return the numeric result.",
            enabled=True,
            inputSchema={
                "type": "object",
                "properties": {"expression": {"type": "string"}},
                "required": ["expression"],
            },
            outputSchema={"type": "string", "description": "numeric result as a string"},
        ),
        tool_calculator,
    )
    registry.register(
        ToolSpec(
            name="web_search",
            description=(
                "Real web search via Tavily. Returns real result pages (url, title, domain, "
                "content excerpt, published date) for the agent to read and select. Read-only "
                "and never fabricates results; pair with graphiti.add_memory to persist selected "
                "real sources with provenance. Does not run automatically — the agent decides "
                "when a task needs external web sources."
            ),
            enabled=True,
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_results": {"type": "integer", "default": 5},
                },
                "required": ["query"],
            },
            outputSchema={
                "type": "string",
                "description": "JSON { ok, query, result_count, results[] } with per-result source metadata",
            },
        ),
        web_search,
    )
    registry.register(
        ToolSpec(
            name="find_recent_sec_filing_signals",
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
            enabled=True,
            inputSchema={
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
            outputSchema={
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": [
                            "available",
                            "provider_unconfigured",
                            "provider_error",
                            "invalid_response",
                        ],
                    },
                    "provider": {"type": "string"},
                    "fetchedAt": {"type": "string"},
                    "replay": {"type": "object"},
                    "envelopes": {"type": "array"},
                    "error": {"type": ["string", "null"]},
                },
            },
        ),
        find_recent_sec_filing_signals_tool,
    )
    registry.register(
        ToolSpec(
            name="get_market_snapshot",
            description=(
                "Read-only Alpaca latest market snapshot for an EXPLICITLY supplied symbol "
                "(paper data feed). Returns provider/feed identity, latest trade/quote, observed "
                "timestamp, freshness, and status. Use only when the selected task explicitly "
                "needs a symbol's latest market data. It places no order, mutates no position or "
                "account, and never calls a live trading endpoint. Returns provider_unconfigured "
                "when paper credentials are not configured; never fabricates a snapshot."
            ),
            enabled=True,
            inputSchema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "feed": {"type": "string", "default": "iex"},
                },
                "required": ["symbol"],
            },
            outputSchema={
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
        ),
        get_market_snapshot_tool,
    )
    registry.register(
        ToolSpec(
            name="get_historical_bars",
            description=(
                "Read-only Alpaca bounded historical bars for an EXPLICITLY supplied symbol and "
                "timeframe (paper data feed). Returns provider/feed identity, the bars, and "
                "status. Use only when the selected task explicitly needs historical bars. It "
                "places no order, mutates nothing, does no streaming, and never calls a live "
                "endpoint. Returns provider_unconfigured when paper credentials are not configured."
            ),
            enabled=True,
            inputSchema={
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
            outputSchema={
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
        ),
        get_historical_bars_tool,
    )
    registry.register(
        ToolSpec(
            name="get_paper_account_readiness",
            description=(
                "Confirm Alpaca PAPER account availability and status only. Read-only: it returns "
                "no positions, no orders, no balances, and mutates nothing. Use only to verify the "
                "paper account is reachable. Returns provider_unconfigured when paper credentials "
                "are not configured; never fabricates account state."
            ),
            enabled=True,
            inputSchema={"type": "object", "properties": {}, "required": []},
            outputSchema={
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "status": {"type": "string"},
                    "mode": {"type": "string"},
                    "accountStatus": {"type": ["string", "null"]},
                },
            },
        ),
        get_paper_account_readiness_tool,
    )
    return registry


DEFAULT_TOOL_REGISTRY = build_default_tool_registry()


# ---------------------------------------------------------------------------
# Read-only capability manifest (the registry is the single source of truth).
# Surfaced to the frontend so the existing Mag One card Tools surface can render
# real capability metadata — never a hardcoded frontend-only tool list. It
# exposes display metadata only: no endpoints, keys, source paths, or DB config.
# ---------------------------------------------------------------------------

# Per-tool display metadata. Anything not listed falls back to safe defaults
# derived from the registered ToolSpec.
_TOOL_DISPLAY_METADATA: dict[str, dict[str, Any]] = {
    "run_local_coder": {
        "displayName": "Local Coder",
        "agentCompatibility": ["magentic_one", "assistant_agent"],
    },
    "find_recent_sec_filing_signals": {
        "displayName": "SEC Filing Signals",
        "agentCompatibility": ["magentic_one", "assistant_agent"],
    },
    "get_market_snapshot": {
        "displayName": "Alpaca Market Snapshot",
        "agentCompatibility": ["magentic_one", "assistant_agent"],
    },
    "get_historical_bars": {
        "displayName": "Alpaca Historical Bars",
        "agentCompatibility": ["magentic_one", "assistant_agent"],
    },
    "get_paper_account_readiness": {
        "displayName": "Alpaca Paper Account Readiness",
        "agentCompatibility": ["magentic_one", "assistant_agent"],
    },
    "calculator": {
        "displayName": "Calculator",
        "agentCompatibility": ["magentic_one", "assistant_agent"],
    },
    "current_datetime": {
        "displayName": "Current Date/Time",
        "agentCompatibility": ["magentic_one", "assistant_agent"],
    },
}


def _summarize_input_schema(input_schema: dict[str, Any]) -> str:
    """Compact, safe summary of a tool's inputs (names only, no values/secrets)."""
    if not isinstance(input_schema, dict):
        return ""
    properties = input_schema.get("properties")
    if not isinstance(properties, dict) or not properties:
        return ""
    required = [name for name in input_schema.get("required", []) if isinstance(name, str)]
    optional = [name for name in properties if name not in required]
    parts: list[str] = []
    if required:
        parts.append(", ".join(required) + " (required)")
    if optional:
        parts.append(", ".join(optional))
    return "; ".join(parts)


def tool_manifest(registry: ToolRegistry | None = None) -> list[dict[str, Any]]:
    """Read-only capability manifest built from the live registry.

    Shape matches the frontend ``ToolCapabilityManifest``:
    ``{id, displayName, description, agentCompatibility, inputSchemaSummary}``.
    """
    registry = registry or DEFAULT_TOOL_REGISTRY
    manifest: list[dict[str, Any]] = []
    for name in registry.known_names():
        spec = registry.spec(name)
        if spec is None or not spec.enabled:
            continue
        meta = _TOOL_DISPLAY_METADATA.get(name, {})
        manifest.append({
            "id": spec.name,
            "displayName": meta.get("displayName", spec.name),
            "description": spec.description,
            "agentCompatibility": list(meta.get("agentCompatibility", ["magentic_one"])),
            "inputSchemaSummary": _summarize_input_schema(spec.inputSchema),
        })
    return manifest
