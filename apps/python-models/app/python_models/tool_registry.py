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
import sys
from contextvars import ContextVar, Token
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from autogen_core.tools import FunctionTool

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
# Coder Console tool.
# ---------------------------------------------------------------------------

_CURRENT_CODER_CONTEXT: ContextVar[ContextPack | None] = ContextVar(
    "current_coder_console_context",
    default=None,
)
_CURRENT_CODER_DISPATCH: ContextVar[asyncio.Future[dict[str, Any]] | None] = ContextVar(
    "current_coder_console_dispatch",
    default=None,
)
_DEFAULT_CODER_CONSOLE_BACKEND_URL = "http://127.0.0.1:4000"


def set_current_coder_tool_context(context: ContextPack) -> Token:
    """Bind the current Mag One canvas/context for real tool calls in this run."""
    return _CURRENT_CODER_CONTEXT.set(context)


def reset_current_coder_tool_context(token: Token) -> None:
    _CURRENT_CODER_CONTEXT.reset(token)


def set_current_coder_dispatch_future(
    dispatch_future: asyncio.Future[dict[str, Any]],
) -> Token:
    """Bind the dispatch result awaited by the current Mag One rails run."""
    return _CURRENT_CODER_DISPATCH.set(dispatch_future)


def reset_current_coder_dispatch_future(token: Token) -> None:
    _CURRENT_CODER_DISPATCH.reset(token)


def _publish_coder_dispatch(result: dict[str, Any]) -> dict[str, Any]:
    dispatch_future = _CURRENT_CODER_DISPATCH.get()
    if dispatch_future is not None and not dispatch_future.done():
        dispatch_future.set_result(result)
    return result


def _compact_text(value: str, limit: int = 2400) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return f"{text[: limit - 3]}..."


def _participant_role(participant: Any) -> str:
    identity = " ".join(
        str(value or "").strip().lower()
        for value in (
            getattr(participant, "cardId", ""),
            getattr(participant, "title", ""),
            getattr(participant, "runtimeType", ""),
            getattr(participant, "runtimeBinding", ""),
            getattr(participant, "role", ""),
        )
    )
    if "local_coder" in identity or "local coder" in identity:
        return "local_coder"
    if "codegraph" in identity:
        return "codegraph"
    if "plan_agent" in identity or "plan agent" in identity:
        return "plan"
    if "thinkgraph" in identity:
        return "thinkgraph"
    return "other"


def build_compact_coder_prompt(
    *,
    target_root: str,
    goal: str,
    prompt: str = "",
    edit_mode: str = "read_only",
) -> str:
    """Build the bounded SPEC-style task sent to the existing console route."""
    task_detail = _compact_text(prompt) or _compact_text(goal)
    return "\n".join(
        [
            "COMPACT CODER TASK",
            f"Target root: {target_root}",
            f"User goal: {_compact_text(goal)}",
            (
                "Current state summary: Mag One classified this as coding; the current canvas "
                "has bus-connected Local Coder and CodeGraph participants."
            ),
            "Constraints:",
            "- Stay within the target root.",
            "- Do not edit vendored localcoder/.",
            "- Do not use gRPC.",
            "- Do not do naming or rebrand work.",
            f"- Edit mode: {edit_mode}.",
            "Read first:",
            "- AGENTS.md",
            "- PLAN.md",
            "Task:",
            task_detail,
            "Expected proof: direct reads and a concise repo-inspection result; report exact blockers.",
            (
                "Expected result format: status, files inspected, findings, proof, blockers, "
                "and next recommended task."
            ),
        ]
    )


def _blocked_coder_result(target_root: str, blocker: str) -> dict[str, Any]:
    return _publish_coder_dispatch({
        "status": "blocked",
        "session_id": None,
        "target_root": target_root,
        "provider": None,
        "model": None,
        "transport": None,
        "watch_surface": "Code Console",
        "message": f"Mag One could not start the coder task. Blocker: {blocker}",
        "delivery_status": "blocked",
        "blocker": blocker,
    })


def _post_console_task(payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    base_url = str(
        os.getenv("CODER_CONSOLE_BACKEND_URL", _DEFAULT_CODER_CONSOLE_BACKEND_URL)
    ).strip().rstrip("/")
    if not base_url:
        raise RuntimeError("coder_console_backend_url_missing")
    request = Request(
        f"{base_url}/api/coder/openclaude/console/task",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=45) as response:
            raw = response.read().decode("utf-8")
            return int(response.status), json.loads(raw or "{}")
    except HTTPError as error:
        raw = error.read().decode("utf-8")
        try:
            body = json.loads(raw or "{}")
        except json.JSONDecodeError:
            body = {"error": raw or str(error)}
        return int(error.code), body
    except URLError as error:
        raise RuntimeError(f"coder_console_backend_unavailable: {error.reason}") from error


async def coder_console_task(
    project_id: str,
    target_root: str,
    goal: str,
    prompt: str = "",
    edit_mode: str = "read_only",
    session_id: str | None = None,
    workflow_option: str | None = None,
) -> dict[str, Any]:
    """Send one canvas-gated, compact coding task to the owned Code Console route."""
    normalized_root = str(Path(str(target_root or "")).resolve()) if target_root else ""
    context = _CURRENT_CODER_CONTEXT.get()
    if context is None or context.cardRuntime is None:
        return _blocked_coder_result(
            normalized_root,
            "MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE: current_canvas_context_missing",
        )
    if str(project_id or "").strip() != context.session.projectId:
        return _blocked_coder_result(normalized_root, "coder_console_project_id_mismatch")
    if str(edit_mode or "read_only").strip().lower() != "read_only":
        return _blocked_coder_result(
            normalized_root,
            "console_edit_mode_not_supported_in_this_spec",
        )
    if not normalized_root or not Path(normalized_root).is_dir():
        return _blocked_coder_result(normalized_root, "coder_console_target_root_missing")

    roles = {_participant_role(participant) for participant in context.cardRuntime.participants}
    missing = [
        label
        for role, label in (("codegraph", "CodeGraph Agent"), ("local_coder", "Local Coder"))
        if role not in roles
    ]
    if missing:
        return _blocked_coder_result(
            normalized_root,
            f"MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE: missing={','.join(missing)}",
        )

    graph = context.cardRuntime.graph
    if graph is None:
        return _blocked_coder_result(
            normalized_root,
            "MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE: runtime_graph_missing",
        )
    participants = {
        participant.cardId: participant for participant in context.cardRuntime.participants
    }
    cards = []
    for node in graph.nodes:
        participant = participants.get(node.cardId)
        cards.append(
            {
                "id": node.cardId,
                "title": node.title,
                "kind": node.kind,
                "runtimeType": node.runtimeType,
                "runtimeBinding": getattr(participant, "runtimeBinding", None),
                "runtimeOptions": {"role": node.role or getattr(participant, "role", None)},
            }
        )
    task_prompt = build_compact_coder_prompt(
        target_root=normalized_root,
        goal=goal,
        prompt=prompt,
        edit_mode="read_only",
    )
    payload = {
        "projectId": context.session.projectId,
        "repoPath": normalized_root,
        "task": task_prompt,
        "userGoal": _compact_text(goal),
        "generatedSpec": task_prompt,
        "explicitApproval": True,
        "cards": cards,
        "edges": [edge.model_dump() for edge in graph.edges],
        "editMode": "read_only",
        "sessionId": session_id,
        "workflowOption": workflow_option,
    }
    try:
        _, response = await asyncio.to_thread(_post_console_task, payload)
    except RuntimeError as error:
        return _blocked_coder_result(normalized_root, str(error))

    session = response.get("session") if isinstance(response.get("session"), dict) else {}
    routed = bool(response.get("routed"))
    blocker = None if routed else str(response.get("blocked") or response.get("error") or "coder_console_tool_call_blocked")
    result_session_id = str(session.get("id") or "") or None
    coding_run_id = str((response.get("codingRun") or {}).get("id") or "") or None
    result_status_url = (
        f"/api/coder/openclaude/console/runs/{coding_run_id}"
        if coding_run_id
        else None
    )
    provider = str(session.get("provider") or "") or None
    model = str(session.get("model") or "") or None
    transport = str(session.get("transportMode") or "") or None
    if routed:
        message = (
            f"Mag One started a coder task in Code Console session {result_session_id}. "
            f"Target: {normalized_root}. Provider: {provider or 'unknown'}. "
            f"Model: {model or 'unknown'}. Coding run: {coding_run_id or 'unavailable'}. "
            f"Result status: {result_status_url or 'unavailable'}. "
            "Watch the terminal in Code Console."
        )
    else:
        message = f"Mag One could not start the coder task. Blocker: {blocker}"
    return _publish_coder_dispatch({
        "status": "started" if routed else "blocked",
        "session_id": result_session_id,
        "target_root": str(session.get("targetRoot") or normalized_root),
        "provider": provider,
        "model": model,
        "transport": transport,
        "watch_surface": "Code Console",
        "message": message,
        "delivery_status": "accepted" if routed else "blocked",
        "blocker": blocker,
        "coding_run_id": coding_run_id,
        "result_status_url": result_status_url,
    })


# ---------------------------------------------------------------------------
# KnowGraph hybrid retrieval tool (explicit, deliberate, read-only).
# ---------------------------------------------------------------------------


def _load_knowgraph_hybrid_retrieval():
    """Import the KnowGraph Python rails hybrid retrieval capability.

    The Mag One rails (this package) and the KnowGraph rails
    (``services/knowgraph``) are separate. The KnowGraph rails use bare-module
    imports, so its directory is placed on ``sys.path`` (idempotent) and the
    module is imported by name — no TypeScript and no second service involved.
    """
    repo_root = Path(__file__).resolve().parents[4]
    kg_dir = repo_root / "services" / "knowgraph"
    kg_path = str(kg_dir)
    if kg_path not in sys.path:
        sys.path.insert(0, kg_path)
    import hybrid_retrieval  # noqa: E402  (bare-module rails convention)

    return hybrid_retrieval


async def retrieve_knowgraph_context_tool(
    project_id: str,
    query: str,
    anchors: list[str] | None = None,
    task_id: str | None = None,
    max_results: int = 12,
    max_hops: int = 1,
    include_outcomes: list[str] | None = None,
    prior_assertion_ids: list[str] | None = None,
    prior_source_refs: list[str] | None = None,
) -> dict[str, Any]:
    """Mag One tool: retrieve a compact, project-scoped KnowGraph evidence slice.

    Combines exact anchored traversal + Neo4j full-text + local-embedding vector
    retrieval over the single KnowGraph (Neo4j). Read-only. Mag One decides when
    to call this and supplies the bounded request; registering the tool never
    runs it. Returns structured data (dict) preserving each assertion's outcome
    and source identity (sourceRef/title/url).
    """
    module = _load_knowgraph_hybrid_retrieval()
    request = module.KnowGraphRetrievalRequest(
        project_id=str(project_id or "").strip(),
        query=str(query or "").strip(),
        anchors=[str(a).strip() for a in (anchors or []) if str(a).strip()],
        task_id=(str(task_id).strip() or None) if task_id else None,
        max_results=max_results if isinstance(max_results, int) else 12,
        max_hops=max_hops if isinstance(max_hops, int) else 1,
        include_outcomes=(
            [str(o).strip() for o in include_outcomes if str(o).strip()]
            if include_outcomes else list(module.DEFAULT_OUTCOMES)
        ),
        prior_assertion_ids=list(prior_assertion_ids) if prior_assertion_ids else None,
        prior_source_refs=list(prior_source_refs) if prior_source_refs else None,
    )
    # Blocking Neo4j + local embedding call runs off the event loop.
    result = await asyncio.to_thread(module.retrieve_knowgraph_context, request)
    return result.to_dict()


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
        cleaned = str(name or "").strip()
        if not cleaned:
            raise RuntimeError("card_tool_name_empty")
        spec = self._specs.get(cleaned)
        if spec is None:
            raise RuntimeError(
                f"card_tool_unknown: {cleaned} (known: {','.join(self.known_names())})"
            )
        if not spec.enabled:
            raise RuntimeError(f"card_tool_disabled: {cleaned}")
        # ToolSpec validation already guarantees complete schemas; re-check so a
        # mutated spec can never resolve silently.
        if not spec.inputSchema or not spec.outputSchema:
            raise RuntimeError(f"card_tool_schema_missing: {cleaned}")
        return FunctionTool(self._adapters[cleaned], description=spec.description, name=spec.name)

    def resolve_selected(self, selected_names: list[str]) -> list[FunctionTool]:
        """Resolve exactly the card Tools tab selection.

        Registered but unselected tools are never returned; any invalid
        selection aborts the whole resolution rather than degrading silently.
        """
        return [self.resolve_one(name) for name in (selected_names or [])]


def build_default_tool_registry() -> ToolRegistry:
    """The canonical runtime registry."""
    registry = ToolRegistry()
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
            name="coder_console_task",
            description="Send one bounded coding task to the owned Code Console backend.",
            enabled=True,
            inputSchema={
                "type": "object",
                "properties": {
                    "project_id": {"type": "string"},
                    "target_root": {"type": "string"},
                    "goal": {"type": "string"},
                    "prompt": {"type": "string"},
                    "edit_mode": {"type": "string", "default": "read_only"},
                    "session_id": {"type": ["string", "null"]},
                    "workflow_option": {
                        "type": ["string", "null"],
                        "enum": ["run_read_only_coder_task", "draft_spec_for_approval", "plan_only", None]
                    },
                },
                "required": ["project_id", "target_root", "goal"],
            },
            outputSchema={
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["started", "queued", "running", "completed", "failed", "blocked"],
                    },
                    "session_id": {"type": ["string", "null"]},
                    "target_root": {"type": "string"},
                    "provider": {"type": ["string", "null"]},
                    "model": {"type": ["string", "null"]},
                    "transport": {"type": ["string", "null"]},
                    "watch_surface": {"type": "string"},
                    "message": {"type": "string"},
                    "delivery_status": {
                        "type": "string",
                        "enum": ["accepted", "queued", "blocked"],
                    },
                    "blocker": {"type": ["string", "null"]},
                    "coding_run_id": {"type": ["string", "null"]},
                    "result_status_url": {"type": ["string", "null"]},
                },
            },
        ),
        coder_console_task,
    )
    registry.register(
        ToolSpec(
            name="retrieve_knowgraph_context",
            description=(
                "Retrieve a compact, project-scoped KnowGraph evidence slice by combining exact "
                "anchored graph traversal, Neo4j full-text retrieval, and local-embedding vector "
                "retrieval over the one knowledge graph. Read-only; returns source-backed "
                "assertions with outcomes (supported/contradicted/uncertain), contradictions, "
                "one-hop relations, and per-result retrieval reasons. "
                "Use it when the selected task needs source-backed external evidence, "
                "contradictions, uncertainty, or connected KnowGraph evidence. Do not call it "
                "merely because it is attached. Do not use it for unrelated code-only tasks. Do "
                "not treat its returned assertions as unconditional truth; preserve the "
                "supported/contradicted/uncertain outcomes and the sourceRefs."
            ),
            enabled=True,
            inputSchema={
                "type": "object",
                "properties": {
                    "project_id": {"type": "string"},
                    "query": {"type": "string"},
                    "anchors": {"type": "array", "items": {"type": "string"}},
                    "task_id": {"type": ["string", "null"]},
                    "max_results": {"type": "integer", "default": 12},
                    "max_hops": {"type": "integer", "default": 1},
                    "include_outcomes": {"type": "array", "items": {"type": "string"}},
                    "prior_assertion_ids": {"type": "array", "items": {"type": "string"}},
                    "prior_source_refs": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["project_id", "query"],
            },
            outputSchema={
                "type": "object",
                "properties": {
                    "project_id": {"type": "string"},
                    "anchors": {"type": "array", "items": {"type": "string"}},
                    "retrieval_modes": {"type": "object"},
                    "assertions": {"type": "array"},
                    "evidence": {"type": "array"},
                    "relations": {"type": "array"},
                    "contradictions": {"type": "array"},
                    "uncertainties": {"type": "array"},
                    "next_anchor_suggestions": {"type": "array"},
                    "excluded_as_seen": {"type": "array"},
                    "retrieval_notes": {"type": "array"},
                },
            },
        ),
        retrieve_knowgraph_context_tool,
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
    "retrieve_knowgraph_context": {
        "displayName": "KnowGraph Hybrid Retrieval",
        # Mag One capability, held by the Mag One team's participant agents. The
        # existing runtime attaches per-participant tools (assistant_agent cards
        # that are bus-connected to the Mag One orchestrator), so both the Mag One
        # orchestrator card and its assistant_agent team cards are compatible.
        "agentCompatibility": ["magentic_one", "assistant_agent"],
    },
    "coder_console_task": {
        "displayName": "Coder Console Task",
        "agentCompatibility": ["magentic_one"],
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
