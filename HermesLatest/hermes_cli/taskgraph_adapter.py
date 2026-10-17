"""Public process boundary for exact Hermes taskgraph stage, activation and readback.

This additive adapter owns no task semantics. It validates bounded JSON, then
calls the existing profile, Kanban database, Team-root and redaction owners in
the Hermes interpreter that ships those dependencies.
"""

from __future__ import annotations

import json
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


MAX_REQUEST_BYTES = 2_000_000
MAX_RESPONSE_BYTES = 2_000_000
AUTHORITY_EVENT = "card_authority_bound"
MAX_SUMMARY_CHARS = 2_000


class TaskGraphAdapterError(RuntimeError):
    pass


def _text(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise TaskGraphAdapterError(f"{field}_required")
    return text


def _hermes_home() -> Path:
    configured = str(os.environ.get("HERMES_HOME") or "").strip()
    home = Path(configured) if configured else Path(__file__).resolve().parents[1] / ".hermes"
    home = home.expanduser().resolve(strict=False)
    if not home.is_dir():
        raise TaskGraphAdapterError("hermes_home_missing")
    return home


@contextmanager
def _home_scope(home: Path) -> Iterator[None]:
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    token = set_hermes_home_override(home)
    try:
        yield
    finally:
        reset_hermes_home_override(token)


def _profile_home(home: Path, name: str) -> Path | None:
    from hermes_cli.profiles import normalize_profile_name, validate_profile_name
    from hermes_constants import named_profile_is_live

    canonical = normalize_profile_name(name)
    try:
        validate_profile_name(canonical)
    except ValueError:
        return None
    candidate = home if canonical == "default" else home / "profiles" / canonical
    if canonical == "default":
        return candidate if candidate.is_dir() else None
    return candidate if named_profile_is_live(candidate) else None


def validate_profiles(request: dict[str, Any]) -> dict[str, Any]:
    home = _hermes_home()
    profile = _text(request.get("profile"), "profile").lower()
    provider = _text(request.get("provider"), "provider")
    model = _text(request.get("model"), "model")
    instructions = _text(request.get("instructions"), "instructions")
    workers = request.get("workers")
    if (
        not isinstance(workers, list)
        or not workers
        or any(not isinstance(item, str) or not item.strip() for item in workers)
    ):
        raise TaskGraphAdapterError("worker_profiles_invalid")
    worker_profiles = [str(item).strip().lower() for item in workers]
    if len(worker_profiles) != len(set(worker_profiles)):
        raise TaskGraphAdapterError("worker_profiles_duplicate")
    with _home_scope(home):
        orchestrator_home = _profile_home(home, profile)
        if orchestrator_home is None:
            raise TaskGraphAdapterError(f"orchestrator_profile_missing:{profile}")
        missing = [name for name in worker_profiles if _profile_home(home, name) is None]
        if missing:
            raise TaskGraphAdapterError(f"worker_profile_missing:{','.join(missing)}")
        from hermes_cli.config import load_config
        from hermes_constants import reset_hermes_home_override, set_hermes_home_override

        token = set_hermes_home_override(orchestrator_home)
        try:
            config = load_config() or {}
            model_config = config.get("model") or {}
            agent_config = config.get("agent") or {}
            soul_path = orchestrator_home / "SOUL.md"
            try:
                soul = soul_path.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                soul = None
            if (
                model_config.get("provider") != provider
                or model_config.get("default") != model
                or "system_prompt" in agent_config
                or soul != instructions
            ):
                raise TaskGraphAdapterError("orchestrator_materialization_mismatch")
        finally:
            reset_hermes_home_override(token)
    return {
        "ok": True,
        "profile": profile,
        "provider": provider,
        "model": model,
        "workers": worker_profiles,
    }


def _store() -> tuple[Path, Any, Any]:
    from hermes_cli import kanban_db, kanban_db_connect

    db_path = _hermes_home() / "kanban.db"
    kanban_db_connect.init_db(db_path)
    return db_path, kanban_db, kanban_db_connect


def _authority_payload(value: Any) -> dict[str, Any]:
    if not isinstance(value, list) or not value:
        raise TaskGraphAdapterError("worker_authorities_invalid")
    workers: list[dict[str, str]] = []
    profiles: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {"cardId", "cardRevisionId", "profile"}:
            raise TaskGraphAdapterError("worker_authorities_invalid")
        worker = {
            "cardId": _text(item.get("cardId"), "worker_card"),
            "cardRevisionId": _text(item.get("cardRevisionId"), "worker_revision"),
            "profile": _text(item.get("profile"), "worker_profile").lower(),
        }
        if worker["profile"] in profiles:
            raise TaskGraphAdapterError("worker_authorities_duplicate")
        profiles.add(worker["profile"])
        workers.append(worker)
    return {"workers": workers}


def _bind_authorities(connection: Any, kanban_db: Any, root_id: str, value: Any) -> None:
    expected = _authority_payload(value)
    with kanban_db.write_txn(connection):
        rows = connection.execute(
            "SELECT payload FROM task_events WHERE task_id = ? AND kind = ? ORDER BY id",
            (root_id, AUTHORITY_EVENT),
        ).fetchall()
        if not rows:
            kanban_db.append_task_event(connection, root_id, AUTHORITY_EVENT, expected)
            return
        try:
            actual = json.loads(rows[0]["payload"])
        except (TypeError, ValueError):
            actual = None
        if len(rows) != 1 or actual != expected:
            raise TaskGraphAdapterError("worker_authority_binding_mismatch")


def _task_projection(task: Any) -> dict[str, Any]:
    return {
        "taskId": task.id,
        "title": task.title,
        "body": task.body,
        "assignee": task.assignee,
        "createdBy": task.created_by,
        "status": task.status,
        "tenant": task.tenant,
        "provider": task.provider_override,
        "model": task.model_override,
        "allowedAssignees": list(task.allowed_assignees or []),
    }


def stage_root(request: dict[str, Any]) -> dict[str, Any]:
    db_path, kanban_db, connect = _store()
    run_id = _text(request.get("runId"), "run_id")
    profile = _text(request.get("profile"), "profile").lower()
    provider = _text(request.get("provider"), "provider")
    model = _text(request.get("model"), "model")
    tenant = _text(request.get("tenant"), "tenant")
    title = _text(request.get("title"), "title")[:200]
    body = _text(request.get("body"), "body")
    worker_profiles = request.get("workerProfiles")
    if not isinstance(worker_profiles, list) or not worker_profiles:
        raise TaskGraphAdapterError("worker_profiles_invalid")
    worker_profiles = [_text(value, "worker_profile").lower() for value in worker_profiles]
    direct_team = request.get("directTeam") is True
    allowed_assignees = [profile] if direct_team else [profile, *worker_profiles]
    if len(allowed_assignees) != len(set(allowed_assignees)):
        raise TaskGraphAdapterError("allowed_assignees_duplicate")
    with connect.connect_closing(db_path) as connection:
        if direct_team:
            from hermes_cli.kanban_team import create_team_root

            if len(worker_profiles) != 1 or profile != worker_profiles[0]:
                raise TaskGraphAdapterError("team_root_profile_invalid")
            root = create_team_root(
                connection,
                title=title,
                body=body,
                assignee=profile,
                profile_home=_hermes_home() / "profiles" / profile,
                created_by=_text(request.get("createdBy"), "created_by").lower(),
                tenant=tenant,
                workspace_kind="scratch",
                project_id="",
                idempotency_key=f"magentic:{run_id}:root",
                model_override=model,
                provider_override=provider,
                allowed_assignees=[profile],
                initial_status="blocked",
            )
        else:
            root_id = kanban_db.create_task(
                connection,
                title=title,
                body=body,
                assignee=profile,
                created_by=profile,
                tenant=tenant,
                workspace_kind="scratch",
                project_id="",
                idempotency_key=f"magentic:{run_id}:root",
                model_override=model,
                provider_override=provider,
                allowed_assignees=allowed_assignees,
                initial_status="blocked",
            )
            root = kanban_db.get_task(connection, root_id)
        if root is None:
            raise TaskGraphAdapterError("root_stage_failed")
        expected_allowed = [profile] if direct_team else allowed_assignees
        if (
            root.status != "blocked"
            or root.assignee != profile
            or root.tenant != tenant
            or root.provider_override != provider
            or root.model_override != model
            or root.body != body
            or list(root.allowed_assignees or []) != expected_allowed
        ):
            raise TaskGraphAdapterError("root_stage_readback_mismatch")
        _bind_authorities(connection, kanban_db, root.id, request.get("workerAuthorities"))
        return {"ok": True, "root": _task_projection(root), "directTeam": direct_team}


def activate_root(request: dict[str, Any]) -> dict[str, Any]:
    db_path, kanban_db, connect = _store()
    root_id = _text(request.get("rootId"), "root_id")
    direct_team = request.get("directTeam") is True
    with connect.connect_closing(db_path) as connection:
        root = kanban_db.get_task(connection, root_id)
        if root is None:
            raise TaskGraphAdapterError("root_not_found")
        if root.status == "blocked":
            if direct_team:
                from hermes_cli.kanban_team import activate_staged_team_root

                activated = activate_staged_team_root(connection, root_id)
            else:
                activated, _reason = kanban_db.promote_task(
                    connection,
                    root_id,
                    actor="card_magentic",
                    reason="outer Magnetic Run authority bound",
                )
            if not activated:
                raise TaskGraphAdapterError("root_activation_failed")
        root = kanban_db.get_task(connection, root_id)
        accepted = {"triage", "todo", "ready", "running"} if direct_team else {"todo", "ready", "running"}
        if root is None or root.status not in accepted:
            raise TaskGraphAdapterError("root_activation_readback_invalid")
        return {"ok": True, "root": _task_projection(root)}


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
    children = _creator_children(connection)
    ordered = [root_id]
    seen = {root_id}
    cursor = 0
    while cursor < len(ordered):
        for task_id in children.get(ordered[cursor], []):
            if task_id not in seen:
                seen.add(task_id)
                ordered.append(task_id)
        cursor += 1
    return ordered


def _redacted_summary(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    from agent.redact import redact_sensitive_text

    result = redact_sensitive_text(value, force=True).strip()
    if len(result) <= MAX_SUMMARY_CHARS:
        return result or None
    return result[: MAX_SUMMARY_CHARS - 1] + "…"


def read_root(request: dict[str, Any]) -> dict[str, Any]:
    db_path, kanban_db, connect = _store()
    root_id = _text(request.get("rootId"), "root_id")
    with connect.connect_closing(db_path) as connection:
        root = kanban_db.get_task(connection, root_id)
        if root is None:
            raise TaskGraphAdapterError("root_not_found")
        task_ids = _execution_task_ids(connection, root_id)
        tasks = [kanban_db.get_task(connection, task_id) for task_id in task_ids]
        tasks = [task for task in tasks if task is not None]
        latest_root_run = kanban_db.latest_run(connection, root_id)
        rows = []
        for task in tasks:
            latest = kanban_db.latest_run(connection, task.id)
            rows.append({
                "taskId": task.id,
                "title": task.title,
                "assignee": task.assignee,
                "status": task.status,
                "dependencyIds": kanban_db.parent_ids(connection, task.id),
                "latestAttempt": ({
                    "runId": latest.id,
                    "status": latest.status,
                    "startedAt": latest.started_at,
                    "endedAt": latest.ended_at,
                } if latest is not None else None),
                "resultAvailable": bool(str(
                    kanban_db.latest_summary(connection, task.id) or task.result or ""
                ).strip()),
                "handoffSummary": _redacted_summary(
                    latest.summary if latest is not None else None
                ),
            })
        final_result = kanban_db.latest_summary(connection, root_id) or root.result
        return {
            "ok": True,
            "root": _task_projection(root),
            "rootRunId": latest_root_run.id if latest_root_run else None,
            "tasks": rows,
            "finalResult": str(final_result) if str(final_result or "").strip() else None,
        }


def dispatch(request: dict[str, Any]) -> dict[str, Any]:
    action = _text(request.get("action"), "action")
    handlers = {
        "validate_profiles": validate_profiles,
        "stage_root": stage_root,
        "activate_root": activate_root,
        "read_root": read_root,
    }
    handler = handlers.get(action)
    if handler is None:
        raise TaskGraphAdapterError("action_unsupported")
    return handler(request)


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        result = {"ok": False, "error": "request_too_large"}
    else:
        try:
            request = json.loads(raw.decode("utf-8"))
            if not isinstance(request, dict):
                raise TaskGraphAdapterError("request_invalid")
            result = dispatch(request)
        except (UnicodeDecodeError, json.JSONDecodeError, TaskGraphAdapterError) as error:
            result = {"ok": False, "error": str(error) or error.__class__.__name__}
        except Exception as error:
            result = {"ok": False, "error": f"internal:{error.__class__.__name__}"}
    encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_RESPONSE_BYTES:
        encoded = b'{"ok":false,"error":"response_too_large"}'
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.write(b"\n")
    return 0 if result.get("ok") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
