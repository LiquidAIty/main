"""Magnetic taskgraph admission over Hermes's existing SQLite task owner.

The saved Magnetic profile owns one root. Its configured Bot roster is the
exact blue-wire worker ceiling. This module adds no board, scheduler, worker
store, or orchestration UI; ordinary Hermes task dispatch performs the work.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any, Optional

from hermes_cli import kanban_db as kb
from hermes_cli.kanban_team import MAGNETIC_TASK_MODE, _profile_config
from hermes_cli.profiles import normalize_profile_name
from hermes_constants import named_profile_is_live

MAGNETIC_WORKFLOW_ID = "liquidaity-magnetic-v1"
MAGNETIC_ROOT_STEP = "magnetic-orchestration"


def _magnetic_policy(
    profile: str,
    worker_profiles: Iterable[str],
    *,
    profile_home: str | Path | None = None,
) -> dict[str, Any]:
    canonical, config = _profile_config(profile, profile_home=profile_home)
    kanban = config.get("kanban") if isinstance(config.get("kanban"), dict) else {}
    if str(kanban.get("task_mode") or "").strip().lower() != MAGNETIC_TASK_MODE:
        raise RuntimeError(
            f"Profile {canonical!r} is not configured with "
            "kanban.task_mode=magnetic"
        )
    model = config.get("model") if isinstance(config.get("model"), dict) else {}
    provider = str(model.get("provider") or "").strip()
    model_name = str(model.get("default") or "").strip()
    if not provider or not model_name:
        raise RuntimeError(
            f"Magnetic profile {canonical!r} requires saved model.provider/default"
        )

    selected_home = Path(profile_home).expanduser() if profile_home else Path()
    root = (
        selected_home.parent.parent
        if selected_home.parent.name == "profiles"
        else selected_home
    )
    workers: list[str] = []
    seen: set[str] = set()
    for raw in worker_profiles:
        worker = normalize_profile_name(str(raw or ""))
        if worker == canonical:
            raise ValueError("Magnetic worker roster cannot contain the orchestrator")
        if worker in seen:
            raise ValueError("Magnetic worker roster contains a duplicate profile")
        worker_home = root if worker == "default" else root / "profiles" / worker
        if worker != "default" and not named_profile_is_live(worker_home):
            raise ValueError(f"Magnetic worker profile is not live: {worker}")
        seen.add(worker)
        workers.append(worker)
    if not workers:
        raise ValueError("Magnetic requires at least one blue-wire worker")
    return {
        "profile": canonical,
        "provider": provider,
        "model": model_name,
        "workers": workers,
        "allowed_assignees": [canonical, *workers],
    }


def create_magnetic_root(
    conn: sqlite3.Connection,
    *,
    assignee: str,
    worker_profiles: Iterable[str],
    profile_home: str | Path | None = None,
    title: str,
    body: str,
    created_by: str,
    session_id: str,
    idempotency_key: Optional[str] = None,
    notify_platform: Optional[str] = None,
    notify_chat_id: Optional[str] = None,
    notify_thread_id: Optional[str] = None,
    notify_user_id: Optional[str] = None,
    notify_user_id_alt: Optional[str] = None,
    notify_chat_type: Optional[str] = None,
    notifier_profile: Optional[str] = None,
    notify_delivery_mode: Optional[str] = None,
    notify_delivery_metadata: Optional[Mapping[str, Any]] = None,
) -> kb.Task:
    """Stage one exact blue-roster Magnetic root for later atomic activation."""

    policy = _magnetic_policy(
        assignee,
        worker_profiles,
        profile_home=profile_home,
    )
    if bool(notify_platform) != bool(notify_chat_id):
        raise ValueError("Magnetic notification requires both platform and chat id")
    task_id = kb.create_task(
        conn,
        title=title,
        body=body,
        assignee=policy["profile"],
        created_by=created_by,
        workspace_kind="scratch",
        project_id="",
        model_override=policy["model"],
        provider_override=policy["provider"],
        allowed_assignees=policy["allowed_assignees"],
        workflow_template_id=MAGNETIC_WORKFLOW_ID,
        current_step_key=MAGNETIC_ROOT_STEP,
        session_id=session_id,
        idempotency_key=idempotency_key,
        initial_status="blocked",
    )
    task = kb.get_task(conn, task_id)
    if (
        task is None
        or task.assignee != policy["profile"]
        or task.body != body
        or task.session_id != session_id
        or task.provider_override != policy["provider"]
        or task.model_override != policy["model"]
        or task.allowed_assignees != policy["allowed_assignees"]
        or task.workflow_template_id != MAGNETIC_WORKFLOW_ID
        or task.current_step_key != MAGNETIC_ROOT_STEP
    ):
        raise RuntimeError("Magnetic root readback does not match saved wire authority")
    if notify_platform and notify_chat_id:
        from hermes_cli.kanban_db_notify import add_notify_sub

        add_notify_sub(
            conn,
            task_id=task.id,
            platform=notify_platform,
            chat_id=notify_chat_id,
            thread_id=notify_thread_id,
            user_id=notify_user_id,
            user_id_alt=notify_user_id_alt,
            chat_type=notify_chat_type,
            notifier_profile=notifier_profile,
            delivery_mode=notify_delivery_mode,
            delivery_metadata=notify_delivery_metadata,
        )
    return task


def activate_staged_magnetic_root(
    conn: sqlite3.Connection,
    task_id: str,
) -> bool:
    task = kb.get_task(conn, task_id)
    if task is None or task.status != "blocked" or not task.allowed_assignees:
        return False
    activated, _reason = kb.promote_task(
        conn,
        task_id,
        actor="message_agent",
        reason="saved blue-wire taskgraph admitted",
    )
    if not activated:
        return False
    current = kb.get_task(conn, task_id)
    return bool(current and current.status == "ready")
