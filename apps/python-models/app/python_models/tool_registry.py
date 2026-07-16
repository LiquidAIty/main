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
from uuid import uuid4

from autogen_core.tools import FunctionTool

from app.python_models import job_folder as jf
from app.python_models.web_search import web_search
from app.python_models.orchestration_contracts import ContextPack, ToolSpec
from app.python_models.hermes.review_completed_job import review_completed_job
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
    conversation_id: str,
    anchors: list[str] | None = None,
    goal_id: str | None = None,
    episode_id: str | None = None,
    job_id: str | None = None,
    requesting_role: str = "main_chat",
    parent_view_id: str | None = None,
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
    payload = result.to_dict()
    records = []
    selected_ids = []
    for rank, assertion in enumerate(result.assertions, start=1):
        canonical_id = str(assertion.get("assertion_id") or assertion.get("id") or "").strip()
        summary = str(assertion.get("text") or "").strip()
        if not canonical_id or not summary:
            continue
        selected_ids.append(canonical_id)
        reasons = [str(reason).strip() for reason in assertion.get("retrieval_reasons") or [] if str(reason).strip()]
        provenance_refs = [
            str(value).strip()
            for value in [assertion.get("source_url"), assertion.get("document_id"), *(assertion.get("chunk_refs") or [])]
            if str(value or "").strip()
        ]
        records.append({
            "canonicalId": canonical_id,
            "summary": summary,
            "selectionReason": " · ".join(reasons) or "Selected by canonical KnowGraph retrieval",
            "relevance": assertion.get("fused_score"),
            "rank": rank,
            "provenanceRefs": provenance_refs[:12],
            "estimatedCharacters": len(summary),
            "estimatedTokens": max(1, (len(summary) + 3) // 4),
        })
    now = datetime.now(timezone.utc).isoformat()
    included_relationships = []
    selected_set = set(selected_ids)
    for index, relation in enumerate(result.relations):
        source = str(relation.get("source") or relation.get("subject") or "").strip()
        target = str(relation.get("target") or relation.get("object") or "").strip()
        relation_type = str(relation.get("type") or relation.get("predicate") or "RELATED_TO").strip()
        if source in selected_set and target in selected_set:
            included_relationships.append({
                "id": str(relation.get("id") or f"knowgraph:{source}:{relation_type}:{target}:{index}"),
                "source": source,
                "target": target,
                "type": relation_type,
            })
    payload["graphView"] = {
        "schemaVersion": "graph-view.v1",
        "viewId": f"knowgraph:{uuid4()}",
        "authority": "knowgraph",
        "status": "returned",
        "projectId": str(project_id or "").strip(),
        "conversationId": str(conversation_id or "").strip(),
        "goalId": str(goal_id or "").strip() or None,
        "episodeId": str(episode_id or "").strip() or None,
        "jobId": str(job_id or task_id or "").strip() or None,
        "producingRole": "hermes",
        "receivingRole": str(requesting_role or "main_chat").strip(),
        "rootCanonicalNodeIds": selected_ids[:3],
        "includedCanonicalNodeIds": selected_ids,
        "includedRelationships": included_relationships,
        "query": str(query or "").strip(),
        "filter": {"nodeTypes": ["SourceBackedAssertion"], "trustStates": []},
        "hopDepth": max(0, int(max_hops or 0)),
        "provenanceRefs": list(dict.fromkeys(ref for record in records for ref in record["provenanceRefs"]))[:40],
        "note": "Filtered KnowGraph evidence returned by Hermes retrieval",
        "parentViewId": str(parent_view_id or "").strip() or None,
        "records": records,
        "omittedNeighborCount": result.omitted_neighbor_count,
        "createdAt": now,
        "updatedAt": now,
    }
    return payload


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
# ThinkGraph card tools (scoped internal tools, not public Harness tools).
#
# Authority NEVER comes from the model: it is injected by the single-card
# runtime (run_configured_card) from the server-authored runtimeScope via this
# ContextVar. A call outside an authorized ThinkGraph card run fails honestly.
# Persistence itself lives in the backend (thinkGraphStore) — these adapters
# are transport to the mcp-bridge endpoints on loopback.
# ---------------------------------------------------------------------------

THINKGRAPH_RUN_AUTHORITY: ContextVar[dict[str, str] | None] = ContextVar(
    "thinkgraph_run_authority", default=None
)

# Honest record of authorized patch results observed inside the CURRENT card run.
# Set to a fresh list by the single-card runtime for profiled ThinkGraph runs; the
# terminal-contract post-hook reads it. Never model-writable, never persisted here.
THINKGRAPH_PATCH_EVENTS: ContextVar[list[dict[str, Any]] | None] = ContextVar(
    "thinkgraph_patch_events", default=None
)


def _record_patch_event(raw_result: str) -> None:
    events = THINKGRAPH_PATCH_EVENTS.get()
    if events is None:
        return
    try:
        parsed = json.loads(raw_result)
    except json.JSONDecodeError:
        return
    if isinstance(parsed, dict) and parsed.get("ok") is True:
        events.append(
            {
                "status": str(parsed.get("status") or ""),
                "correlationId": str(parsed.get("correlationId") or ""),
                "storedResourceIds": parsed.get("storedResourceIds") or [],
                "storedStatementIds": parsed.get("storedStatementIds") or [],
                "relationCount": parsed.get("relationCount") or 0,
            }
        )


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


def _require_thinkgraph_authority() -> dict[str, str] | None:
    authority = THINKGRAPH_RUN_AUTHORITY.get()
    if not authority or authority.get("kind") != "thinkgraph_card_run":
        return None
    return authority


async def read_thinkgraph_scope_tool(limit: int | None = None) -> str:
    """ThinkGraph card tool: read the bounded active-project graph scope.

    Read-only. Project scope comes from the trusted card-run authority — a call
    outside an authorized ThinkGraph card run fails honestly.
    """
    authority = _require_thinkgraph_authority()
    if authority is None:
        return json.dumps({"ok": False, "error": "thinkgraph_authority_missing: tool is only available inside an authorized ThinkGraph card run"})
    return await asyncio.to_thread(
        _post_backend_json_sync,
        "/api/coder/mcp-bridge/thinkgraph_read_scope",
        {"authority": authority, "limit": limit if isinstance(limit, int) else None},
    )


async def apply_thinkgraph_patch_tool(
    resources: list[dict[str, Any]] | None = None,
    relations: list[dict[str, Any]] | None = None,
    statements: list[dict[str, Any]] | None = None,
) -> str:
    """ThinkGraph card tool: apply ONE compact graph patch.

    The model supplies only the patch body (resources / relations / statements).
    Authority (project, card, run, source pair) is injected from the trusted run
    context — any model-supplied authority is ignored by construction. One AGE
    transaction, idempotent per run, complete source-pair provenance enforced by
    the backend writer.
    """
    authority = _require_thinkgraph_authority()
    if authority is None:
        return json.dumps({"ok": False, "error": "thinkgraph_authority_missing: tool is only available inside an authorized ThinkGraph card run"})
    patch = {
        "resources": resources or [],
        "relations": relations or [],
        "statements": statements or [],
    }
    result = await asyncio.to_thread(
        _post_backend_json_sync,
        "/api/coder/mcp-bridge/thinkgraph_apply_patch",
        {"authority": authority, "patch": patch},
    )
    _record_patch_event(result)
    return result


# ---------------------------------------------------------------------------
# Hermes completed-job review — the ONE MCP tool over the single review scaffold.
#
# Intended invocation boundary: an authorized agent calls this one tool, which
# dispatches to review_completed_job (the single scaffold). The review runtime is
# NOT built yet, so it honestly reports not-implemented and never fabricates a
# review. Takes one trusted opaque job id — never an arbitrary filesystem path;
# server-owned folder resolution is a TODO for when the review is implemented.
# There is exactly one review tool (it will later review both Coder and Mag One
# completed-job folders — never producer-specific tools).
# ---------------------------------------------------------------------------


async def hermes_review_completed_job_tool(job_id: str) -> str:
    """One MCP entrypoint for the future Hermes completed-job review. Scaffold
    only: dispatches to review_completed_job, which is not implemented yet."""
    jid = str(job_id or "").strip()
    if not jid:
        return json.dumps({"ok": False, "error": "job_id_required"})
    try:
        # No evaluation logic lives here — the scaffold owns the (future) review.
        review_completed_job(jid)
    except NotImplementedError as err:
        return json.dumps({"ok": False, "error": str(err)})
    # TODO: when review_completed_job returns a ReviewResult, serialize it here.
    return json.dumps({"ok": False, "error": "review_completed_job_not_implemented"})


# ---------------------------------------------------------------------------
# Job-folder return writer (run-scoped, NOT a card-selectable tool).
#
# Available ONLY inside an explicit Coder job-folder handoff run: the single-run
# writable surface is the server-assigned returns/<job-id>/ directory. Authority
# (the resolved JobFolder) is injected by run_native_magentic_mission via this
# ContextVar — never from the model. A call outside an authorized handoff run
# fails honestly. This never writes into the source working tree and is not
# registered in the card tool registry, so no saved card/deck is affected.
# ---------------------------------------------------------------------------

JOB_RETURN_ROOT: ContextVar[jf.JobFolder | None] = ContextVar("job_return_root", default=None)


async def write_return_file_tool(card_id: str, path: str, content: str) -> str:
    """Create a real deliverable file under THIS agent's returns/<run-id>/<card-id>/.

    ``card_id`` is the fixed trusted card of the calling agent (injected per tool,
    never a model argument); ``path`` is RELATIVE beneath that agent's own subdir.
    Absolute paths, traversal, symlink escapes, and writes into another agent's
    folder are rejected. Returns JSON with the actual workspace-relative path.
    """
    folder = JOB_RETURN_ROOT.get()
    if folder is None:
        return json.dumps(
            {
                "ok": False,
                "error": "job_return_authority_missing: write_return_file is only available inside a job-folder run",
            }
        )
    try:
        written = await asyncio.to_thread(
            jf.write_return_file, folder, str(card_id or ""), str(path or ""), str(content or "")
        )
    except (ValueError, OSError) as err:
        return json.dumps({"ok": False, "error": str(err)})
    return json.dumps({"ok": True, "path": written})


def build_return_writer_tool(card_id: str) -> FunctionTool:
    """Fresh run-scoped return-writer FunctionTool bound to ONE agent's card id.

    Attached per participant by ``_build_participants``, so each agent can only write
    beneath returns/<run-id>/<its-own-card-id>/. The model supplies only path +
    content — the card id is fixed here (trusted run context), so an agent can never
    target another agent's folder. NOT in the card tool registry/manifest.
    """
    async def _adapter(path: str, content: str) -> str:
        return await write_return_file_tool(card_id, path, content)

    return FunctionTool(
        _adapter,
        name="write_return_file",
        description=(
            "Job-folder run only: create a real deliverable file under THIS agent's assigned "
            "returns/<run-id>/<your-card-id>/ directory. Arguments: path (a RELATIVE path under your "
            "own return subdir, e.g. 'proposed/example.patch') and content (the file's full text). "
            "Needed subdirectories are created. Absolute paths, traversal, and any path escaping your "
            "subdir are rejected; it never writes into the source tree or another agent's folder. Use "
            "it to place proposed patches, changed-file copies, reports, or generated files for the "
            "Coder to inspect. Returns the workspace-relative path written."
        ),
    )


# ---------------------------------------------------------------------------
# Local Coder tool — run a real coding task through the LocalCoder engine.
# ---------------------------------------------------------------------------


async def run_local_coder(
    objective: str,
    plan_excerpt: str = "",
    context_summary: str = "",
    guardrails: list[str] | None = None,
    allowed_files: list[str] | None = None,
    forbidden_work: list[str] | None = None,
    proof_required: list[str] | None = None,
    stop_conditions: list[str] | None = None,
    code_anchors: list[str] | None = None,
    cbm_queries: list[str] | None = None,
    report_format: str = "Return a CoderReport JSON: status, filesChanged, proofResults, blockers, nextRecommendedTask.",
    write_mode: str = "read-only",
    project_id: str = "default",
) -> str:
    """Run a real coding task through the LocalCoder engine; return its CoderReport.

    The model supplies ONLY the logical coding task. The coder's filesystem root is
    injected server-side by the backend (trusted, never model-chosen) and the run id
    is server-minted. Returns the authoritative CoderReport JSON verbatim — no
    fabricated success and no fallback: a blocked/failed run is reported honestly.
    """
    packet = {
        "projectId": str(project_id or "default").strip() or "default",
        "objective": str(objective or "").strip(),
        "planExcerpt": str(plan_excerpt or "").strip() or str(objective or "").strip(),
        "contextSummary": str(context_summary or "").strip() or "Provided by the orchestrator run.",
        "codeAnchors": [str(x) for x in (code_anchors or []) if str(x).strip()],
        "cbmQueries": [str(x) for x in (cbm_queries or []) if str(x).strip()],
        "guardrails": [str(x) for x in (guardrails or []) if str(x).strip()],
        "allowedFiles": [str(x) for x in (allowed_files or []) if str(x).strip()],
        "forbiddenWork": [str(x) for x in (forbidden_work or []) if str(x).strip()],
        "proofRequired": [str(x) for x in (proof_required or []) if str(x).strip()],
        "reportFormat": str(report_format or "").strip() or "CoderReport JSON",
        "stopConditions": [str(x) for x in (stop_conditions or []) if str(x).strip()],
        "writeMode": "edit" if str(write_mode or "").strip().lower() == "edit" else "read-only",
    }
    return await asyncio.to_thread(
        _post_backend_json_sync,
        "/api/coder/localcoder/run",
        {"coderPacket": packet},
    )


def build_local_coder_tool(model_provider: str, provider_model_id: str) -> FunctionTool:
    """Create a run_local_coder tool bound to the trusted participant model.

    Provider/model come from the backend-authored card runtime, not from model
    arguments, so a tool call can carry the saved card selection without exposing
    those runtime controls to the assistant.
    """
    provider = str(model_provider or "").strip()
    model_id = str(provider_model_id or "").strip()

    async def _adapter_with_model(
        objective: str,
        plan_excerpt: str = "",
        context_summary: str = "",
        guardrails: list[str] | None = None,
        allowed_files: list[str] | None = None,
        forbidden_work: list[str] | None = None,
        proof_required: list[str] | None = None,
        stop_conditions: list[str] | None = None,
        code_anchors: list[str] | None = None,
        cbm_queries: list[str] | None = None,
        report_format: str = "Return a CoderReport JSON: status, filesChanged, proofResults, blockers, nextRecommendedTask.",
        write_mode: str = "read-only",
        project_id: str = "default",
    ) -> str:
        packet = {
            "projectId": str(project_id or "default").strip() or "default",
            "objective": str(objective or "").strip(),
            "planExcerpt": str(plan_excerpt or "").strip() or str(objective or "").strip(),
            "contextSummary": str(context_summary or "").strip() or "Provided by the orchestrator run.",
            "codeAnchors": [str(x) for x in (code_anchors or []) if str(x).strip()],
            "cbmQueries": [str(x) for x in (cbm_queries or []) if str(x).strip()],
            "guardrails": [str(x) for x in (guardrails or []) if str(x).strip()],
            "allowedFiles": [str(x) for x in (allowed_files or []) if str(x).strip()],
            "forbiddenWork": [str(x) for x in (forbidden_work or []) if str(x).strip()],
            "proofRequired": [str(x) for x in (proof_required or []) if str(x).strip()],
            "reportFormat": str(report_format or "").strip() or "CoderReport JSON",
            "stopConditions": [str(x) for x in (stop_conditions or []) if str(x).strip()],
            "writeMode": "edit" if str(write_mode or "").strip().lower() == "edit" else "read-only",
            "modelProvider": provider,
            "providerModelId": model_id,
        }
        return await asyncio.to_thread(
            _post_backend_json_sync,
            "/api/coder/localcoder/run",
            {"coderPacket": packet},
        )

    return FunctionTool(
        _adapter_with_model,
        description=DEFAULT_TOOL_REGISTRY.spec("run_local_coder").description,
        name="run_local_coder",
    )


# ---------------------------------------------------------------------------
# ToolRegistry.
# ---------------------------------------------------------------------------

# Canonical capability id (stored on cards, exposed by the harness MCP surface)
# → this runtime's registered implementation. One explicit table, never a
# rename sweep and never a duplicate registration.
CANONICAL_TOOL_ALIASES: dict[str, str] = {
    "thinkgraph.get_graph_slice": "read_thinkgraph_scope",
    "thinkgraph.submit_update": "apply_thinkgraph_patch",
    "knowgraph.query": "retrieve_knowgraph_context",
}


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
        # Canonical capability ids (the names cards store, shared with the
        # harness MCP surface) resolve to this runtime's own implementation.
        # Only proven same-capability pairs are aliased — knowgraph.query IS
        # retrieve_knowgraph_context (mcp_host.py calls it directly), and the
        # thinkgraph pair is this runtime's read/write of the same authority.
        # Anything else stays loudly unknown: a capability without an adapter
        # in THIS runtime must fail here, never silently degrade.
        cleaned = CANONICAL_TOOL_ALIASES.get(cleaned, cleaned)
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
    for spec, adapter in [
        (ToolSpec(name="worldsignals.capabilities", description="Read the live WorldSignals capability and command manifests.", enabled=True, inputSchema={"type": "object", "properties": {}, "required": []}, outputSchema={"type": "object"}), worldsignals_capabilities),
        (ToolSpec(name="worldsignals.command", description="Run one real command from the WorldSignals command manifest.", enabled=True, inputSchema={"type": "object", "properties": {"command": {"type": "string"}, "arguments": {"type": "object"}}, "required": ["command"]}, outputSchema={"type": "object"}), worldsignals_command),
        (ToolSpec(name="worldsignals.batch", description="Run up to twenty real WorldSignals commands through its batch channel.", enabled=True, inputSchema={"type": "object", "properties": {"commands": {"type": "array", "items": {"type": "object"}, "maxItems": 20}}, "required": ["commands"]}, outputSchema={"type": "object"}), worldsignals_batch),
        (ToolSpec(name="worldsignals.poll", description="Poll completed command results and pending WorldSignals tasks.", enabled=True, inputSchema={"type": "object", "properties": {}, "required": []}, outputSchema={"type": "object"}), worldsignals_poll),
        (ToolSpec(name="worldsignals.stream_events", description="Read a bounded set of real-time events from the WorldSignals SSE channel.", enabled=True, inputSchema={"type": "object", "properties": {"max_events": {"type": "integer", "default": 1}, "timeout_seconds": {"type": "integer", "default": 15}}, "required": []}, outputSchema={"type": "object"}), worldsignals_stream_events),
    ]:
        registry.register(spec, adapter)
    registry.register(
        ToolSpec(
            name="read_thinkgraph_scope",
            description=(
                "ThinkGraph card only: read the bounded active-project ThinkGraph scope "
                "(record ids, labels, kinds, provenance) so patches avoid duplicates. "
                "Read-only; scope comes from the trusted card-run authority."
            ),
            enabled=True,
            inputSchema={
                "type": "object",
                "properties": {"limit": {"type": "number"}},
                "required": [],
            },
            outputSchema={"type": "string", "description": "JSON bounded scope with provenance"},
        ),
        read_thinkgraph_scope_tool,
    )
    registry.register(
        ToolSpec(
            name="apply_thinkgraph_patch",
            description=(
                "Apply ONE graph patch. EXACT input shape — "
                'resources: [{"id": string, "label": string, "properties"?: {key: string|number|bool}}]; '
                'relations: [{"a": resourceId, "b": resourceId}]; '
                'statements: [{"id": string, "subject": resourceId, "predicateTerm": string, '
                '"object": resourceId, "rationale"?: string, "review"?: string, '
                '"properties"?: {key: string|number|bool}}]. '
                "A subject or object resourceId that does not resolve to an existing or "
                "newly-declared resource in this same patch causes the whole patch to be rejected. "
                "Authority (project, card, run, source pair) comes from the trusted run context; "
                "one transaction, idempotent per run."
            ),
            enabled=True,
            inputSchema={
                "type": "object",
                "properties": {
                    "resources": {"type": "array", "items": {"type": "object"}},
                    "relations": {"type": "array", "items": {"type": "object"}},
                    "statements": {"type": "array", "items": {"type": "object"}},
                },
                "required": [],
            },
            outputSchema={"type": "string", "description": "JSON honest applied/duplicate/empty result"},
        ),
        apply_thinkgraph_patch_tool,
    )
    registry.register(
        ToolSpec(
            name="hermes_review_completed_job",
            description=(
                "Hermes: review ONE completed job folder (Coder or Mag One) and return a "
                "single ReviewResult. SCAFFOLD ONLY — the review runtime is not built yet, "
                "so this honestly reports not-implemented and never fabricates a review. "
                "Input: job_id = one trusted opaque job identifier; the server resolves the "
                "completed-job folder (never an arbitrary filesystem path)."
            ),
            enabled=True,
            inputSchema={
                "type": "object",
                "properties": {"job_id": {"type": "string"}},
                "required": ["job_id"],
            },
            outputSchema={
                "type": "string",
                "description": "JSON {ok:false, error} — scaffold reports not-implemented (ReviewResult is a TODO)",
            },
        ),
        hermes_review_completed_job_tool,
    )
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
            name="web_search",
            description=(
                "Real web search via Tavily. Returns real result pages (url, title, domain, "
                "content excerpt, published date) for the agent to read and select. Read-only "
                "and never fabricates results; pair with knowgraph.ingest to persist selected "
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
    # ThinkGraph card-scoped tools: attachable ONLY on assistant_agent cards (the
    # ThinkGraph card). They execute only inside an authorized ThinkGraph card run
    # (trusted run authority) — attaching them elsewhere fails honestly at run time.
    "read_thinkgraph_scope": {
        "displayName": "ThinkGraph Scope (read)",
        "agentCompatibility": ["assistant_agent"],
    },
    "apply_thinkgraph_patch": {
        "displayName": "ThinkGraph Patch (authorized write)",
        "agentCompatibility": ["assistant_agent"],
    },
    "hermes_review_completed_job": {
        "displayName": "Hermes Completed-Job Review",
        "agentCompatibility": ["assistant_agent"],
    },
    "run_local_coder": {
        "displayName": "Local Coder",
        "agentCompatibility": ["magentic_one", "assistant_agent"],
    },
    "retrieve_knowgraph_context": {
        "displayName": "KnowGraph Hybrid Retrieval",
        # Mag One capability, held by the Mag One team's participant agents. The
        # existing runtime attaches per-participant tools (assistant_agent cards
        # that are bus-connected to the Mag One orchestrator), so both the Mag One
        # orchestrator card and its assistant_agent team cards are compatible.
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
