"""Magnetic Hermes task, event, attempt, and result readback projection."""

from __future__ import annotations

import json
from typing import Any

from app.python_models.magnetic_taskgraph_authority import (
    MagneticTaskGraphError,
    _MAX_HANDOFF_SUMMARY_CHARS,
    _required_text,
    _task_store,
    hermes_task_runtime_scope,
)
def _creator_children(connection: Any) -> dict[str, list[str]]:
    children: dict[str, list[str]] = {}
    rows = connection.execute(
        "SELECT task_id, payload FROM task_events WHERE kind = 'created' ORDER BY id"
    ).fetchall()
    for row in rows:
        try:
            data = json.loads(row["payload"] or "{}")
        except (TypeError, ValueError):
            continue
        creator = str(data.get("creator_task_id") or "").strip()
        if creator:
            children.setdefault(creator, []).append(str(row["task_id"]))
    return children


def _execution_task_ids(connection: Any, root_id: str) -> list[str]:
    by_creator = _creator_children(connection)
    ordered = [root_id]
    seen = {root_id}
    cursor = 0
    while cursor < len(ordered):
        for task_id in by_creator.get(ordered[cursor], []):
            if task_id not in seen:
                seen.add(task_id)
                ordered.append(task_id)
        cursor += 1
    return ordered

def _bounded_redacted_text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        from agent.redact import redact_sensitive_text

        redacted = redact_sensitive_text(value, force=True).strip()
    except Exception:
        return None
    if not redacted:
        return None
    if len(redacted) <= limit:
        return redacted
    return f"{redacted[:limit - 1]}…"


def _hermes_attempt_evidence(_task: Any, latest_attempt: Any) -> dict[str, Any]:
    summary = _bounded_redacted_text(
        latest_attempt.summary if latest_attempt is not None else None,
        _MAX_HANDOFF_SUMMARY_CHARS,
    )
    return {
        "handoffSummary": summary,
    }


def read_magnetic_taskgraph(payload: dict[str, Any]) -> dict[str, Any]:
    """Read one root while all embedded Hermes imports use Hermes's modules."""

    with hermes_task_runtime_scope():
        return _read_magnetic_taskgraph(payload)


def _read_magnetic_taskgraph(payload: dict[str, Any]) -> dict[str, Any]:
    root_id = _required_text(payload.get("hermesRootId"), "hermes_root_id")
    db_path, task_db, task_db_connect = _task_store()

    with task_db_connect.connect_closing(db_path) as connection:
        root = task_db.get_task(connection, root_id)
        if root is None:
            raise MagneticTaskGraphError("magnetic_taskgraph_hermes_root_not_found")
        task_ids = _execution_task_ids(connection, root_id)
        tasks = [task_db.get_task(connection, task_id) for task_id in task_ids]
        tasks = [task for task in tasks if task is not None]
        blocked = [task for task in tasks if task.status == "blocked"]
        latest_root_run = task_db.latest_run(connection, root_id)
        hermes_tasks = []
        for task in tasks:
            latest_attempt = task_db.latest_run(connection, task.id)
            hermes_tasks.append({
                "taskId": task.id,
                "title": task.title,
                "assignee": task.assignee,
                "status": task.status,
                "dependencyIds": task_db.parent_ids(connection, task.id),
                "latestAttempt": ({
                    "runId": latest_attempt.id,
                    "status": latest_attempt.status,
                    "startedAt": latest_attempt.started_at,
                    "endedAt": latest_attempt.ended_at,
                } if latest_attempt is not None else None),
                "resultAvailable": bool(
                    str(task_db.latest_summary(connection, task.id) or task.result or "").strip()
                ),
                **_hermes_attempt_evidence(task, latest_attempt),
            })
        execution_active = root.status == "running" or any(
            task.id != root_id and task.status == "running" for task in tasks
        )
        response: dict[str, Any] = {
            "ok": True,
            "hermesRootId": root_id,
            "state": "running" if execution_active else "pending",
            "hermesStatus": root.status,
            "hermesProfile": root.assignee,
            "configuredProvider": root.provider_override,
            "configuredProviderApiMode": (
                "codex_app_server" if root.provider_override == "openai-codex" else None
            ),
            "configuredModel": root.model_override,
            "hermesRunId": latest_root_run.id if latest_root_run else None,
            "hermesTasks": hermes_tasks,
        }
        if any(task.status == "archived" for task in tasks):
            return {**response, "state": "cancelled"}
        if blocked:
            return {
                **response,
                "state": "blocked",
                "error": f"magnetic_taskgraph_task_blocked:{blocked[0].id}",
            }
        if root.status != "done":
            return response
        final_result = task_db.latest_summary(connection, root_id) or root.result
        if not str(final_result or "").strip():
            return {
                **response,
                "state": "failed",
                "error": "magnetic_taskgraph_final_result_missing",
            }
        return {
            **response,
            "state": "completed",
            "finalResult": str(final_result),
        }
