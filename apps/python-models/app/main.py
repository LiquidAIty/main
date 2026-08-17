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
from app.python_models.card_domain import (
    CardDomainError,
    begin_prompt_free_run,
    describe_magentic_agents,
    finish_prompt_free_run,
    list_decks,
    list_saved_idfs,
    load_deck,
    load_saved_idf_revision,
    materialize_main_invocation,
    materialize_invocation,
    record_explicit_artifact,
    save_deck,
    save_idf_revision,
    validate_exact_invocation,
)
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


# ---------------------------------------------------------------------------
# Stable Card/deck authority and transient communication preparation.
# These internal rails endpoints never persist prompts, IDFs, provider bodies,
# selected context, or ordinary model output.
# ---------------------------------------------------------------------------


@app.get("/domain/decks/{project_id}/{deck_id}")
def domain_deck_read(project_id: str, deck_id: str):
    try:
        return {"ok": True, **load_deck(project_id, deck_id)}
    except CardDomainError as err:
        status = 404 if str(err) in {"project_not_found", "deck_not_found"} else 409
        raise HTTPException(status_code=status, detail=str(err)) from err


@app.get("/domain/decks/{project_id}")
def domain_deck_list(project_id: str):
    try:
        return {"ok": True, **list_decks(project_id)}
    except CardDomainError as err:
        status = 404 if str(err) == "project_not_found" else 409
        raise HTTPException(status_code=status, detail=str(err)) from err


@app.put("/domain/decks/{project_id}/{deck_id}")
def domain_deck_write(project_id: str, deck_id: str, payload: dict[str, Any]):
    try:
        document = payload.get("document")
        if not isinstance(document, dict):
            raise CardDomainError("deck_document_invalid")
        return {"ok": True, **save_deck(
            project_id,
            deck_id,
            document,
            str(payload.get("expectedRevision") or "").strip() or None,
        )}
    except CardDomainError as err:
        status = 409 if str(err) == "deck_conflict" else 400
        raise HTTPException(status_code=status, detail=str(err)) from err


@app.post("/domain/cards/preview")
def domain_card_preview(payload: dict[str, Any]):
    try:
        return materialize_invocation(payload)
    except (CardDomainError, IddValidationError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.post("/domain/main/preview")
def domain_main_preview(payload: dict[str, Any]):
    try:
        return materialize_main_invocation(payload)
    except (CardDomainError, IddValidationError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.get("/domain/mag-one/{project_id}/{deck_id}/agents")
def domain_mag_one_agents(project_id: str, deck_id: str):
    try:
        return {"ok": True, **describe_magentic_agents(project_id, deck_id)}
    except (CardDomainError, IddValidationError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/cards/validate-dispatch")
def domain_card_validate_dispatch(payload: dict[str, Any]):
    try:
        return validate_exact_invocation(payload)
    except (CardDomainError, IddValidationError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.get("/domain/idfs/{project_id}/{deck_id}")
def domain_saved_idf_list(project_id: str, deck_id: str, cardId: str | None = None):
    try:
        return list_saved_idfs(project_id, deck_id, cardId)
    except CardDomainError as err:
        status = 404 if str(err) == "project_not_found" else 409
        raise HTTPException(status_code=status, detail=str(err)) from err


@app.get("/domain/idfs/{project_id}/revision/{idf_id}")
def domain_saved_idf_read(project_id: str, idf_id: str, revision: int | None = None):
    try:
        return load_saved_idf_revision(project_id, idf_id, revision)
    except CardDomainError as err:
        status = 404 if str(err) in {"project_not_found", "saved_idf_not_found"} else 409
        raise HTTPException(status_code=status, detail=str(err)) from err


@app.post("/domain/idfs/save")
def domain_saved_idf_save(payload: dict[str, Any]):
    try:
        return save_idf_revision(payload)
    except (CardDomainError, IddValidationError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/runs/begin")
def domain_run_begin(payload: dict[str, Any]):
    try:
        return begin_prompt_free_run(payload)
    except (CardDomainError, IddValidationError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/runs/finish")
def domain_run_finish(payload: dict[str, Any]):
    try:
        return finish_prompt_free_run(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/artifacts")
def domain_artifact_record(payload: dict[str, Any]):
    try:
        return record_explicit_artifact(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


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


@app.get("/idf/documents/{idf_id:path}")
def idf_read(idf_id: str, projectId: str):
    """Legacy read-only access. No current invocation path writes this store."""
    from app.python_models.idf import InputDataFileError, read_input_data_file

    try:
        return {"ok": True, "idf": read_input_data_file(project_id=projectId, idf_id=idf_id)}
    except InputDataFileError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail="idf_read_failed") from err

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
