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
def thinkgraph_projection(projectId: str, limit: int | None = None):
    """thinkgraph.projection.v1: Python-owned read-only projection of the
    ACTUAL persisted ThinkGraph records for one project — ordinary items and
    their direct relationships only, bounded by limit and recency (real IDs,
    labels, optional model-authored kinds/tags, provenance). The backend
    forwards this response unchanged; no other layer shapes graph data."""
    from app.python_models.thinkgraph_projection import read_projection

    cleaned = str(projectId or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="projectId required")
    try:
        return read_projection(cleaned, limit)
    except Exception as err:  # honest read failure — no fallback projection
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.post("/hermes/review")
def hermes_review(req: dict):
    """Hermes steward: pure CoderReport review (no model call, no DB, no
    persistence). Body: {coderReport, featureId, runId?, projectId?,
    thinkGraphContext?, codeGraphStatus?}. Returns the HermesReview plus a
    ready apply_thinkgraph_patch payload — persistence happens ONLY through
    the card's scoped authority, never here."""
    from app.python_models.hermes.graph_memory import to_thinkgraph_patch
    from app.python_models.hermes.review import review_coder_report

    if not isinstance(req, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")
    try:
        review = review_coder_report(req)
    except Exception as err:  # honest failure — never a fabricated review
        raise HTTPException(status_code=500, detail=str(err)) from err
    return {
        "ok": True,
        "review": review.to_dict(),
        "thinkgraphPatch": to_thinkgraph_patch(review.graphMemoryWritePlan),
    }


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
