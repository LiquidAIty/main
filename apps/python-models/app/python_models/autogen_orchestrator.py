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
    CardRuntimeConfig,
    require_idf_card_runtime,
)


async def orchestrate_runtime(context: RuntimeRequest) -> OrchestratorRunResponse:
    card_runtime = require_idf_card_runtime(context)
    if card_runtime.runtimeType != "magentic_one":
        raise RuntimeError(
            f"orchestrator_card_required: runtimeType={card_runtime.runtimeType}"
        )

    # Native Magentic-One owns its private Task and Progress Ledgers. Python rails
    # returns only the messages and result the native runtime actually emitted.
    return await run_native_magentic_mission(context)


def _configured_runtime_handler(card_runtime: CardRuntimeConfig):
    if card_runtime.runtimeType == "assistant_agent":
        return run_configured_card
    if card_runtime.runtimeType == "magentic_one":
        return orchestrate_runtime
    raise RuntimeError(
        f"configured_card_runtime_unsupported: runtimeType={card_runtime.runtimeType}"
    )


async def dispatch_configured_runtime(context: RuntimeRequest) -> OrchestratorRunResponse:
    """Dispatch an exact IDF using only its Python-validated Card runtime."""
    card_runtime = require_idf_card_runtime(context)
    return await _configured_runtime_handler(card_runtime)(context)
