"""Application operation for the saved Magnetic Card."""

from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.python_models.operation_definition import OperationDefinition
from app.python_models.magnetic_taskgraph_authority import MagneticTaskGraphError
from app.saved_graph_specialist_operations import grounded_data_anchors_schema
from mcp.types import CallToolResult, TextContent


_MAGNETIC_TERMINAL_STATES = frozenset({"completed", "blocked", "failed", "cancelled"})
_MAGNETIC_COMPLETION_WAIT_SECONDS = 540.0
_MAGNETIC_POLL_SECONDS = 1.0


def _task_metrics(result: dict[str, Any]) -> dict[str, int]:
    root_id = str(result.get("hermesRootId") or "").strip()
    tasks = result.get("hermesTasks")
    if not isinstance(tasks, list):
        tasks = []
    normalized = [task for task in tasks if isinstance(task, dict)]
    return {
        "tasksCompleted": sum(
            str(task.get("status") or "").strip() == "done" for task in normalized
        ),
        "tasksTotal": len(normalized),
        "activeWorkers": sum(
            str(task.get("taskId") or "").strip() != root_id
            and str(task.get("status") or "").strip() == "running"
            for task in normalized
        ),
    }


def _record_progress(run_id: str, result: dict[str, Any], metrics: dict[str, int]) -> None:
    from app.python_models.card_run_execution import update_run_progress

    observed = update_run_progress({
        "runId": run_id,
        "hermesRootId": result.get("hermesRootId"),
        "hermesRunId": result.get("hermesRunId"),
        "hermesStatus": result.get("hermesStatus"),
        **metrics,
    })
    if (
        not isinstance(observed, dict)
        or observed.get("ok") is not True
        or observed.get("runId") != run_id
        or observed.get("hermesRootId") != result.get("hermesRootId")
        or observed.get("updated") is not True
    ):
        raise MagneticTaskGraphError("magnetic_taskgraph_outer_run_progress_invalid")


def _wait_for_completion(
    run_id: str,
    hermes_root_id: str,
    *,
    timeout_seconds: float = _MAGNETIC_COMPLETION_WAIT_SECONDS,
    poll_seconds: float = _MAGNETIC_POLL_SECONDS,
) -> tuple[dict[str, Any], dict[str, int]]:
    """Wait inside the exact Mag One invocation; never create a background supervisor."""

    from app.python_models.magnetic_taskgraph_readback import read_magnetic_taskgraph

    deadline = time.monotonic() + max(0.0, timeout_seconds)
    last_progress: tuple[Any, ...] | None = None
    while True:
        result = read_magnetic_taskgraph({"hermesRootId": hermes_root_id})
        if str(result.get("hermesRootId") or "").strip() != hermes_root_id:
            raise MagneticTaskGraphError("magnetic_taskgraph_root_identity_mismatch")
        metrics = _task_metrics(result)
        state = str(result.get("state") or "").strip()
        if state in _MAGNETIC_TERMINAL_STATES:
            return result, metrics
        progress = (
            result.get("hermesRunId"), result.get("hermesStatus"),
            metrics["tasksCompleted"], metrics["tasksTotal"], metrics["activeWorkers"],
        )
        if progress != last_progress:
            _record_progress(run_id, result, metrics)
            last_progress = progress
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return ({
                **result,
                "ok": False,
                "runId": run_id,
                "completionPending": True,
                "outerRunSettled": False,
                "error": "magnetic_taskgraph_completion_timeout",
            }, metrics)
        time.sleep(min(max(0.01, poll_seconds), remaining))


def _failure_fields(result: dict[str, Any], state: str) -> dict[str, str]:
    if state == "completed":
        return {}
    summary = str(result.get("error") or "").strip()
    match = re.match(r"^([a-z][a-z0-9_]{2,120})(?::|$)", summary)
    code = match.group(1) if match else f"magnetic_taskgraph_{state}"
    return {"errorCode": code, "errorSummary": summary or code}


def _settle_terminal_result(
    run_id: str,
    result: dict[str, Any],
    metrics: dict[str, int],
) -> dict[str, Any]:
    from app.python_models.card_run_settlement import finish_run

    state = str(result.get("state") or "").strip()
    if state not in _MAGNETIC_TERMINAL_STATES:
        raise MagneticTaskGraphError("magnetic_taskgraph_terminal_state_missing")
    settled = finish_run({
        "runId": run_id,
        "state": state,
        "finalResult": result.get("finalResult") if state == "completed" else None,
        **_failure_fields(result, state),
        "effectiveProvider": result.get("configuredProvider"),
        "providerApiMode": result.get("configuredProviderApiMode"),
        "providerThreadRef": result.get("hermesRootId"),
        "providerTurnRef": result.get("hermesRunId"),
        "hermesStatus": result.get("hermesStatus"),
        **metrics,
    })
    if (
        not isinstance(settled, dict)
        or settled.get("ok") is not True
        or settled.get("runId") != run_id
        or settled.get("state") != state
    ):
        raise MagneticTaskGraphError("magnetic_taskgraph_outer_run_settlement_invalid")
    return {
        **result,
        "ok": state == "completed",
        "runId": run_id,
        "outerRunSettled": True,
    }


def _execute_mag_one(
    *, input: str, data_anchors: list[Any], project_id: str,
    deck_id: str, conversation_id: str, caller_card_id: str,
) -> dict[str, Any]:
    from app.python_models.card_invocation_preparation import (
        resolve_magnetic_taskgraph_card,
    )
    from app.python_models.card_run_preparation import begin_run
    from app.python_models.card_run_settlement import finish_run
    from app.python_models.saved_card_contract import CardDomainError
    from app.python_models.magnetic_taskgraph_submission import submit_magnetic_taskgraph

    run_id = f"req_{uuid4().hex[:16]}"
    run_prepared = False
    root_accepted = False
    hermes_root_id = ""
    try:
        target = resolve_magnetic_taskgraph_card(project_id, deck_id)
        prepared = begin_run({
            "projectId": target["projectId"],
            "deckId": target["deckId"],
            "cardId": target["cardId"],
            "senderCardId": caller_card_id,
            "runId": run_id,
            "correlationId": run_id,
            "acceptedAt": datetime.now(timezone.utc).isoformat(),
            "conversationId": conversation_id or "main",
            "assignment": input,
            "dataAnchors": data_anchors,
            "discoveredTools": [],
            "discoveredToolCatalogState": "unavailable",
            "unavailableToolCatalogFamilies": [],
        })
        run_prepared = True
        execution = prepared.get("magneticTaskGraph")
        if not isinstance(execution, dict):
            raise MagneticTaskGraphError("magnetic_taskgraph_contract_missing")
        accepted = submit_magnetic_taskgraph(execution)
        hermes_root_id = str(accepted.get("hermesRootId") or "").strip()
        if not hermes_root_id:
            raise MagneticTaskGraphError("magnetic_taskgraph_hermes_root_id_required")
        root_accepted = True
        result, metrics = _wait_for_completion(run_id, hermes_root_id)
        if result.get("completionPending") is True:
            return result
        return _settle_terminal_result(run_id, result, metrics)
    except (CardDomainError, MagneticTaskGraphError) as error:
        failed_run_settled = False
        if run_prepared and not root_accepted:
            try:
                settled = finish_run({
                    "runId": run_id,
                    "state": "failed",
                    "errorCode": "magnetic_taskgraph_failed",
                    "errorSummary": str(error),
                })
                failed_run_settled = bool(
                    isinstance(settled, dict)
                    and settled.get("ok") is True
                    and settled.get("runId") == run_id
                    and settled.get("state") == "failed"
                )
            except CardDomainError:
                pass
        return {
            "ok": False,
            "runId": run_id,
            **({"hermesRootId": hermes_root_id} if hermes_root_id else {}),
            "outerRunSettled": failed_run_settled,
            "error": str(error),
        }


async def run_mag_one(
    *, input: str, dataAnchors: list[Any] | None = None,
    projectId: str, deckId: str, conversationId: str,
    _callerCardId: str,
) -> CallToolResult:
    anchors = [
        {**anchor, "required": True} if isinstance(anchor, dict) else anchor
        for anchor in (dataAnchors or [])
    ]
    result = await asyncio.to_thread(
        _execute_mag_one,
        input=input,
        data_anchors=anchors,
        project_id=projectId,
        deck_id=deckId,
        conversation_id=conversationId,
        caller_card_id=_callerCardId,
    )
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(result, ensure_ascii=False))],
        structuredContent=result,
        isError=result.get("ok") is False,
    )


def mag_one_operation_definitions(
    external: frozenset[str],
) -> list[OperationDefinition]:
    return [
        OperationDefinition(
            canonical_id="run_mag_one",
            title="Mag One",
            description=(
                "Main only: submit one explicitly approved mission and deliberately selected "
                "graph references to the saved Magnetic Card's existing Hermes Mag One execution. "
                "The authenticated runtime supplies Project, Card, conversation, and Run authority; "
                "the saved blue topology supplies the exact worker ceiling. This starts real work, "
                "waits on that exact Hermes root, and returns its actual terminal result."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "input": {"type": "string", "minLength": 1},
                    "dataAnchors": grounded_data_anchors_schema(),
                },
                "required": ["input"],
                "additionalProperties": False,
            },
            handler=run_mag_one,
            available=True,
            publishers=external,
            access="write",
            namespace="main",
            annotations={
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": False,
            },
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "conversationId", "_callerCardId",
            }),
            required_caller_runtime=("hermes", "main"),
        ),
    ]
