"""Strict graph-runtime boundary for /autogen/orchestrate.

Runs the real AutoGen 0.7.5 Magentic-One mission (see ``magentic_agentchat.py``)
and returns only what AutoGen actually emitted. No fallbacks, no app-authored
ledgers, no fake success.
"""

from app.python_models.magentic_agentchat import run_native_magentic_mission
from app.python_models.orchestration_contracts import ContextPack, OrchestratorRunResponse


async def orchestrate_context_pack(context: ContextPack) -> OrchestratorRunResponse:
    if context.cardRuntime is None:
        raise RuntimeError("card_runtime_missing: strict ReactFlow card payload is required")
    if context.cardRuntime.runtimeType != "magentic_one":
        raise RuntimeError(
            f"orchestrator_card_required: runtimeType={context.cardRuntime.runtimeType}"
        )

    # The Python sidecar runs the real AutoGen Task Ledger startup and returns the
    # real Task Ledger artifact (facts/plan/full text + model-call proof) plus the
    # real captured messages. The Progress Ledger is identify-only. The app never
    # invents Task Ledger fields, steps, or status.
    return await run_native_magentic_mission(context)
