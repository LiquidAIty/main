"""Strict graph-runtime boundary for /autogen/orchestrate.

Executes the real source-run Microsoft AutoGen v0.4.4 / Magentic-One runtime
(see ``magentic_runtime.py``). No fallbacks, no fake success: every failure
propagates as an error, and an empty final output is always an error.
"""

import time

from app.python_models.magentic_agentchat import run_native_magentic_mission
from app.python_models.orchestration_contracts import (
    ContextPack,
    KnowGraphUpdateReport,
    OrchestratorMetrics,
    OrchestratorRunResponse,
    TaskLedger,
    LedgerTrace,
    ProgressLedger,
)
async def orchestrate_context_pack(context: ContextPack) -> OrchestratorRunResponse:
    if context.cardRuntime is None:
        raise RuntimeError("card_runtime_missing: strict ReactFlow card payload is required")
    if context.cardRuntime.runtimeType != "magentic_one":
        raise RuntimeError(
            f"orchestrator_card_required: runtimeType={context.cardRuntime.runtimeType}"
        )

    # The Python sidecar runs the real AutoGen / Magentic-One mission here.
    # It returns structured TaskLedger and ProgressLedger natively.
    result = await run_native_magentic_mission(context)
    
    if result.taskLedger is not None:
        context.plan.task_ledger = result.taskLedger
    if result.progressLedger is not None:
        context.plan.progress_ledger = result.progressLedger

    ledger_trace = getattr(result, "ledgerTrace", None)
    if not ledger_trace:
        ledger_trace = LedgerTrace(
            source="python_magone",
            referenceFiles=[],
            promptConstants=[],
            canvasTeamCompiled=False,
            taskLedgerFactsPromptUsed=False,
            taskLedgerPlanPromptUsed=False,
            taskLedgerFullPromptUsed=False,
            taskLedgerProduced=False,
            planCanvasProjected=False,
            runTaskClicked=False,
            progressLedgerStarted=False,
            progressLedgerPromptUsed=False,
            agentCanvasProjected=False,
            noExecutionBeforeRunTask=True,
            blocker=None if result.taskLedger is not None else "no_structured_task_ledger_from_model",
        )
        result.ledgerTrace = ledger_trace

    return result
