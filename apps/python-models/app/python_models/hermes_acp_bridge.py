"""LiquidAIty-owned ACP extensions for stock Hermes.

The stock Hermes ACP agent remains the runtime.  This adapter subclasses its
public agent surface only to expose native Kanban persistence over ACP; it does
not prompt a model, decompose tasks, dispatch workers, or synthesize results.
Those lifecycle steps remain owned by the persistent Hermes gateway.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
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


def _required_text(params: dict[str, Any], key: str) -> str:
    value = str(params.get(key) or "").strip()
    if not value:
        raise ValueError(f"hermes_kanban_{key}_required")
    return value


def _skills(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("hermes_kanban_skills_must_be_list")
    result: list[str] = []
    for raw in value:
        name = str(raw or "").strip()
        if name and name not in result:
            result.append(name)
    return result


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
            allowed = {
                "title",
                "body",
                "assignee",
                "createdBy",
                "idempotencyKey",
                "model",
                "provider",
                "skills",
            }
            unknown = sorted(set(params) - allowed)
            if unknown:
                raise ValueError(f"hermes_kanban_create_unknown_field:{unknown[0]}")
            title = _required_text(params, "title")
            body = _required_text(params, "body")
            assignee = _required_text(params, "assignee")
            created_by = _required_text(params, "createdBy")
            idempotency_key = _required_text(params, "idempotencyKey")
            model = str(params.get("model") or "").strip() or None
            provider = str(params.get("provider") or "").strip() or None
            if provider and not model:
                raise ValueError("hermes_kanban_provider_requires_model")
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
                        model_override=model,
                        provider_override=provider,
                        skills=_skills(params.get("skills")),
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
