"""Card, IDD, tool, Script, deck, Run, and Magnetic routes."""
from fastapi import APIRouter, HTTPException
from typing import Any
from app.python_models.saved_card_contract import CardDomainError
from app.python_models.saved_cards import load_deck, save_deck
from app.python_models.card_run_execution import start_run, update_run_progress
from app.python_models.card_run_preparation import begin_main_chat_run, begin_run
from app.python_models.card_run_readback import read_run, read_run_history
from app.python_models.card_run_settlement import finish_run
from app.python_models.card_script import CardScriptValidationError, generate_card_script_header, saved_script
from app.python_models.idd import IddValidationError, materialize_card_editor, materialize_runtime_options
from app.python_models.magnetic_taskgraph_authority import MagneticTaskGraphError
from app.python_models.magnetic_taskgraph_readback import read_magnetic_taskgraph
from app.python_models.tool_catalog import ToolCatalogError, materialize_live_tool_catalog

router = APIRouter()

@router.post("/idd/card-editor/materialize")
def idd_card_editor_materialize(payload: dict[str, Any]):
    """Materialize current model choices through the one literal IDD."""
    try:
        return materialize_card_editor(
            payload.get("models"), catalog_options=payload.get("catalogOptions"),
            selected_ids=payload.get("selectedIds"),
        )
    except IddValidationError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/card-editor/options")
def card_editor_options(payload: dict[str, Any]):
    """Project executable field contracts and the current configured model catalog."""
    try:
        return materialize_runtime_options(payload.get("models"))
    except IddValidationError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/tools/catalog/definitions")
def tools_catalog_definitions(payload: dict[str, Any]):
    """Project code-owned definitions plus current live provider contracts."""
    try:
        return {
            "references": materialize_live_tool_catalog(
                payload.get("providerTools")
            )
        }
    except ToolCatalogError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/card-script/validate")
def card_script_validate(payload: dict[str, Any]):
    """Compile one unsaved Card Script draft without executing it."""

    selected_tools = payload.get("selectedTools")
    default_agent_tools = payload.get("defaultAgentTools")
    if (
        not isinstance(selected_tools, list)
        or any(not isinstance(item, str) or not item.strip() for item in selected_tools)
    ):
        raise HTTPException(status_code=400, detail="card_script_selected_tools_invalid")
    if (
        not isinstance(default_agent_tools, list)
        or any(not isinstance(item, str) or not item.strip() for item in default_agent_tools)
    ):
        raise HTTPException(status_code=400, detail="card_script_default_agent_tools_invalid")
    try:
        return saved_script(
            payload.get("script") or {},
            selected_tools=list(dict.fromkeys(item.strip() for item in selected_tools)),
            default_agent_tools=list(dict.fromkeys(item.strip() for item in default_agent_tools)),
            palette_fingerprint=str(payload.get("paletteFingerprint") or ""),
        )
    except CardScriptValidationError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/card-script/header")
def card_script_header(payload: dict[str, Any]):
    """Generate the non-authoritative read-only Python IDE header."""

    catalog_tools = payload.get("catalogTools")
    selected_tools = payload.get("selectedTools")
    default_agent_tools = payload.get("defaultAgentTools")
    if (
        not isinstance(catalog_tools, list)
        or not isinstance(selected_tools, list)
        or not isinstance(default_agent_tools, list)
    ):
        raise HTTPException(status_code=400, detail="card_script_header_input_invalid")
    try:
        return generate_card_script_header(
            catalog_tools=catalog_tools,
            selected_tools=[str(item) for item in selected_tools],
            default_agent_tools=[str(item) for item in default_agent_tools],
            card_id=str(payload.get("cardId") or ""),
        )
    except (IddValidationError, ValueError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


# ---------------------------------------------------------------------------
# Stable Card/deck authority and transient communication preparation.
# These internal rails endpoints never persist prompts, provider bodies,
# selected context, or ordinary model output.
# ---------------------------------------------------------------------------


@router.get("/domain/decks/{project_id}/{deck_id}")
def domain_deck_read(project_id: str, deck_id: str):
    try:
        return {"ok": True, **load_deck(project_id, deck_id)}
    except CardDomainError as err:
        status = 404 if str(err) in {"project_not_found", "deck_not_found"} else 409
        raise HTTPException(status_code=status, detail=str(err)) from err


@router.put("/domain/decks/{project_id}/{deck_id}")
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


@router.post("/domain/runs/begin")
def domain_run_begin(payload: dict[str, Any]):
    try:
        return begin_run(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.post("/domain/main/runs/begin")
def domain_main_run_begin(payload: dict[str, Any]):
    try:
        return begin_main_chat_run(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.post("/domain/runs/finish")
def domain_run_finish(payload: dict[str, Any]):
    try:
        return finish_run(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.post("/domain/runs/start")
def domain_run_start(payload: dict[str, Any]):
    try:
        return start_run(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.post("/domain/runs/progress")
def domain_run_progress(payload: dict[str, Any]):
    try:
        return update_run_progress(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.post("/domain/runs/read")
def domain_run_read(payload: dict[str, Any]):
    try:
        return read_run(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.post("/domain/runs/history")
def domain_run_history(payload: dict[str, Any]):
    try:
        return read_run_history(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.post("/magnetic/taskgraph/status")
def magnetic_taskgraph_status(payload: dict[str, Any]):
    try:
        return read_magnetic_taskgraph(payload)
    except MagneticTaskGraphError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
