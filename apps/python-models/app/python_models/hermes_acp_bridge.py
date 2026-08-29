"""LiquidAIty-owned ACP extensions for stock Hermes.

The stock Hermes ACP agent remains the runtime.  This adapter subclasses its
public agent surface only to expose native manager operations and native
Kanban persistence over ACP.  Each write delegates one flat operation to an
existing Hermes handler and then reads the native owner back; it does not
assemble profile files, prompt a model, decompose tasks, dispatch workers, or
synthesize results. Those lifecycle steps remain owned by Hermes.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import redirect_stdout
from dataclasses import asdict
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[4]
HERMES_ROOT = REPO_ROOT / "Hermes"
if str(HERMES_ROOT) not in sys.path:
    sys.path.insert(0, str(HERMES_ROOT))

import acp  # noqa: E402
from acp_adapter.entry import _load_env, _setup_logging  # noqa: E402
from acp_adapter.server import HermesACPAgent  # noqa: E402


logger = logging.getLogger(__name__)


def _native_manager_call(method: str, params: dict[str, Any]) -> dict[str, Any]:
    """Invoke the installed Hermes manager handler without copying its logic."""
    # Hermes' gateway reserves stdout for its own JSON-RPC transport at import
    # time. This process already owns stdout for ACP, so keep the gateway's
    # diagnostics on stderr and restore ACP stdout before ACP sends our result.
    with redirect_stdout(sys.stderr):
        from tui_gateway import server as gateway

        response = gateway.handle_request(
            {"jsonrpc": "2.0", "id": "liquidaity", "method": method, "params": params}
        )
    if not isinstance(response, dict):
        raise ValueError("hermes_native_manager_response_missing")
    error = response.get("error")
    if isinstance(error, dict):
        message = str(error.get("message") or "native manager request failed")
        raise ValueError(f"hermes_native_manager_error:{message}")
    result = response.get("result")
    if not isinstance(result, dict):
        raise ValueError("hermes_native_manager_response_invalid")
    return result


def _required_text(params: dict[str, Any], key: str) -> str:
    value = str(params.get(key) or "").strip()
    if not value:
        raise ValueError(f"hermes_kanban_{key}_required")
    return value


def _required_native_text(params: dict[str, Any], key: str) -> str:
    value = str(params.get(key) or "").strip()
    if not value:
        raise ValueError(f"hermes_native_{key}_required")
    return value


def _native_profile_scope_call(
    profile: str,
    method: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Scope a native handler that does not itself accept ``profile``."""
    from hermes_cli.profiles import get_profile_dir
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    profile_dir = get_profile_dir(profile)
    if not profile_dir or not profile_dir.is_dir():
        raise ValueError(f"hermes_native_profile_not_found:{profile}")
    token = set_hermes_home_override(str(profile_dir))
    try:
        return _native_manager_call(method, params)
    finally:
        reset_hermes_home_override(token)


_NATIVE_MANAGER_METHODS = frozenset(
    {
        "profiles.describe",
        "profiles.configure",
        "learning.frames",
        "learning.graph",
        "learning.detail",
        "learning.edit",
        "skills.manage",
        "tools.show",
        "plugins.list",
        "tools.configure",
        "toolsets.list",
        "mcp.servers.list",
        "mcp.servers.test",
        "command.dispatch",
    }
)

_PROFILE_SCOPED_MANAGER_METHODS = frozenset(
    {
        "learning.frames",
        "learning.graph",
        "learning.detail",
        "learning.edit",
        "tools.show",
        "plugins.list",
        "tools.configure",
        "toolsets.list",
        "command.dispatch",
    }
)


def _call_native_manager(params: dict[str, Any]) -> dict[str, Any]:
    """Call one allowlisted Hermes manager operation without translating it."""
    unknown = sorted(set(params) - {"method", "params", "profile"})
    if unknown:
        raise ValueError(f"hermes_native_call_unknown_field:{unknown[0]}")
    method = _required_native_text(params, "method")
    if method not in _NATIVE_MANAGER_METHODS:
        raise ValueError(f"hermes_native_method_unsupported:{method}")
    native_params = params.get("params")
    if not isinstance(native_params, dict):
        raise ValueError("hermes_native_params_must_be_object")
    native_params = dict(native_params)
    profile = str(params.get("profile") or "").strip()
    if method == "command.dispatch":
        if str(native_params.get("name") or "").lstrip("/").lower() != "learn":
            raise ValueError("hermes_native_command_unsupported")
    if method == "learning.graph":
        if not profile:
            raise ValueError("hermes_native_profile_required")
        from hermes_cli.profiles import get_profile_dir
        from hermes_constants import reset_hermes_home_override, set_hermes_home_override

        profile_dir = get_profile_dir(profile)
        if not profile_dir or not profile_dir.is_dir():
            raise ValueError(f"hermes_native_profile_not_found:{profile}")
        token = set_hermes_home_override(str(profile_dir))
        try:
            from agent.learning_graph import build_learning_graph

            return build_learning_graph()
        finally:
            reset_hermes_home_override(token)
    if method in _PROFILE_SCOPED_MANAGER_METHODS:
        if not profile:
            raise ValueError("hermes_native_profile_required")
        return _native_profile_scope_call(profile, method, native_params)
    return _native_manager_call(method, native_params)


def _exact_roots(conn: Any, *, title: str, body: str, created_by: str) -> list[Any]:
    from hermes_cli import kanban_db as kb

    matches = [
        task
        for task in kb.list_tasks(conn, include_archived=False)
        if task.title == title
        and (task.body or "") == body
        and (task.created_by or "") == created_by
    ]
    return sorted(matches, key=lambda task: (task.created_at, task.id))


def _task_snapshot(task_id: str) -> dict[str, Any]:
    from hermes_cli import kanban_db as kb

    with kb.connect_closing() as conn:
        task = kb.get_task(conn, task_id)
        if task is None:
            raise ValueError("hermes_kanban_task_not_found")
        comments = kb.list_comments(conn, task_id)
        events = kb.list_events(conn, task_id)
        runs = kb.list_runs(conn, task_id)
        return {
            "task": asdict(task),
            "latest_summary": kb.latest_summary(conn, task_id),
            "parents": kb.parent_ids(conn, task_id),
            "children": kb.child_ids(conn, task_id),
            "comments": [asdict(comment) for comment in comments],
            "events": [asdict(event) for event in events],
            "runs": [asdict(run) for run in runs],
        }


class LiquidAItyHermesACPAgent(HermesACPAgent):
    """Stock Hermes ACP agent plus contained native-Kanban transport calls."""

    async def ext_method(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if method == "native/call":
            if not isinstance(params, dict):
                raise ValueError("hermes_native_call_params_must_be_object")
            return _call_native_manager(params)

        if method == "kanban/find":
            if not isinstance(params, dict):
                raise ValueError("hermes_kanban_find_params_must_be_object")
            unknown = sorted(set(params) - {"title", "body", "createdBy"})
            if unknown:
                raise ValueError(f"hermes_kanban_find_unknown_field:{unknown[0]}")
            title = _required_text(params, "title")
            body = _required_text(params, "body")
            created_by = _required_text(params, "createdBy")
            from hermes_cli import kanban_db as kb

            with kb.connect_closing() as conn:
                matches = _exact_roots(
                    conn, title=title, body=body, created_by=created_by
                )
            return {
                "id": matches[0].id if matches else None,
                "duplicateIds": [task.id for task in matches[1:]],
            }

        if method == "kanban/create":
            if not isinstance(params, dict):
                raise ValueError("hermes_kanban_create_params_must_be_object")
            allowed = {"title", "body", "assignee", "createdBy", "idempotencyKey"}
            unknown = sorted(set(params) - allowed)
            if unknown:
                raise ValueError(f"hermes_kanban_create_unknown_field:{unknown[0]}")
            title = _required_text(params, "title")
            body = _required_text(params, "body")
            assignee = _required_text(params, "assignee")
            created_by = _required_text(params, "createdBy")
            idempotency_key = _required_text(params, "idempotencyKey")
            from hermes_cli import kanban_db as kb

            with kb.connect_closing() as conn:
                matches = _exact_roots(
                    conn, title=title, body=body, created_by=created_by
                )
                if matches:
                    task_id = matches[0].id
                    rejoined = True
                    duplicate_ids = [task.id for task in matches[1:]]
                else:
                    task_id = kb.create_task(
                        conn,
                        title=title,
                        body=body,
                        assignee=assignee,
                        created_by=created_by,
                        triage=True,
                        idempotency_key=idempotency_key,
                    )
                    rejoined = False
                    duplicate_ids = []
            snapshot = _task_snapshot(task_id)
            return {
                "id": task_id,
                "rejoined": rejoined,
                "duplicateIds": duplicate_ids,
                "task": snapshot["task"],
            }

        if method == "kanban/show":
            if not isinstance(params, dict):
                raise ValueError("hermes_kanban_show_params_must_be_object")
            unknown = sorted(set(params) - {"taskId"})
            if unknown:
                raise ValueError(f"hermes_kanban_show_unknown_field:{unknown[0]}")
            return _task_snapshot(_required_text(params, "taskId"))

        if method == "kanban/reclaim":
            if not isinstance(params, dict):
                raise ValueError("hermes_kanban_reclaim_params_must_be_object")
            unknown = sorted(set(params) - {"taskId", "reason"})
            if unknown:
                raise ValueError(f"hermes_kanban_reclaim_unknown_field:{unknown[0]}")
            task_id = _required_text(params, "taskId")
            reason = str(params.get("reason") or "LiquidAIty operator reclaim").strip()
            from hermes_cli import kanban_db as kb

            with kb.connect_closing() as conn:
                if not kb.reclaim_task(conn, task_id, reason=reason):
                    raise ValueError("hermes_kanban_task_not_reclaimable")
            return _task_snapshot(task_id)

        if method == "kanban/terminate":
            if not isinstance(params, dict):
                raise ValueError("hermes_kanban_terminate_params_must_be_object")
            unknown = sorted(set(params) - {"runId", "reason"})
            if unknown:
                raise ValueError(f"hermes_kanban_terminate_unknown_field:{unknown[0]}")
            try:
                run_id = int(params.get("runId"))
            except (TypeError, ValueError) as exc:
                raise ValueError("hermes_kanban_runId_required") from exc
            reason = str(params.get("reason") or "LiquidAIty operator terminate").strip()
            from hermes_cli import kanban_db as kb

            with kb.connect_closing() as conn:
                run = kb.get_run(conn, run_id)
                if run is None:
                    raise ValueError("hermes_kanban_run_not_found")
                if run.ended_at is not None:
                    raise ValueError("hermes_kanban_run_already_ended")
                if not kb.reclaim_task(conn, run.task_id, reason=reason):
                    raise ValueError("hermes_kanban_run_not_terminable")
                task_id = run.task_id
            return _task_snapshot(task_id)

        return await super().ext_method(method, params)


def main() -> None:
    _setup_logging()
    _load_env()
    logger.info("Starting LiquidAIty ACP bridge over stock Hermes")
    try:
        asyncio.run(
            acp.run_agent(LiquidAItyHermesACPAgent(), use_unstable_protocol=True)
        )
    except KeyboardInterrupt:
        logger.info("Shutting down LiquidAIty ACP bridge")


if __name__ == "__main__":
    main()
