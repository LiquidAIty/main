"""Structural Auto Team helpers on top of Hermes' existing Kanban ledger.

Team is a saved profile property, not a model-selected delegation role. A
profile whose own ``config.yaml`` declares ``kanban.task_mode: team`` receives
one marked ``auto-team-v1`` task. Native Triage decomposes that same row into
temporary same-profile workers and later wakes the row for synthesis.

This module deliberately owns no scheduler, task store, dispatcher, or retry
loop. It only reads the selected profile policy, creates the marked root via
``kanban_db.create_task``, and records bounded decomposition failures in that
same database.
"""

from __future__ import annotations

import logging
import sqlite3
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any, Optional

from hermes_cli import kanban_db as kb
from hermes_cli.config import load_config_readonly
from hermes_constants import (
    get_hermes_home,
    named_profile_is_live,
    reset_hermes_home_override,
    set_hermes_home_override,
)


logger = logging.getLogger(__name__)

TEAM_TASK_MODE = "team"
TEAM_WORKFLOW_ID = "auto-team-v1"
TEAM_DECOMPOSITION_STEP = "decomposition"
TEAM_WORKER_STEP = "worker"
TEAM_SYNTHESIS_STEP = "synthesis"


def _profile_config(
    profile: str,
    *,
    profile_home: str | Path | None = None,
) -> tuple[str, dict[str, Any]]:
    """Return ``(canonical_profile, merged_config)`` for one exact profile.

    The context-local home override avoids mutating ``os.environ`` in the
    multiplexed gateway. Missing/deleted profiles remain an honest error for
    strict policy reads. Implicit mode checks convert discovery misses to
    ordinary behavior; an explicit ``profile_home`` remains strict.
    """

    from hermes_cli.profiles import normalize_profile_name

    canonical = normalize_profile_name(str(profile or ""))
    if profile_home is None:
        active_home = get_hermes_home()
        root = active_home.parent.parent if active_home.parent.name == "profiles" else active_home
        selected_home = root if canonical == "default" else root / "profiles" / canonical
    else:
        selected_home = Path(profile_home).expanduser()
        if canonical == "default":
            if selected_home.parent.name == "profiles":
                raise ValueError("The default profile home cannot be a named profile directory")
        elif selected_home.name.casefold() != canonical.casefold():
            raise ValueError(
                f"Profile home {str(selected_home)!r} does not match profile {canonical!r}"
            )
    if canonical != "default" and not named_profile_is_live(selected_home):
        raise FileNotFoundError(f"Named profile home does not exist: {selected_home}")

    token = set_hermes_home_override(selected_home)
    try:
        config = load_config_readonly()
        if not isinstance(config, dict):
            raise RuntimeError(f"Profile {canonical!r} has no readable Hermes configuration")
        return canonical, config
    finally:
        reset_hermes_home_override(token)


def profile_task_mode(
    profile: str,
    *,
    profile_home: str | Path | None = None,
) -> Optional[str]:
    """Read the exact profile's structural Kanban task mode.

    Missing/unresolvable profiles preserve stock ordinary assignment behavior.
    A present but unsupported value raises so a malformed saved authority can
    never silently execute as an ordinary task.
    """

    try:
        _canonical, config = _profile_config(profile, profile_home=profile_home)
    except Exception as exc:
        if profile_home is not None:
            raise
        logger.debug("Team profile mode unavailable for %r: %s", profile, exc)
        return None
    kanban = config.get("kanban") if isinstance(config.get("kanban"), dict) else {}
    mode = str(kanban.get("task_mode") or "").strip().lower()
    if not mode:
        return None
    if mode != TEAM_TASK_MODE:
        raise ValueError(
            f"Profile {_canonical!r} has unsupported kanban.task_mode={mode!r}"
        )
    return mode


def is_team_profile(
    profile: str,
    *,
    profile_home: str | Path | None = None,
) -> bool:
    """Whether ``profile`` is structurally marked as the saved Team profile."""

    return profile_task_mode(profile, profile_home=profile_home) == TEAM_TASK_MODE


def team_profile_policy(
    profile: str,
    *,
    profile_home: str | Path | None = None,
) -> dict[str, Optional[str]]:
    """Read the saved parent and worker model route for a Team profile.

    The parent model is the profile's normal saved ``model`` route. Temporary
    workers use that same profile and its saved ``delegation`` model route.
    Tools and skills therefore remain profile-owned; no task-global Team grant
    or model setting exists.
    """

    canonical, config = _profile_config(profile, profile_home=profile_home)
    kanban = config.get("kanban") if isinstance(config.get("kanban"), dict) else {}
    if str(kanban.get("task_mode") or "").strip().lower() != TEAM_TASK_MODE:
        raise RuntimeError(f"Profile {canonical!r} is not configured with kanban.task_mode=team")

    model = config.get("model") if isinstance(config.get("model"), dict) else {}
    delegation = (
        config.get("delegation") if isinstance(config.get("delegation"), dict) else {}
    )
    parent_provider = str(model.get("provider") or "").strip()
    parent_model = str(model.get("default") or "").strip()
    worker_provider = str(delegation.get("provider") or "").strip()
    worker_model = str(delegation.get("model") or "").strip()
    worker_reasoning = str(delegation.get("reasoning_effort") or "").strip() or None
    if not parent_provider or not parent_model:
        raise RuntimeError(
            f"Team profile {canonical!r} requires saved model.provider/default"
        )
    if not worker_provider or not worker_model:
        raise RuntimeError(
            f"Team profile {canonical!r} requires saved delegation.provider/model"
        )
    return {
        "profile": canonical,
        "parent_provider": parent_provider,
        "parent_model": parent_model,
        "worker_provider": worker_provider,
        "worker_model": worker_model,
        "worker_reasoning": worker_reasoning,
    }


def create_team_root(
    conn: sqlite3.Connection,
    *,
    assignee: str,
    profile_home: str | Path | None = None,
    title: str,
    body: Optional[str] = None,
    created_by: Optional[str] = None,
    tenant: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    model_override: Optional[str] = None,
    provider_override: Optional[str] = None,
    allowed_assignees: Optional[Iterable[str]] = None,
    session_id: Optional[str] = None,
    notify_platform: Optional[str] = None,
    notify_chat_id: Optional[str] = None,
    notify_thread_id: Optional[str] = None,
    notify_user_id: Optional[str] = None,
    notify_user_id_alt: Optional[str] = None,
    notify_chat_type: Optional[str] = None,
    notifier_profile: Optional[str] = None,
    notify_delivery_mode: Optional[str] = None,
    notify_delivery_metadata: Optional[Mapping[str, Any]] = None,
    parents: Iterable[str] = (),
    max_retries: Optional[int] = None,
    max_runtime_seconds: Optional[int] = None,
    skills: Optional[Iterable[str]] = None,
    reasoning_effort: Optional[str] = None,
    workspace_kind: Optional[str] = "scratch",
    workspace_path: Optional[str] = None,
    project_id: Optional[str] = None,
    project_source_task_id: Optional[str] = None,
    board: Optional[str] = None,
    creator_task_id: Optional[str] = None,
    priority: int = 0,
    goal_mode: bool = False,
    goal_max_turns: Optional[int] = None,
    completion_contract: Optional[str] = None,
    initial_status: str = "running",
) -> kb.Task:
    """Create/read back one marked Team root in the caller's existing DB.

    This is the reusable entry point for Kanban tool assignment and later
    Magnetic/Bot callers. Callers provide normal task fields; this helper is
    the sole constructor of the workflow marker and decomposition step.
    Explicit model/provider values must match the saved Team profile so a
    generic task override cannot silently replace Card authority.
    """

    policy = team_profile_policy(assignee, profile_home=profile_home)
    canonical = str(policy["profile"])
    saved_provider = str(policy["parent_provider"])
    saved_model = str(policy["parent_model"])
    if provider_override and str(provider_override).strip() != saved_provider:
        raise ValueError("Team task provider must match the saved Team profile")
    if model_override and str(model_override).strip() != saved_model:
        raise ValueError("Team task model must match the saved Team profile")
    if bool(notify_platform) != bool(notify_chat_id):
        raise ValueError("Team task notification requires both platform and chat id")
    if initial_status != "running":
        raise ValueError("Team tasks enter Triage directly and cannot use an initial blocked state")

    effective_allowed = kb._normalize_allowed_assignees(allowed_assignees)
    if effective_allowed is None:
        effective_allowed = [canonical]
    elif effective_allowed != [canonical]:
        raise ValueError("Team task allowed_assignees must contain only the saved Team profile")
    task_id = kb.create_task(
        conn,
        title=title,
        body=body,
        assignee=canonical,
        created_by=created_by,
        workspace_kind=workspace_kind,
        workspace_path=workspace_path,
        project_id=project_id,
        project_source_task_id=project_source_task_id,
        board=board,
        tenant=tenant,
        priority=priority,
        parents=parents,
        triage=True,
        idempotency_key=idempotency_key,
        max_runtime_seconds=max_runtime_seconds,
        skills=skills,
        max_retries=max_retries,
        model_override=saved_model,
        provider_override=saved_provider,
        reasoning_effort=reasoning_effort,
        goal_mode=goal_mode,
        goal_max_turns=goal_max_turns,
        initial_status=initial_status,
        session_id=session_id,
        creator_task_id=creator_task_id,
        completion_contract=completion_contract,
        workflow_template_id=TEAM_WORKFLOW_ID,
        current_step_key=TEAM_DECOMPOSITION_STEP,
        allowed_assignees=effective_allowed,
    )
    task = kb.get_task(conn, task_id)
    if task is None:
        raise RuntimeError(f"Team root {task_id} was committed but cannot be read back")
    if (
        task.assignee != canonical
        or task.workflow_template_id != TEAM_WORKFLOW_ID
        or task.current_step_key not in {TEAM_DECOMPOSITION_STEP, TEAM_SYNTHESIS_STEP}
        or task.model_override != saved_model
        or task.provider_override != saved_provider
        or task.title != str(title).strip()
        or (task.body or None) != (body or None)
        or task.tenant != tenant
        or (session_id is not None and task.session_id != session_id)
        or (effective_allowed is not None and task.allowed_assignees != effective_allowed)
    ):
        raise RuntimeError(f"Team root {task_id} readback does not match the requested authority")

    if notify_platform and notify_chat_id:
        from hermes_cli.kanban_db_notify import add_notify_sub

        add_notify_sub(
            conn,
            task_id=task_id,
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


def record_decomposition_failure(
    conn: sqlite3.Connection,
    task_id: str,
    reason: str,
    *,
    failure_limit: int,
) -> dict[str, Any]:
    """Count one Team decomposition failure and block at the existing limit.

    Non-Team tasks and Team rows that already left Triage return
    ``handled=False`` and are untouched. The threshold uses the task's
    ``max_retries`` when present, otherwise the gateway dispatcher's existing
    ``failure_limit``. The terminal event is emitted exactly once because the
    same transaction moves the row out of Triage.
    """

    error = str(reason or "Team decomposition failed")[:500]
    with kb.write_txn(conn):
        row = conn.execute(
            "SELECT status, workflow_template_id, consecutive_failures, max_retries "
            "FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if (
            row is None
            or row["status"] != "triage"
            or row["workflow_template_id"] != TEAM_WORKFLOW_ID
        ):
            return {"handled": False, "blocked": False}

        failures = int(row["consecutive_failures"] or 0) + 1
        if row["max_retries"] is not None:
            effective_limit = int(row["max_retries"])
            limit_source = "task"
        else:
            effective_limit = int(failure_limit)
            limit_source = "dispatcher"
        blocked = failures >= effective_limit
        conn.execute(
            "UPDATE tasks SET status = ?, consecutive_failures = ?, last_failure_error = ? "
            "WHERE id = ? AND status = 'triage' AND workflow_template_id = ?",
            (
                "blocked" if blocked else "triage",
                failures,
                error,
                task_id,
                TEAM_WORKFLOW_ID,
            ),
        )
        if blocked:
            kb._append_event(
                conn,
                task_id,
                "gave_up",
                {
                    "error": error,
                    "failures": failures,
                    "effective_limit": effective_limit,
                    "limit_source": limit_source,
                    "trigger_outcome": "decomposition_failed",
                    "step_key": TEAM_DECOMPOSITION_STEP,
                    "workflow_template_id": TEAM_WORKFLOW_ID,
                },
            )
        return {
            "handled": True,
            "blocked": blocked,
            "failures": failures,
            "effective_limit": effective_limit,
            "limit_source": limit_source,
            "error": error,
        }
