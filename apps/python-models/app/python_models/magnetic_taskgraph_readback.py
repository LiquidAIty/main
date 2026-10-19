"""Magnetic projection from Hermes's package-safe taskgraph adapter."""

# Entity: Magnetic TaskGraph
# Relationship: This file projects exact Hermes root, descendant, attempt, dependency, handoff, and terminal-result state without copying the Hermes task ledger.
# Entity: Run Ledger
# Relationship: This file returns the outer Run's exact Hermes root, attempt, status, failure, cancellation, and final-result evidence for settlement and inspection.

from __future__ import annotations

from typing import Any

from app.python_models.magnetic_taskgraph_authority import (
    MagneticTaskGraphError,
    _required_text,
    call_hermes_taskgraph_adapter,
)


def read_magnetic_taskgraph(payload: dict[str, Any]) -> dict[str, Any]:
    root_id = _required_text(payload.get("hermesRootId"), "hermes_root_id")
    readback = call_hermes_taskgraph_adapter({
        "action": "read_root",
        "rootId": root_id,
    })
    root = readback.get("root")
    tasks = readback.get("tasks")
    if not isinstance(root, dict) or not isinstance(tasks, list):
        raise MagneticTaskGraphError("magnetic_taskgraph_hermes_readback_invalid")
    if _required_text(root.get("taskId"), "hermes_root_id") != root_id:
        raise MagneticTaskGraphError("magnetic_taskgraph_hermes_readback_invalid")
    status = _required_text(root.get("status"), "hermes_root_status")
    hermes_tasks: list[dict[str, Any]] = []
    for task in tasks:
        if not isinstance(task, dict):
            raise MagneticTaskGraphError("magnetic_taskgraph_hermes_readback_invalid")
        task_id = _required_text(task.get("taskId"), "hermes_task_id")
        dependencies = task.get("dependencyIds")
        if not isinstance(dependencies, list):
            raise MagneticTaskGraphError("magnetic_taskgraph_hermes_readback_invalid")
        hermes_tasks.append({
            "taskId": task_id,
            "title": str(task.get("title") or ""),
            "assignee": str(task.get("assignee") or ""),
            "status": _required_text(task.get("status"), "hermes_task_status"),
            "dependencyIds": [str(value) for value in dependencies],
            "latestAttempt": task.get("latestAttempt"),
            "resultAvailable": task.get("resultAvailable") is True,
            "handoffSummary": task.get("handoffSummary"),
        })
    response: dict[str, Any] = {
        "ok": True,
        "hermesRootId": root_id,
        "state": "running" if any(
            task["status"] == "running" for task in hermes_tasks
        ) else "pending",
        "hermesStatus": status,
        "hermesProfile": str(root.get("assignee") or ""),
        "configuredProvider": str(root.get("provider") or ""),
        "configuredModel": str(root.get("model") or ""),
        "hermesRunId": readback.get("rootRunId"),
        "hermesTasks": hermes_tasks,
    }
    if any(task["status"] == "archived" for task in hermes_tasks):
        return {**response, "state": "cancelled"}
    blocked = next((task for task in hermes_tasks if task["status"] == "blocked"), None)
    if blocked:
        return {
            **response,
            "state": "blocked",
            "error": f"magnetic_taskgraph_task_blocked:{blocked['taskId']}",
        }
    if status != "done":
        return response
    final_result = str(readback.get("finalResult") or "").strip()
    if not final_result:
        return {
            **response,
            "state": "failed",
            "error": "magnetic_taskgraph_final_result_missing",
        }
    return {**response, "state": "completed", "finalResult": final_result}
