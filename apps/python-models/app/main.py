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
    """Read the native Engraphis projection for the selected project."""
    from app.python_models.thinkgraph_engraphis import get_thinkgraph

    project_id = str(projectId or "").strip()
    if not project_id:
        raise HTTPException(status_code=400, detail="projectId required")
    try:
        return get_thinkgraph().projection(
            project_id,
            limit=limit or 500,
            include_historical=includeHistorical,
            memory_type=memoryType,
        )
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


@app.get("/agentgraph/cards/{receiver_card_id:path}/context")
def agentgraph_read_card_context(
    receiver_card_id: str,
    projectId: str,
    deckId: str,
    conversationId: str,
    assignmentId: str | None = None,
):
    """Read a card's exact returned assignment or its active/latest assignment."""
    from app.python_models import agentgraph

    try:
        assignment = (
            agentgraph.read_assignment(
                project_id=projectId,
                assignment_id=assignmentId,
                receiving_card_id=receiver_card_id,
            )
            if assignmentId
            else agentgraph.read_latest_card_assignment(
                project_id=projectId,
                deck_id=deckId,
                conversation_id=conversationId,
                receiving_card_id=receiver_card_id,
            )
        )
        return {"ok": True, "assignment": assignment}
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
