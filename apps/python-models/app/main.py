from fastapi import FastAPI, HTTPException
from typing import Any

from app.python_models.provider_config import ensure_env_loaded

ensure_env_loaded()

from app.python_models.alpaca_market_data import (
    AlpacaInstrumentRef,
    get_historical_bars,
    get_market_snapshot,
    get_paper_account_readiness,
)
from app.python_models.autogen_orchestrator import orchestrate_runtime
from app.python_models.idd import (
    IddValidationError,
    materialize_card_editor,
    materialize_tool_catalog,
)
from app.python_models.magentic_agentchat import run_configured_card
from app.python_models.orchestration_contracts import RuntimeRequest
from app.python_models.tool_registry import tool_manifest
from app.python_models.thinkgraph_live_projection import project_live_thinkgraph

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
    """Expose factual live contracts from the private Python tool registry."""
    return {"tools": tool_manifest()}


@app.post("/idd/card-editor/materialize")
def idd_card_editor_materialize(payload: dict[str, Any]):
    """Materialize current model choices through the one literal IDD."""
    try:
        return materialize_card_editor(payload.get("models"))
    except IddValidationError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.post("/idd/tools/materialize")
def idd_tools_materialize(payload: dict[str, Any]):
    """Ingest live native contracts into the one current IDD vocabulary."""
    try:
        return {"references": materialize_tool_catalog(payload.get("tools"))}
    except IddValidationError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.post("/autogen/orchestrate")
async def autogen_orchestrate(req: RuntimeRequest):
    try:
        return await orchestrate_runtime(req)
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


@app.post("/thinkgraph/live-projection")
def thinkgraph_live_projection(payload: dict[str, Any]):
    """Return transient lexical observations; never read or write Engraphis."""
    try:
        return project_live_thinkgraph(payload)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.post("/idf/documents")
def idf_create(payload: dict[str, Any]):
    """Validate, persist, and return the actual Markdown model input."""
    from app.python_models.idf import InputDataFileError, create_input_data_file

    try:
        return create_input_data_file(
            project_id=str(payload.get("projectId") or ""),
            deck_id=str(payload.get("deckId") or ""),
            conversation_id=str(payload.get("conversationId") or ""),
            run_id=str(payload.get("runId") or ""),
            originating_card_id=str(payload.get("originatingCardId") or ""),
            system_text=payload.get("systemText") if isinstance(payload.get("systemText"), str) else "",
            user_text=payload.get("userText"),
            card_context=payload.get("cardContext"),
            dynamic_context_markdown=(
                payload.get("dynamicContextMarkdown")
                if isinstance(payload.get("dynamicContextMarkdown"), str)
                else ""
            ),
            native_references=payload.get("nativeReferences"),
            purpose=str(payload.get("purpose") or "conversation"),
            approval_status=(
                str(payload.get("approvalStatus"))
                if payload.get("approvalStatus") is not None
                else None
            ),
            version=payload.get("version", 1),
            job_context=payload.get("jobContext"),
            supersedes_idf_id=(
                str(payload.get("supersedesIdfId"))
                if payload.get("supersedesIdfId") is not None
                else None
            ),
        )
    except InputDataFileError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail="idf_persistence_failed") from err


@app.get("/idf/documents/{idf_id:path}")
def idf_read(idf_id: str, projectId: str):
    from app.python_models.idf import InputDataFileError, read_input_data_file

    try:
        return {"ok": True, "idf": read_input_data_file(project_id=projectId, idf_id=idf_id)}
    except InputDataFileError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail="idf_read_failed") from err


@app.post("/idf/documents/{idf_id:path}/revisions")
def idf_revise(idf_id: str, payload: dict[str, Any]):
    from app.python_models.idf import InputDataFileError, revise_input_data_file

    try:
        return revise_input_data_file(
            project_id=str(payload.get("projectId") or ""),
            idf_id=idf_id,
            expected_version=payload.get("expectedVersion"),
            expected_sha256=str(payload.get("expectedSha256") or ""),
            job_context=payload.get("jobContext"),
            card_context=payload.get("cardContext"),
            system_text=payload.get("systemText") if isinstance(payload.get("systemText"), str) else "",
            user_text=payload.get("userText"),
        )
    except InputDataFileError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail="idf_revision_failed") from err


@app.post("/idf/documents/{idf_id:path}/approve")
def idf_approve(idf_id: str, payload: dict[str, Any]):
    from app.python_models.idf import InputDataFileError, approve_input_data_file

    try:
        return approve_input_data_file(
            project_id=str(payload.get("projectId") or ""),
            idf_id=idf_id,
            expected_version=payload.get("expectedVersion"),
            expected_sha256=str(payload.get("expectedSha256") or ""),
        )
    except InputDataFileError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail="idf_approval_failed") from err


@app.post("/autogen/run_card")
async def autogen_run_card(req: RuntimeRequest):
    """Run ONE configured canvas card as a single AssistantAgent.

    Not an orchestrator: exactly one participant, no team, no Task Ledger.
    Reuses the same participant construction as the Mag One path.
    """
    try:
        return await run_configured_card(req)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
