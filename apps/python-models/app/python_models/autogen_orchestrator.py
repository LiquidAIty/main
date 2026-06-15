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
    TaskLedger,
    ProgressLedger,
)
import json
import re


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

    # Extract ledgers from the final text
    final_text = result.final_text
    task_ledger = None
    progress_ledger = None
    
    match = re.search(r'```json\s*(\{.*?\})\s*```', final_text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(1))
            if "task_ledger" in data:
                task_ledger = TaskLedger(**data["task_ledger"])
            if "progress_ledger" in data:
                progress_ledger = ProgressLedger(**data["progress_ledger"])
        except Exception:
            pass

    if task_ledger is not None:
        context.plan.task_ledger = task_ledger
    if progress_ledger is not None:
        context.plan.progress_ledger = progress_ledger

    return OrchestratorRunResponse(
        ok=True,
        session=context.session,
        stopReason=result.stop_reason,
        finalResponseText=final_text,
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
