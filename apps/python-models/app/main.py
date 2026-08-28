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
from app.python_models.autogen_orchestrator import dispatch_stored_runtime
from app.python_models.card_domain import (
    CardDomainError,
    begin_main_chat_run,
    begin_run,
    begin_native_hermes_child_run,
    describe_magentic_agents,
    delete_card,
    finish_run,
    inspect_agentgraph,
    list_active_kanban_runs,
    list_decks,
    load_deck,
    prepare_main_chat,
    read_run,
    read_run_input_files,
    record_explicit_artifact,
    resolve_native_hermes_task_context,
    save_deck,
    update_run_progress,
)
from app.python_models.idd import (
    IddValidationError,
    materialize_card_editor,
)
from app.python_models.orchestration_contracts import StoredRuntimeRequest
from app.python_models.tool_registry import tool_manifest, materialize_tool_catalog

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
        return materialize_card_editor(
            payload.get("models"), native_options=payload.get("nativeOptions"),
            selected_ids=payload.get("selectedIds"),
        )
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
# These internal rails endpoints never persist prompts, provider bodies,
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


@app.delete("/domain/decks/{project_id}/{deck_id}/cards/{card_id}")
def domain_card_delete(
    project_id: str,
    deck_id: str,
    card_id: str,
    payload: dict[str, Any],
):
    try:
        return {"ok": True, **delete_card(
            project_id,
            deck_id,
            card_id,
            expected_deck_revision=str(payload.get("expectedDeckRevision") or "").strip(),
            expected_card_revision_id=str(payload.get("expectedCardRevisionId") or "").strip(),
            deletion_intent=str(payload.get("deletionIntent") or ""),
        )}
    except CardDomainError as err:
        message = str(err)
        status = (
            404 if message in {"project_not_found", "deck_not_found", "card_not_found"}
            else 403 if message.startswith("card_deletion_protected:")
            else 409 if message in {"deck_conflict", "card_revision_conflict"}
                or message.startswith("card_deletion_references_present:")
            else 400
        )
        raise HTTPException(status_code=status, detail=message) from err


@app.post("/domain/main/prepare")
def domain_main_prepare(payload: dict[str, Any]):
    try:
        return prepare_main_chat(payload)
    except (CardDomainError, IddValidationError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.get("/domain/mag-one/{project_id}/{deck_id}/agents")
def domain_mag_one_agents(project_id: str, deck_id: str):
    try:
        return {"ok": True, **describe_magentic_agents(project_id, deck_id)}
    except (CardDomainError, IddValidationError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/runs/begin")
def domain_run_begin(payload: dict[str, Any]):
    try:
        return begin_run(payload)
    except (CardDomainError, IddValidationError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/main/runs/begin")
def domain_main_run_begin(payload: dict[str, Any]):
    try:
        return begin_main_chat_run(payload)
    except (CardDomainError, IddValidationError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/runs/finish")
def domain_run_finish(payload: dict[str, Any]):
    try:
        return finish_run(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/runs/read")
def domain_run_read(payload: dict[str, Any]):
    try:
        return read_run(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/runs/input-files")
def domain_run_input_files(payload: dict[str, Any]):
    try:
        return read_run_input_files(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/runs/resolve-native-hermes-task-context")
def domain_native_hermes_task_context(payload: dict[str, Any]):
    try:
        return resolve_native_hermes_task_context(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=403, detail=str(err)) from err


@app.get("/domain/runs/active-kanban")
def domain_active_kanban_runs():
    try:
        return list_active_kanban_runs()
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/runs/progress")
def domain_run_progress(payload: dict[str, Any]):
    try:
        return update_run_progress(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/runs/begin-native-hermes-child")
def domain_native_hermes_child_run_begin(payload: dict[str, Any]):
    try:
        return begin_native_hermes_child_run(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/agentgraph/inspect")
def domain_agentgraph_inspect(payload: dict[str, Any]):
    """Private rails readback for existing AGE attention/run telemetry."""
    try:
        return inspect_agentgraph(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/artifacts")
def domain_artifact_record(payload: dict[str, Any]):
    try:
        return record_explicit_artifact(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/autogen/dispatch")
async def autogen_dispatch(req: StoredRuntimeRequest):
    try:
        return await dispatch_stored_runtime(req)
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


@app.get("/thinkgraph/neighborhood")
def thinkgraph_neighborhood(projectId: str, canonicalId: str):
    """Read the exact Engraphis neighborhood of one native memory."""
    from app.python_models.thinkgraph_engraphis import get_thinkgraph

    project_id = str(projectId or "").strip()
    canonical_id = str(canonicalId or "").strip()
    if not project_id or not canonical_id:
        raise HTTPException(status_code=400, detail="projectId and canonicalId required")
    try:
        return get_thinkgraph().neighborhood(project_id, canonical_id)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
