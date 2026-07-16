from fastapi import FastAPI, HTTPException

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
    thinkLimit: int = 120,
    knowLimit: int = 120,
    codeLimit: int = 90,
    expansionDepth: int = 0,
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
            expansion_depth=expansionDepth,
        ))
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


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
def thinkgraph_persist_graph_view(payload: dict):
    from app.python_models.thinkgraph_engraphis import get_thinkgraph
    try:
        return get_thinkgraph().persist_graph_view(payload.get("view") or {})
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/thinkgraph/graph-views")
def thinkgraph_graph_views(projectId: str, conversationId: str | None = None):
    from app.python_models.thinkgraph_engraphis import get_thinkgraph
    try:
        return get_thinkgraph().graph_views(projectId, conversationId)
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
