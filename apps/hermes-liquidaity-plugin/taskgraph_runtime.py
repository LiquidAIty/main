# Entity: TaskGraphs
# Relationship: Admits one Team or Magnetic Bot assignment through the public PluginContext tool dispatcher while Hermes retains task creation, subscriptions, dispatch, workers, and completion.
"""Public-plugin admission into Hermes's one task/dependency runtime."""

from __future__ import annotations

import hashlib
import json
from typing import Any


TASKGRAPH_TOOL_NAME = "taskgraph_start"
TASKGRAPH_MODES = frozenset({"team", "magnetic"})


def _task_mode(ctx: Any) -> str:
    mode = str(ctx.get_config("task_mode", "") or "").strip().lower()
    return mode if mode in TASKGRAPH_MODES else ""


def taskgraph_available(ctx: Any) -> bool:
    return _task_mode(ctx) in TASKGRAPH_MODES


def taskgraph_schema() -> dict[str, Any]:
    return {
        "name": TASKGRAPH_TOOL_NAME,
        "description": (
            "Category: coordination/taskgraph. Admit the exact current Bot assignment "
            "to this saved Card's Hermes taskgraph. Team uses automatic same-profile "
            "decomposition and synthesis; Magnetic uses only its saved blue-wire roster. "
            "Call once, then report the returned root ID without polling or resubmitting."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "mission": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 16000,
                    "description": "The exact bounded assignment received in this Bot turn.",
                },
            },
            "required": ["mission"],
            "additionalProperties": False,
        },
    }


def _tool_result(value: Any) -> dict[str, Any]:
    if not isinstance(value, str):
        raise RuntimeError("liquidaity_taskgraph_tool_result_invalid")
    try:
        result = json.loads(value)
    except (TypeError, ValueError) as error:
        raise RuntimeError("liquidaity_taskgraph_tool_result_invalid") from error
    if not isinstance(result, dict):
        raise RuntimeError("liquidaity_taskgraph_tool_result_invalid")
    if result.get("ok") is not True:
        raise RuntimeError(str(result.get("error") or "liquidaity_taskgraph_admission_failed"))
    return result


def execute_taskgraph(
    ctx: Any,
    arguments: dict[str, Any],
    *,
    session_id: str,
    turn_id: str,
    tool_call_id: str,
) -> dict[str, Any]:
    mission = arguments.get("mission")
    if not isinstance(mission, str) or not mission.strip() or len(mission) > 16000:
        raise ValueError("liquidaity_taskgraph_mission_invalid")
    source_session = str(session_id or "").strip()
    if not source_session:
        raise ValueError("liquidaity_taskgraph_session_required")
    source_turn = str(turn_id or "").strip()
    source_call = str(tool_call_id or "").strip()
    if not source_turn or not source_call:
        raise ValueError("liquidaity_taskgraph_turn_identity_required")
    mode = _task_mode(ctx)
    if mode not in TASKGRAPH_MODES:
        raise ValueError("liquidaity_taskgraph_profile_not_configured")
    idempotency_key = "liquidaity-taskgraph:" + hashlib.sha256(
        "\x00".join((
            str(ctx.profile_name), source_session, source_turn, source_call,
        )).encode("utf-8")
    ).hexdigest()
    admitted = _tool_result(ctx.dispatch_tool(
        "kanban_create",
        {
            "title": "AutoTeam assignment" if mode == "team" else "Magnetic mission",
            "body": mission,
            "assignee": str(ctx.profile_name),
            "workspace_kind": "scratch",
            "project": "",
            "session_id": source_session,
            "idempotency_key": idempotency_key,
        },
        session_id=source_session,
        turn_id=source_turn,
        tool_call_id=source_call,
    ))
    root_task_id = str(admitted.get("task_id") or "").strip()
    if not root_task_id:
        raise RuntimeError("liquidaity_taskgraph_root_missing")
    return {
        "ok": True,
        "status": "accepted",
        "mode": mode,
        "rootTaskId": root_task_id,
        "subscribed": admitted.get("subscribed") is True,
        "message": "Hermes accepted the taskgraph root; do not poll or resubmit.",
    }


def build_handler(ctx: Any):
    def handler(
        arguments: dict[str, Any],
        *,
        session_id: str = "",
        turn_id: str = "",
        tool_call_id: str = "",
        **_: Any,
    ) -> str:
        return json.dumps(
            execute_taskgraph(
                ctx,
                arguments,
                session_id=session_id,
                turn_id=turn_id,
                tool_call_id=tool_call_id,
            ),
            ensure_ascii=False,
            separators=(",", ":"),
        )

    return handler
