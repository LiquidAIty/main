"""Durable Auto-Kanban dispatch for ``delegate_task(role="team")``.

This module is deliberately a thin adapter into the existing Kanban domain.
It creates one paused native root, lets an optional ACP host correlate that
identity, then activates Triage for the gateway-owned dispatcher.  It owns no
task graph, scheduler, worker process, polling loop, or result synthesis.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from agent.runtime_cwd import resolve_agent_cwd
from hermes_cli import kanban_db as kb
from hermes_cli.config import load_config
from hermes_constants import (
    get_default_hermes_root,
    get_hermes_home,
    reset_hermes_home_override,
    set_hermes_home_override,
)


TEAM_WORKFLOW_ID = "delegate-team-v1"
TEAM_CREATED_BY = "delegate_task:team"


def _shared_config() -> dict[str, Any]:
    """Read the gateway/root Hermes config from a profile-scoped process."""

    token = set_hermes_home_override(str(get_default_hermes_root()))
    try:
        config = load_config()
        return config if isinstance(config, dict) else {}
    finally:
        reset_hermes_home_override(token)


def _active_profile_name() -> str:
    home = Path(get_hermes_home()).resolve()
    if home.parent.name.lower() == "profiles" and home.name:
        return home.name.lower()
    try:
        from hermes_cli.profiles import get_active_profile_name

        return str(get_active_profile_name() or "default").strip().lower()
    except Exception:
        return "default"


def _origin_session_id(parent_agent: Any) -> str:
    try:
        from tools.async_delegation import _current_origin_session_id

        current = str(_current_origin_session_id() or "").strip()
    except Exception:
        current = ""
    return current or str(getattr(parent_agent, "session_id", "") or "").strip()


def _team_policy(config: dict[str, Any]) -> dict[str, Any]:
    kanban = config.get("kanban") if isinstance(config.get("kanban"), dict) else {}
    auxiliary = (
        config.get("auxiliary") if isinstance(config.get("auxiliary"), dict) else {}
    )
    decomposer = (
        auxiliary.get("kanban_decomposer")
        if isinstance(auxiliary.get("kanban_decomposer"), dict)
        else {}
    )
    root_provider = str(decomposer.get("provider") or "").strip()
    root_model = str(decomposer.get("model") or "").strip()
    worker_provider = str(kanban.get("team_worker_provider") or "").strip()
    worker_model = str(kanban.get("team_worker_model") or "").strip()
    if not root_provider or not root_model:
        raise RuntimeError(
            "Team requires auxiliary.kanban_decomposer.provider/model before task creation."
        )
    if not worker_provider or not worker_model:
        raise RuntimeError(
            "Team requires kanban.team_worker_provider/model before task creation."
        )
    if kanban.get("auto_decompose", True) is False:
        raise RuntimeError("Team requires kanban.auto_decompose=true.")
    if kanban.get("dispatch_in_gateway", True) is False:
        raise RuntimeError("Team requires kanban.dispatch_in_gateway=true.")
    try:
        max_workers = max(2, min(4, int(kanban.get("team_max_workers", 4))))
    except (TypeError, ValueError):
        max_workers = 4
    try:
        max_retries = max(1, int(kanban.get("failure_limit", 2)))
    except (TypeError, ValueError):
        max_retries = 2
    return {
        "root_provider": root_provider,
        "root_model": root_model,
        "worker_provider": worker_provider,
        "worker_model": worker_model,
        "max_workers": max_workers,
        "max_retries": max_retries,
    }


def submit_team(
    *,
    goal: str,
    context: str | None,
    parent_agent: Any,
) -> dict[str, Any]:
    """Create and activate exactly one durable native Team root."""

    goal_text = str(goal or "").strip()
    context_text = str(context or "").strip()
    if not goal_text:
        raise ValueError("Team goal is required.")
    if len(goal_text) > 20_000 or len(context_text) > 100_000:
        raise ValueError("Team goal/context exceeds the native bounded packet limit.")

    shared_config = _shared_config()
    policy = _team_policy(shared_config)
    from hermes_cli.kanban import _check_dispatcher_presence

    repository_home = Path(get_default_hermes_root())
    running, dispatcher_status = _check_dispatcher_presence(repository_home)
    if not running:
        raise RuntimeError(
            "Team dispatcher unavailable for repository Hermes home "
            f"{repository_home}: {dispatcher_status}"
        )

    session_id = _origin_session_id(parent_agent)
    if not session_id:
        raise RuntimeError("Team requires a durable originating Hermes session.")
    profile = _active_profile_name()
    title = next((line.strip() for line in goal_text.splitlines() if line.strip()), goal_text)
    title = title[:200]
    body = f"Mission:\n{goal_text}"
    if context_text:
        body += f"\n\nExplicit parent-authored context:\n{context_text}"
    idempotency_key = "delegate-team:" + hashlib.sha256(
        f"{session_id}\0{goal_text}\0{context_text}".encode("utf-8")
    ).hexdigest()

    with kb.connect_closing() as conn:
        task_id = kb.create_task(
            conn,
            title=title,
            body=body,
            assignee=profile,
            created_by=TEAM_CREATED_BY,
            workspace_kind="dir",
            workspace_path=str(resolve_agent_cwd()),
            triage=False,
            initial_status="blocked",
            idempotency_key=idempotency_key,
            max_retries=policy["max_retries"],
            model_override=policy["root_model"],
            provider_override=policy["root_provider"],
            session_id=session_id,
            workflow_template_id=TEAM_WORKFLOW_ID,
            current_step_key="correlation",
        )
        task = kb.get_task(conn, task_id)
        if task is None:
            raise RuntimeError(f"Team root {task_id} was committed but cannot be read back.")

    # LIQUIDAITY VENDOR PATCH: this generic host callback carries only opaque
    # native/session ids and model receipts.  Standalone Hermes has no host and
    # continues with the same native root.
    from acp_adapter.host_profiles import allocate_host_native_execution

    try:
        host_context = allocate_host_native_execution(
            parent_agent,
            native_child_id=task_id,
            provider=policy["root_provider"],
            model=policy["root_model"],
        )
    except Exception as exc:
        raise RuntimeError(
            f"Team root {task_id} is durable but host correlation failed: {exc}"
        ) from exc

    with kb.connect_closing() as conn:
        current = kb.get_task(conn, task_id)
        if current is None:
            raise RuntimeError(f"Team root {task_id} disappeared before activation.")
        if current.status == "blocked":
            if not kb.activate_team_triage_task(conn, task_id):
                raise RuntimeError(f"Team root {task_id} could not enter Triage.")
        elif current.status not in {
            "triage", "todo", "ready", "running", "review", "done"
        }:
            raise RuntimeError(
                f"Team root {task_id} is durable in unexpected state {current.status!r}."
            )
        from tools.kanban_tools import _maybe_auto_subscribe

        subscribed = _maybe_auto_subscribe(conn, task_id)
        active = kb.get_task(conn, task_id)

    return {
        "ok": True,
        "engine": "auto-kanban",
        "role": "team",
        "task_id": task_id,
        "status": active.status if active else "unknown",
        "durable": True,
        "subscribed": subscribed,
        "host_correlated": host_context is not None,
        "profile": profile,
        "policy": {
            "decomposition_provider": policy["root_provider"],
            "decomposition_model": policy["root_model"],
            "worker_provider": policy["worker_provider"],
            "worker_model": policy["worker_model"],
            "max_workers": policy["max_workers"],
            "max_depth": 1,
            "synthesis_provider": policy["root_provider"],
            "synthesis_model": policy["root_model"],
        },
        "message": (
            "Durable Team accepted. Hermes Auto-Kanban owns decomposition, "
            "workers, review, synthesis, retries, Stop, notification, and rejoin."
        ),
    }
