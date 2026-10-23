"""Internal execution owner for the saved Magnetic Card."""

# Entity: Magnetic TaskGraph
# Relationship: This file submits one approved mission to the saved Mag One Card, observes the same Hermes root, reports progress, and returns its actual terminal synthesis.
#
# Entity: Run Ledger
# Relationship: This file keeps the outer Run bound to the accepted Hermes root and idempotently records progress, failure, timeout, or terminal settlement.
#
# Entity: Data Anchors
# Relationship: This file accepts only deliberately selected graph references and marks them required before passing them into the Magnetic Card invocation.

from __future__ import annotations

from typing import Any

from app.python_models.magnetic_taskgraph_authority import MagneticTaskGraphError


_MAGNETIC_TERMINAL_STATES = frozenset({"completed", "blocked", "failed", "cancelled"})


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


def _failure_fields(result: dict[str, Any], state: str) -> dict[str, str]:
    if state == "completed":
        return {}
    summary = str(result.get("error") or "").strip()
    candidate = summary.split(":", 1)[0]
    code = (
        candidate
        if 3 <= len(candidate) <= 121
        and candidate[0].islower()
        and all(character.islower() or character.isdigit() or character == "_"
                for character in candidate)
        else f"magnetic_taskgraph_{state}"
    )
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


def reconcile_magnetic_taskgraph_run(
    run_id: str,
    hermes_root_id: str,
) -> dict[str, Any]:
    """Request-driven continuation for one already-bound Magnetic root."""

    from app.python_models.magnetic_taskgraph_readback import read_magnetic_taskgraph

    result = read_magnetic_taskgraph({"hermesRootId": hermes_root_id})
    if str(result.get("hermesRootId") or "").strip() != hermes_root_id:
        raise MagneticTaskGraphError("magnetic_taskgraph_root_identity_mismatch")
    metrics = _task_metrics(result)
    state = str(result.get("state") or "").strip()
    if state in _MAGNETIC_TERMINAL_STATES:
        return _settle_terminal_result(run_id, result, metrics)
    _record_progress(run_id, result, metrics)
    return {
        **result,
        "ok": True,
        "runId": run_id,
        "completionPending": True,
        "outerRunSettled": False,
    }


def cancel_magnetic_taskgraph_run(
    run_id: str,
    hermes_root_id: str,
) -> dict[str, Any]:
    from app.python_models.magnetic_taskgraph_authority import call_hermes_taskgraph_adapter

    cancelled = call_hermes_taskgraph_adapter({
        "action": "cancel_root",
        "runId": run_id,
        "rootId": hermes_root_id,
    })
    root = cancelled.get("root")
    if not isinstance(root, dict) or str(root.get("taskId") or "").strip() != hermes_root_id:
        raise MagneticTaskGraphError("magnetic_taskgraph_cancel_readback_invalid")
    result = reconcile_magnetic_taskgraph_run(run_id, hermes_root_id)
    if result.get("state") != "cancelled" or result.get("outerRunSettled") is not True:
        raise MagneticTaskGraphError("magnetic_taskgraph_cancel_settlement_invalid")
    return {
        **result,
        "archivedTaskIds": cancelled.get("archivedTaskIds") or [],
    }


def start_magnetic_taskgraph(
    *, run_id: str, input: str, data_anchors: list[Any], project_id: str,
    deck_id: str, conversation_id: str, caller_card_id: str,
    originating_run_id: str, notification: dict[str, Any],
) -> dict[str, Any]:
    from app.python_models.card_invocation_preparation import (
        resolve_magnetic_taskgraph_card,
    )
    from app.python_models.card_run_preparation import begin_run
    from app.python_models.card_run_settlement import finish_run
    from app.python_models.saved_card_contract import CardDomainError
    from app.python_models.magnetic_taskgraph_submission import submit_magnetic_taskgraph

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
            "originatingRunId": originating_run_id,
            "runId": run_id,
            "correlationId": run_id,
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
        accepted = submit_magnetic_taskgraph({
            **execution,
            "notification": notification,
        })
        hermes_root_id = str(accepted.get("hermesRootId") or "").strip()
        if not hermes_root_id:
            raise MagneticTaskGraphError("magnetic_taskgraph_hermes_root_id_required")
        root_accepted = True
        return {
            **accepted,
            "ok": True,
            "runId": run_id,
            "outerRunSettled": False,
        }
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
