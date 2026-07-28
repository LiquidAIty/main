from fastapi import FastAPI, HTTPException
from typing import Any

from app.python_models.alpaca_market_data import (
    AlpacaInstrumentRef,
    get_historical_bars,
    get_market_snapshot,
    get_paper_account_readiness,
)
from app.python_models.autogen_orchestrator import orchestrate_context_pack
from app.python_models.magentic_agentchat import run_configured_card
from app.python_models.orchestration_contracts import ContextPack
from app.python_models.tool_registry import tool_manifest

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Read-only Alpaca paper market data (no orders, no balances, no mutation).
# The frontend /tradingui surface consumes these via the vite /market proxy.
# ---------------------------------------------------------------------------


@app.get("/market/snapshot")
def market_snapshot(symbol: str, feed: str = "iex"):
    """Latest Alpaca paper snapshot for an explicit symbol. Read-only."""
    if not str(symbol or "").strip():
        raise HTTPException(status_code=400, detail="symbol required")
    return get_market_snapshot(AlpacaInstrumentRef(symbol.strip()), feed=feed).to_dict()


@app.get("/market/bars")
def market_bars(
    symbol: str,
    timeframe: str = "1Day",
    start: str | None = None,
    end: str | None = None,
    limit: int = 30,
    feed: str = "iex",
):
    """Bounded Alpaca paper historical bars for an explicit symbol/timeframe. Read-only."""
    if not str(symbol or "").strip():
        raise HTTPException(status_code=400, detail="symbol required")
    return get_historical_bars(
        AlpacaInstrumentRef(symbol.strip()), timeframe,
        start=start, end=end, limit=limit, feed=feed,
    ).to_dict()


@app.get("/market/paper-account-readiness")
def market_paper_account_readiness():
    """Alpaca paper account availability/status only. No balances, positions, or orders."""
    return get_paper_account_readiness().to_dict()


@app.get("/tools/manifest")
def tools_manifest():
    """Read-only capability manifest from the real Mag One tool registry.

    The registry is the single source of truth; the frontend renders this to
    surface available Mag One capabilities on the existing card Tools surface.
    """
    return {"tools": tool_manifest()}


@app.post("/autogen/orchestrate")
async def autogen_orchestrate(req: ContextPack):
    try:
        return await orchestrate_context_pack(req)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/thinkgraph/projection")
def thinkgraph_projection(
    projectId: str,
    limit: int | None = None,
    includeHistorical: bool = False,
    memoryType: str | None = None,
):
    """Engraphis-v2-backed canonical ThinkGraph projection."""
    from app.python_models.thinkgraph_engraphis import get_thinkgraph

    cleaned = str(projectId or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="projectId required")
    try:
        return get_thinkgraph().projection(
            cleaned,
            limit=limit or 500,
            include_historical=includeHistorical,
            memory_type=memoryType,
        )
    except Exception as err:  # honest read failure — no fallback projection
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/unified/context")
def unified_context(
    projectId: str,
    conversationId: str,
    role: str = "main_chat",
    activeGraphViewId: str | None = None,
    knowgraphScope: str | None = None,
    thinkLimit: int = 5000,
    knowLimit: int = 50000,
    codeLimit: int = 50000,
):
    """One bounded context payload shared by the Unified scene and agent delivery."""
    from app.python_models.unified_context import UnifiedContextRequest, build_unified_context
    try:
        return build_unified_context(UnifiedContextRequest(
            project_id=projectId,
            conversation_id=conversationId,
            role=role,
            active_view_id=activeGraphViewId,
            knowgraph_scope=knowgraphScope,
            think_limit=thinkLimit,
            know_limit=knowLimit,
            code_limit=codeLimit,
        ))
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/unified/model-context")
def unified_model_context(
    projectionId: str,
    projectId: str,
    conversationId: str,
    role: str = "main_chat",
    activeGraphViewId: str | None = None,
    knowgraphScope: str | None = None,
    thinkLimit: int = 5000,
    knowLimit: int = 50000,
    codeLimit: int = 50000,
):
    """Compact model representation resolved through the persistent authorities:
    deterministic rebuild + content-hash equality with the id the client saw."""
    from app.python_models.unified_context import UnifiedContextRequest, build_model_context
    try:
        return build_model_context(projectionId, UnifiedContextRequest(
            project_id=projectId,
            conversation_id=conversationId,
            role=role,
            active_view_id=activeGraphViewId,
            knowgraph_scope=knowgraphScope,
            think_limit=thinkLimit,
            know_limit=knowLimit,
            code_limit=codeLimit,
        ))
    except ValueError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.post("/unified/object-context")
def unified_object_context(payload: dict[str, Any]):
    """Resolve identity-only selected graph objects into bounded Main context."""
    from app.python_models.unified_context import build_graph_object_context
    try:
        return build_graph_object_context(
            str(payload.get("projectId") or ""),
            str(payload.get("conversationId") or ""),
            list(payload.get("references") or []),
        )
    except ValueError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/unified/doorway-context")
def unified_doorway_context(projectId: str, conversationId: str, viewIds: str):
    """Compact rendering of persisted Graph View records for a child doorway —
    resolved by id from the persistent store, never from caller-supplied JSON."""
    from app.python_models.thinkgraph_engraphis import get_thinkgraph
    from app.python_models.unified_context import (
        graph_view_identities,
        render_graph_views,
        select_persisted_graph_views,
    )
    requested = [view_id for view_id in (part.strip() for part in viewIds.split(",")) if view_id]
    if not requested:
        raise HTTPException(status_code=400, detail="view_ids_required")
    try:
        persisted = get_thinkgraph().graph_views(projectId, conversationId).get("views") or []
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
    try:
        views = select_persisted_graph_views(
            list(persisted),
            requested,
            project_id=projectId,
            conversation_id=conversationId,
            receiving_roles={"coder", "main_chat"},
        )
    except ValueError as err:
        detail = str(err)
        raise HTTPException(
            status_code=404 if detail.startswith("graph_view_unknown:") else 409,
            detail=detail,
        ) from err
    rendered = render_graph_views(views)
    return {"ok": True, "projectId": projectId, "conversationId": conversationId,
              "viewIds": requested, "views": graph_view_identities(views),
            "modelContext": rendered["text"], "measurements": rendered["measurements"]}


@app.get("/thinkgraph/context-view")
def thinkgraph_context_view(projectId: str, conversationId: str, role: str = "main_chat", activeGraphViewId: str | None = None, limit: int = 80, expansionDepth: int = 0):
    from app.python_models.thinkgraph_context import resolve_thinkgraph_context
    from app.python_models.thinkgraph_engraphis import get_thinkgraph
    try:
        return resolve_thinkgraph_context(get_thinkgraph(), project_id=projectId, conversation_id=conversationId, receiving_role=role, active_view_id=activeGraphViewId, limit=limit, extra_hops=expansionDepth)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/thinkgraph/health")
def thinkgraph_health():
    """Load and report the real local embedding engine; never a fallback."""
    from app.python_models.thinkgraph_engraphis import get_thinkgraph
    try:
        return {"status": "ok", **get_thinkgraph().model_info}
    except Exception as err:
        raise HTTPException(status_code=503, detail=str(err)) from err


@app.post("/thinkgraph/apply-patch")
def thinkgraph_apply_patch(payload: dict):
    from app.python_models.thinkgraph_engraphis import get_thinkgraph
    try:
        return get_thinkgraph().apply_patch(payload.get("authority") or {}, payload.get("patch") or {})
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.post("/thinkgraph/graph-views")
def thinkgraph_store_graph_view(payload: dict):
    from app.python_models.thinkgraph_engraphis import get_thinkgraph
    try:
        return get_thinkgraph().persist_graph_view(payload.get("view") or {})
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.post("/thinkgraph/graph-views/transition")
def thinkgraph_transition_graph_views(payload: dict):
    """Update lifecycle for exact persisted IDs without moving view content."""
    from app.python_models.thinkgraph_engraphis import get_thinkgraph
    from app.python_models.unified_context import transition_persisted_graph_views
    try:
        views = transition_persisted_graph_views(
            get_thinkgraph(),
            project_id=str(payload.get("projectId") or ""),
            conversation_id=str(payload.get("conversationId") or ""),
            view_ids=list(payload.get("viewIds") or []),
            status=str(payload.get("status") or ""),
            invocation_id=str(payload.get("invocationId") or "") or None,
            runtime=dict(payload.get("runtime") or {}) if payload.get("runtime") is not None else None,
        )
        return {"ok": True, "views": views}
    except ValueError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/thinkgraph/graph-views")
def thinkgraph_graph_views(projectId: str, conversationId: str | None = None):
    from app.python_models.thinkgraph_engraphis import get_thinkgraph
    try:
        return get_thinkgraph().graph_views(projectId, conversationId)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/agentgraph/assignments/{assignment_id:path}")
def agentgraph_read_assignment(
    assignment_id: str,
    projectId: str,
    receiverCardId: str,
):
    """Read one exact assignment by identity; no latest selection or scan."""
    from app.python_models.agentgraph import read_assignment

    try:
        return read_assignment(
            project_id=projectId,
            assignment_id=assignment_id,
            receiving_card_id=receiverCardId,
        )
    except (ValueError, LookupError, PermissionError) as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.post("/agentgraph/assignments/begin")
def agentgraph_begin_assignment(payload: dict[str, Any]):
    """Begin one Python-owned outer assignment before a saved runtime executes."""
    from app.python_models.agentgraph import AgentGraphError, begin_assignment

    try:
        return begin_assignment(
            project_id=str(payload.get("projectId") or ""),
            deck_id=str(payload.get("deckId") or ""),
            conversation_id=str(payload.get("conversationId") or ""),
            correlation_id=str(payload.get("correlationId") or ""),
            sender_card_id=str(payload.get("senderCardId") or ""),
            receiver_card_id=str(payload.get("receiverCardId") or ""),
            body=str(payload.get("instruction") or ""),
            parent_correlation_id=(
                str(payload.get("parentRunId") or "") or None
            ),
            references=list(payload.get("references") or []),
            runtime=str(payload.get("runtime") or "") or None,
            provider=str(payload.get("provider") or "") or None,
            model_key=str(payload.get("modelKey") or "") or None,
            provider_model_id=(
                str(payload.get("providerModelId") or "") or None
            ),
        )
    except (AgentGraphError, ValueError, LookupError, PermissionError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.post("/agentgraph/assignments/{assignment_id:path}/finish")
def agentgraph_finish_assignment(
    assignment_id: str,
    payload: dict[str, Any],
):
    """Finish the same claimed outer assignment with its real runtime result."""
    from app.python_models.agentgraph import AgentGraphError, finish_assignment

    try:
        return finish_assignment(
            project_id=str(payload.get("projectId") or ""),
            assignment_id=assignment_id,
            claim_token=str(payload.get("claimToken") or ""),
            status=str(payload.get("status") or ""),
            output=(
                str(payload["output"])
                if payload.get("output") is not None
                else None
            ),
            summary=(
                str(payload["summary"])
                if payload.get("summary") is not None
                else None
            ),
            error_code=(
                str(payload["errorCode"])
                if payload.get("errorCode") is not None
                else None
            ),
            error_detail=(
                str(payload["errorDetail"])
                if payload.get("errorDetail") is not None
                else None
            ),
            tool_evidence=list(payload.get("toolEvidence") or []),
        )
    except (AgentGraphError, ValueError, LookupError, PermissionError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.post("/agentgraph/hermes/reports")
def agentgraph_write_hermes_report(payload: dict[str, Any]):
    from app.python_models.hermes_agentgraph import write_hermes_report

    try:
        return write_hermes_report(
            parent_run_id=str(payload.get("parentRunId") or ""),
            receiver_card_id=str(payload.get("receiverCardId") or ""),
            report_markdown=str(payload.get("reportMarkdown") or ""),
            summary=str(payload.get("summary") or ""),
            thinkgraph_ids=[
                str(value) for value in (payload.get("thinkGraphNodeIds") or [])
            ],
            knowgraph_refs=[
                str(value) for value in (payload.get("knowGraphRefs") or [])
            ],
            codegraph_refs=[
                str(value) for value in (payload.get("codeGraphRefs") or [])
            ],
        )
    except (ValueError, LookupError, PermissionError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/agentgraph/hermes/reports/{parent_run_id}")
def agentgraph_read_hermes_report(parent_run_id: str, receiverCardId: str):
    from app.python_models.hermes_agentgraph import read_hermes_report

    try:
        report = read_hermes_report(
            parent_run_id=parent_run_id,
            receiver_card_id=receiverCardId,
        )
        if report is None:
            raise HTTPException(status_code=404, detail="hermes_report_not_found")
        return {"ok": True, "report": report}
    except HTTPException:
        raise
    except (ValueError, LookupError, PermissionError) as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/thinkgraph/scope")
def thinkgraph_scope(projectId: str, limit: int | None = None):
    from app.python_models.thinkgraph_engraphis import get_thinkgraph
    try:
        projection = get_thinkgraph().projection(projectId, limit=limit or 300)
        return {"nodes": projection["nodes"], "edges": projection["edges"]}
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/thinkgraph/record/{canonical_id:path}")
def thinkgraph_record(canonical_id: str, projectId: str):
    from app.python_models.thinkgraph_engraphis import get_thinkgraph
    record = get_thinkgraph().get_record(projectId, canonical_id)
    if record is None:
        raise HTTPException(status_code=404, detail="thinkgraph_record_not_found")
    return record


@app.get("/thinkgraph/neighborhood/{canonical_id:path}")
def thinkgraph_neighborhood(canonical_id: str, projectId: str):
    from app.python_models.thinkgraph_engraphis import get_thinkgraph
    return get_thinkgraph().neighborhood(projectId, canonical_id)


@app.post("/thinkgraph/recall")
def thinkgraph_recall(payload: dict):
    from app.python_models.thinkgraph_engraphis import get_thinkgraph
    project_id = str(payload.get("projectId") or "").strip()
    query = str(payload.get("query") or "").strip()
    if not project_id or not query:
        raise HTTPException(status_code=400, detail="projectId and query required")
    return get_thinkgraph().recall(
        project_id,
        query,
        k=int(payload.get("limit") or 8),
        memory_type=payload.get("memoryType"),
        include_historical=bool(payload.get("includeHistorical")),
    )


@app.post("/autogen/run_card")
async def autogen_run_card(req: ContextPack):
    """Run ONE configured canvas card as a single AssistantAgent.

    Not an orchestrator: exactly one participant, no team, no Task Ledger.
    Reuses the same participant construction as the Mag One path.
    """
    try:
        return await run_configured_card(req)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
