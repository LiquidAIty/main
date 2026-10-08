from fastapi import FastAPI, HTTPException
from contextlib import asynccontextmanager
from typing import Any

from app.python_models.provider_config import ensure_env_loaded

ensure_env_loaded()

from app.python_models.card_domain import (
    CardDomainError,
    begin_main_chat_run,
    begin_run,
    delete_card,
    finish_run,
    load_deck,
    read_run,
    read_run_history,
    read_run_input_files,
    record_explicit_artifact,
    save_deck,
)
from app.python_models.card_script import (
    CardScriptValidationError,
    generate_card_script_header,
    saved_script,
)
from app.python_models.idd import (
    IddValidationError,
    materialize_card_editor,
    materialize_runtime_options,
)
from app.python_models.magentic_execution import (
    MagenticExecutionError,
    authenticate_magentic_worker_tool_request,
    read_magentic_execution,
    stop_magentic_execution,
)
from app.python_models.tool_registry import (
    ToolCatalogError,
    materialize_live_tool_catalog,
)
from app.python_models.trading_runtime import (
    TradingRuntimeError,
    intervene_trade_job,
    lumibot_readiness,
    read_trading_state,
    run_trading_lifecycle_proof,
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    import logging
    from app.python_models.engraphis import get_service

    async def warm():
        try:
            await asyncio.to_thread(get_service)
        except Exception:
            logging.getLogger(__name__).exception("ThinkGraph initialization failed")

    warmup = asyncio.create_task(warm())
    app.state.thinkgraph_warmup = warmup
    try:
        yield
    finally:
        if not warmup.done():
            warmup.cancel()
            try:
                await warmup
            except asyncio.CancelledError:
                pass


app = FastAPI(lifespan=lifespan)

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/knowgraph/jev/classify")
async def knowgraph_jev_classify(payload: dict[str, Any]):
    """Derive Jev Choice metadata for selected Graphiti facts."""
    from app.python_models.knowgraph_jev import (
        KnowGraphJevError,
        classify_knowgraph_facts,
    )
    from app.python_models.engraphis import (
        ThinkGraphIntakeError,
        promote_project_relationship_label,
        read_project_relationship_vocabulary,
    )
    import asyncio

    project = str(payload.get("projectId") or "")
    facts = payload.get("facts")
    if (
        not project
        or not isinstance(facts, list)
        or any(not isinstance(item, dict) for item in facts)
    ):
        raise HTTPException(status_code=400, detail="knowgraph_jev_facts_invalid")
    try:
        before = await asyncio.to_thread(
            read_project_relationship_vocabulary,
            project,
        )
        vocabulary = tuple(str(value) for value in before["labels"])
        results = await asyncio.to_thread(
            lambda: classify_knowgraph_facts(
                facts,
                relationship_vocabulary=vocabulary,
            )
        )
        for result in results:
            if result.get("status") != "success":
                continue
            winner = str(result.get("winner") or "")
            candidate = str(result.get("novel_relationship_candidate") or "")
            if not candidate or winner != candidate:
                result["vocabulary_promotion"] = "not_promoted"
                continue
            try:
                promoted = await asyncio.to_thread(
                    promote_project_relationship_label,
                    project,
                    winner,
                )
            except ThinkGraphIntakeError as error:
                result.update({
                    "status": "error",
                    "failure_reason": str(error),
                    "vocabulary_promotion": "failed",
                })
                continue
            result.update({
                "vocabulary_promotion": (
                    "promoted" if promoted["promoted"]
                    else "reused_concurrent"
                ),
                "vocabulary_after_hash": promoted["hash"],
                "vocabulary_after_count": promoted["count"],
            })
        after = await asyncio.to_thread(
            read_project_relationship_vocabulary,
            project,
        )
        for result in results:
            if result.get("status") == "success":
                result["vocabulary_after_hash"] = after["hash"]
                result["vocabulary_after_count"] = after["count"]
        unfinished_fact_uuids = [
            str(result.get("graphitiFactUuid") or "")
            for result in results
            if result.get("status") == "unfinished"
        ]
        return {
            "results": results,
            "attemptedFactUuids": [
                str(result.get("graphitiFactUuid") or "")
                for result in results
                if result.get("status") != "unfinished"
            ],
            "unfinishedFactUuids": unfinished_fact_uuids,
            "relationshipVocabulary": {
                "before": before,
                "after": after,
                "added": [
                    label for label in after["labels"]
                    if label not in before["labels"]
                ],
            },
        }
    except KnowGraphJevError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except (ThinkGraphIntakeError, RuntimeError, ValueError) as err:
        raise HTTPException(status_code=502, detail=str(err)) from err


@app.post("/graph/relationship-vocabulary/read")
async def graph_relationship_vocabulary_read(payload: dict[str, Any]):
    """Return one project's vocabulary for existing graph-writer prompts."""
    from app.python_models.engraphis import (
        ThinkGraphIntakeError,
        read_project_relationship_vocabulary,
    )
    import asyncio

    project = str(payload.get("projectId") or "")
    if not project:
        raise HTTPException(
            status_code=400,
            detail="project_relationship_vocabulary_project_invalid",
        )
    try:
        return await asyncio.to_thread(
            read_project_relationship_vocabulary,
            project,
        )
    except (ThinkGraphIntakeError, RuntimeError, ValueError) as err:
        raise HTTPException(status_code=502, detail=str(err)) from err


@app.post("/graph/jev-focus")
async def graph_jev_focus(payload: dict[str, Any]):
    """Rerank one bounded client-supplied provider-entity neighborhood."""
    from app.python_models.engraphis import JevGraphError, decide_graph_focus
    import asyncio

    source_revision = (
        payload.get("sourceRevision")
        if isinstance(payload, dict) and isinstance(payload.get("sourceRevision"), str)
        else ""
    )
    try:
        return await asyncio.to_thread(decide_graph_focus, payload)
    except JevGraphError as err:
        return {
            "schemaVersion": "jev-focus.v1",
            "sourceRevision": source_revision,
            "status": err.status,
            "decisionId": None,
            "errorCode": err.error_code,
            "distribution": {},
            "candidates": [],
        }


@app.post("/thinkgraph/operation")
async def thinkgraph_operation(payload: dict[str, Any]):
    from app.python_models.engraphis import invoke_tool, private_operation
    import asyncio
    try:
        project = str(payload.get("projectId") or "")
        operation = str(payload.get("operation") or "")
        arguments = payload.get("arguments") or {}
        if operation.startswith("engraphis_"):
            return await invoke_tool(project, operation, arguments)
        return await asyncio.to_thread(private_operation, project, operation, arguments)
    except (RuntimeError, ValueError, KeyError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/thinkgraph/completed-pair/prepare")
async def thinkgraph_completed_pair_prepare(payload: dict[str, Any]):
    """Prepare one completed Main pair for its saved ThinkGraph Card pass."""
    from app.python_models.engraphis import (
        ThinkGraphIntakeError,
        prepare_completed_pair,
    )
    import asyncio
    try:
        return await asyncio.to_thread(prepare_completed_pair, payload)
    except (ValueError, KeyError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except (ThinkGraphIntakeError, RuntimeError) as err:
        raise HTTPException(status_code=502, detail=str(err)) from err


@app.post("/thinkgraph/completed-pair/settle")
async def thinkgraph_completed_pair_settle(payload: dict[str, Any]):
    """Persist the saved Card's structured facts through Engraphis."""
    from app.python_models.engraphis import (
        ThinkGraphIntakeError,
        settle_completed_pair,
    )
    import asyncio
    try:
        return await asyncio.to_thread(settle_completed_pair, payload)
    except (ValueError, KeyError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except (ThinkGraphIntakeError, RuntimeError) as err:
        raise HTTPException(status_code=502, detail=str(err)) from err


# ---------------------------------------------------------------------------
# Read-only Alpaca paper market data (no orders, no balances, no mutation).
# The frontend /tradingui surface consumes these via the vite /market proxy.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Durable paper Trade Jobs. These routes expose observation and explicit user
# intervention only; no route can submit or authorize an order.
# ---------------------------------------------------------------------------


@app.get("/trading/readiness")
def trading_readiness():
    return lumibot_readiness()


@app.get("/trading/state")
def trading_state(
    projectId: str,
    deckId: str,
    cardId: str,
    timeframe: str = "5Min",
    selectedJobId: str | None = None,
):
    try:
        return read_trading_state(
            project_id=str(projectId or "").strip(),
            deck_id=str(deckId or "").strip(),
            card_id=str(cardId or "").strip(),
            timeframe=str(timeframe or "").strip(),
            selected_job_id=str(selectedJobId or "").strip() or None,
        )
    except TradingRuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/trading/intervene")
def trading_intervene(payload: dict[str, Any]):
    try:
        return intervene_trade_job(
            project_id=str(payload.get("projectId") or "").strip(),
            deck_id=str(payload.get("deckId") or "").strip(),
            card_id=str(payload.get("cardId") or "").strip(),
            job_id=str(payload.get("jobId") or "").strip(),
            action=str(payload.get("action") or "").strip(),
            reason=str(payload.get("reason") or "").strip(),
            actor=str(payload.get("actor") or "").strip(),
        )
    except TradingRuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/trading/lifecycle/backtest")
def trading_lifecycle_backtest(payload: dict[str, Any]):
    """Run one bounded local LumiBot lifecycle; no live broker is selectable."""
    try:
        return run_trading_lifecycle_proof(
            project_id=str(payload.get("projectId") or "").strip(),
            deck_id=str(payload.get("deckId") or "").strip(),
            card_id=str(payload.get("cardId") or "").strip(),
            idempotency_key=str(payload.get("idempotencyKey") or "").strip(),
            actor=str(payload.get("actor") or "").strip(),
        )
    except TradingRuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/idd/card-editor/materialize")
def idd_card_editor_materialize(payload: dict[str, Any]):
    """Materialize current model choices through the one literal IDD."""
    try:
        return materialize_card_editor(
            payload.get("models"), catalog_options=payload.get("catalogOptions"),
            selected_ids=payload.get("selectedIds"),
        )
    except IddValidationError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.post("/card-editor/options")
def card_editor_options(payload: dict[str, Any]):
    """Project executable field contracts and the current configured model catalog."""
    try:
        return materialize_runtime_options(payload.get("models"))
    except IddValidationError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.post("/tools/catalog/definitions")
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


@app.post("/card-script/validate")
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
            # Activation stays disabled until its approved Hermes
            # Script executor is connected.
            hermes_available=False,
        )
    except CardScriptValidationError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.post("/card-script/header")
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


@app.get("/domain/decks/{project_id}/{deck_id}")
def domain_deck_read(project_id: str, deck_id: str):
    try:
        return {"ok": True, **load_deck(project_id, deck_id)}
    except CardDomainError as err:
        status = 404 if str(err) in {"project_not_found", "deck_not_found"} else 409
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


@app.post("/domain/runs/begin")
def domain_run_begin(payload: dict[str, Any]):
    try:
        return begin_run(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/main/runs/begin")
def domain_main_run_begin(payload: dict[str, Any]):
    try:
        return begin_main_chat_run(payload)
    except CardDomainError as err:
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


@app.post("/domain/runs/history")
def domain_run_history(payload: dict[str, Any]):
    try:
        return read_run_history(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/runs/input-files")
def domain_run_input_files(payload: dict[str, Any]):
    try:
        return read_run_input_files(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/magentic/execution/status")
def magentic_execution_status(payload: dict[str, Any]):
    try:
        return read_magentic_execution(payload)
    except MagenticExecutionError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/magentic/execution/worker-tool-auth")
def magentic_execution_worker_tool_auth(payload: dict[str, Any]):
    try:
        return authenticate_magentic_worker_tool_request(payload)
    except MagenticExecutionError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/magentic/execution/stop")
def magentic_execution_stop(payload: dict[str, Any]):
    try:
        return stop_magentic_execution(payload)
    except MagenticExecutionError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.post("/domain/artifacts")
def domain_artifact_record(payload: dict[str, Any]):
    try:
        return record_explicit_artifact(payload)
    except CardDomainError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@app.get("/thinkgraph/projection")
def thinkgraph_projection(
    projectId: str,
):
    """Read the Engraphis projection for the selected project."""
    from app.python_models.engraphis import projection

    project_id = str(projectId or "").strip()
    if not project_id:
        raise HTTPException(status_code=400, detail="projectId required")
    try:
        # The route keeps its stable transport contract. Engraphis owns the
        # bounded live topology; historical/type filtering is not fabricated.
        return projection(project_id)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/thinkgraph/neighborhood")
def thinkgraph_neighborhood(projectId: str, canonicalId: str):
    """Read one exact Engraphis memory and its Engraphis neighborhood."""
    from app.python_models.engraphis import projection

    project_id = str(projectId or "").strip()
    canonical_id = str(canonicalId or "").strip()
    if not project_id or not canonical_id:
        raise HTTPException(status_code=400, detail="projectId and canonicalId required")
    try:
        return projection(project_id, canonical_id)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
