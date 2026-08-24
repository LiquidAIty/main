"""Strict Python-owned configured AutoGen runtime boundary.

Python selects the native single-AssistantAgent or AutoGen 0.7.5 Magentic-One
runtime from the already validated Card runtime. TypeScript forwards one exact
request and never makes this choice. No fallbacks, app-authored ledgers, or fake
success.
"""

from app.python_models.magentic_agentchat import (
    run_configured_card,
    run_native_magentic_mission,
)
from app.python_models.orchestration_contracts import (
    RuntimeRequest,
    OrchestratorRunResponse,
    StoredRuntimeRequest,
)
from app.python_models.idf import load_idf


def load_stored_runtime_request(context: StoredRuntimeRequest) -> RuntimeRequest:
    """Load AutoGen input only from the exact retained IDF bytes."""

    materialized = load_idf(
        context.inputFile.model_dump(),
        project_id=context.session.projectId,
        deck_id=context.session.deckId,
        run_id=context.session.runId,
        card_id=context.session.cardId,
    )
    return RuntimeRequest(
        session=context.session,
        idf=materialized.idf,
        inputFile=context.inputFile,
        participants=context.participants,
    )


async def orchestrate_runtime(context: RuntimeRequest) -> OrchestratorRunResponse:
    runtime = context.idf.execution.runtime
    if runtime.get("kind") != "autogen" or runtime.get("mode") != "magentic_one":
        raise RuntimeError(
            "orchestrator_card_required: runtime="
            f"{runtime.get('kind')}/{runtime.get('mode')}"
        )

    # Native Magentic-One owns its private Task and Progress Ledgers. Python rails
    # returns only the messages and result the native runtime actually emitted.
    return await run_native_magentic_mission(context)


def _configured_runtime_handler(runtime: dict[str, object]):
    if runtime.get("kind") == "autogen" and runtime.get("mode") == "assistant":
        return run_configured_card
    if runtime.get("kind") == "autogen" and runtime.get("mode") == "magentic_one":
        return orchestrate_runtime
    raise RuntimeError(
        "configured_card_runtime_unsupported: runtime="
        f"{runtime.get('kind')}/{runtime.get('mode')}"
    )


async def dispatch_configured_runtime(context: RuntimeRequest) -> OrchestratorRunResponse:
    """Dispatch one transient model input through its saved Card runtime."""
    return await _configured_runtime_handler(context.idf.execution.runtime)(context)


async def dispatch_stored_runtime(
    context: StoredRuntimeRequest,
) -> OrchestratorRunResponse:
    return await dispatch_configured_runtime(load_stored_runtime_request(context))
