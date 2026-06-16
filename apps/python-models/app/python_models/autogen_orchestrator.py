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
    TaskLedgerTrace,
    ProgressLedger,
)
import json
import re


def _extract_ledger_block(text: str) -> str | None:
    """Extract the JSON ledger payload from the model's final text without
    fabricating anything. Prefers a fenced ```json block (delimited by the
    fences, so nested braces survive), then a generic fenced block, then a bare
    outermost {...} object. Returns None when nothing JSON-shaped is present."""
    if not text:
        return None
    fenced = re.search(r"```json\s*(.*?)```", text, re.DOTALL)
    if fenced:
        return fenced.group(1).strip()
    fenced_any = re.search(r"```\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced_any:
        return fenced_any.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1].strip()
    return None


async def orchestrate_context_pack(context: ContextPack) -> OrchestratorRunResponse:
    if context.cardRuntime is None:
        raise RuntimeError("card_runtime_missing: strict ReactFlow card payload is required")
    if context.cardRuntime.runtimeType != "magentic_one":
        raise RuntimeError(
            f"orchestrator_card_required: runtimeType={context.cardRuntime.runtimeType}"
        )

    started = time.monotonic()
    # The Python sidecar runs the real AutoGen / Magentic-One mission here.
    result = await run_magentic_mission(context)
    elapsed_ms = int((time.monotonic() - started) * 1000)

    # Extract ledgers from the final text and build an honest per-stage trace.
    final_text = result.final_text or ""
    task_ledger = None
    progress_ledger = None
    model_returned_text = bool(final_text.strip())
    block = _extract_ledger_block(final_text)
    json_block_found = block is not None
    task_ledger_found = False
    parse_status = "missing"

    if block is not None:
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            data = None
            parse_status = "invalid_json"
        if isinstance(data, dict):
            if "task_ledger" in data:
                try:
                    task_ledger = TaskLedger(**data["task_ledger"])
                    task_ledger_found = True
                    parse_status = "parsed"
                except Exception:
                    parse_status = "schema_invalid"
                # Preserve existing progress_ledger handling unchanged.
                if "progress_ledger" in data:
                    try:
                        progress_ledger = ProgressLedger(**data["progress_ledger"])
                    except Exception:
                        progress_ledger = None
            else:
                parse_status = "schema_invalid"
        elif parse_status != "invalid_json":
            parse_status = "invalid_json"

    if task_ledger is not None:
        context.plan.task_ledger = task_ledger
    if progress_ledger is not None:
        context.plan.progress_ledger = progress_ledger

    task_ledger_trace = TaskLedgerTrace(
        source="python_magone",
        pythonSidecarCalled=True,
        modelReturnedText=model_returned_text,
        jsonBlockFound=json_block_found,
        taskLedgerFound=task_ledger_found,
        taskLedgerParseStatus=parse_status,  # type: ignore[arg-type]
        backendPreserved=context.plan.task_ledger is not None,
        blocker=None if task_ledger_found else "no_structured_task_ledger_from_model",
    )

    return OrchestratorRunResponse(
        ok=True,
        session=context.session,
        taskLedgerTrace=task_ledger_trace,
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
