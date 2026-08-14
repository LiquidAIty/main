"""Strict graph-runtime boundary for /autogen/orchestrate.

Runs the real AutoGen 0.7.5 Magentic-One mission (see ``magentic_agentchat.py``)
and returns only what AutoGen actually emitted. No fallbacks, no app-authored
ledgers, no fake success.
"""

from app.python_models.magentic_agentchat import run_native_magentic_mission
from app.python_models.orchestration_contracts import (
    RuntimeRequest,
    OrchestratorRunResponse,
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
