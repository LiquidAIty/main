"""Strict graph-runtime boundary for /autogen/orchestrate.

Executes the real source-run Microsoft AutoGen v0.4.4 / Magentic-One runtime
(see ``magentic_runtime.py``). No fallbacks, no fake success: every failure
propagates as an error, and an empty final output is always an error.
"""

import time

from app.python_models.magentic_runtime import run_magentic_mission
from app.python_models.orchestration_contracts import (
    ContextPack,
    KnowGraphUpdateReport,
    OrchestratorMetrics,
    OrchestratorRunResponse,
)


async def orchestrate_context_pack(context: ContextPack) -> OrchestratorRunResponse:
    if context.cardRuntime is None:
        raise RuntimeError("card_runtime_missing: strict ReactFlow card payload is required")
    if context.cardRuntime.runtimeType != "magentic_one":
        raise RuntimeError(
            f"orchestrator_card_required: runtimeType={context.cardRuntime.runtimeType}"
        )

    started = time.monotonic()
    result = await run_magentic_mission(context)
    elapsed_ms = int((time.monotonic() - started) * 1000)

    return OrchestratorRunResponse(
        ok=True,
        session=context.session,
        stopReason=result.stop_reason,
        finalResponseText=result.final_text,
        plan=context.plan,
        thinkGraph=context.thinkGraph,
        knowGraph=KnowGraphUpdateReport(
            sourceAgent="magentic_one_runtime",
            summary="no_knowgraph_updates_from_runtime",
        ),
        transcript=result.transcript,
        metrics=OrchestratorMetrics(
            elapsedMs=elapsed_ms,
            turnsUsed=result.rounds_used,
            reportBackCount=len(result.graph_dispatches),
        ),
    )
