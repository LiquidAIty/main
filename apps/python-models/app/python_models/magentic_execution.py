"""Headless Hermes execution for the existing LiquidAIty Mag One bus."""

from __future__ import annotations

import json
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class MagenticExecutionError(RuntimeError):
    pass


def _required_text(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise MagenticExecutionError(f"{field}_required")
    return text


def _runtime_paths() -> tuple[Path, Path]:
    repository = Path(__file__).resolve().parents[4]
    hermes_root = repository / "Hermes"
    hermes_home = hermes_root / ".hermes"
    if not hermes_root.is_dir():
        raise MagenticExecutionError("magentic_hermes_runtime_missing")
    if str(hermes_root) not in sys.path:
        sys.path.insert(0, str(hermes_root))
    return hermes_root, hermes_home


@contextmanager
def _default_home_scope(hermes_home: Path) -> Iterator[None]:
    """Give Hermes profile APIs their repository root without cross-thread leakage."""
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    token = set_hermes_home_override(hermes_home)
    try:
        yield
    finally:
        reset_hermes_home_override(token)


def _native_model(provider: dict[str, Any], options: dict[str, Any]) -> tuple[str, str, str | None]:
    saved_provider = _required_text(provider.get("provider"), "magentic_provider")
    access_mode = _required_text(provider.get("accessMode"), "magentic_access_mode")
    model = _required_text(
        provider.get("providerModelId") or provider.get("modelKey")
        or options.get("providerModelId") or options.get("modelKey"),
        "magentic_model",
    )
    mapping = {
        ("openai", "chatgpt-account"): ("openai-codex", "codex_app_server"),
        ("openai", "openai-api"): ("openai", None),
        ("openrouter", "openrouter-api"): ("openrouter", None),
        ("local_openai_compatible", "openai-api"): ("local_openai_compatible", None),
    }
    resolved = mapping.get((saved_provider, access_mode))
    if resolved is None:
        raise MagenticExecutionError(
            f"magentic_provider_binding_unsupported:{saved_provider}:{access_mode}"
        )
    return resolved[0], model, resolved[1]


def _ensure_orchestrator_identity(
    spec: dict[str, Any], workers: list[dict[str, Any]],
) -> tuple[str, str, str, str | None]:
    native_identity = _required_text(spec.get("nativeIdentity"), "magentic_native_identity").lower()
    instructions = _required_text(spec.get("instructions"), "magentic_instructions")
    provider = spec.get("provider") if isinstance(spec.get("provider"), dict) else {}
    options = spec.get("runtimeOptions") if isinstance(spec.get("runtimeOptions"), dict) else {}
    native_provider, model, openai_runtime = _native_model(provider, options)
    _, hermes_home = _runtime_paths()

    with _default_home_scope(hermes_home):
        from hermes_cli.profiles import normalize_profile_name, validate_profile_name
        from hermes_constants import named_profile_is_live

        def profile_home(name: str) -> Path | None:
            canonical = normalize_profile_name(name)
            try:
                validate_profile_name(canonical)
            except ValueError:
                return None
            candidate = hermes_home if canonical == "default" else hermes_home / "profiles" / canonical
            if canonical == "default":
                return candidate if candidate.is_dir() else None
            return candidate if named_profile_is_live(candidate) else None

        orchestrator_home = profile_home(native_identity)
        if orchestrator_home is None:
            raise MagenticExecutionError(
                f"magentic_orchestrator_native_identity_missing:{native_identity}"
            )
        missing = [
            _required_text(worker.get("profile"), "magentic_worker_identity")
            for worker in workers
            if profile_home(_required_text(worker.get("profile"), "magentic_worker_identity")) is None
        ]
        if missing:
            raise MagenticExecutionError(
                f"magentic_worker_native_identity_missing:{','.join(missing)}"
            )

        from hermes_constants import reset_hermes_home_override, set_hermes_home_override
        from hermes_cli.config import load_config

        token = set_hermes_home_override(orchestrator_home)
        try:
            config = load_config() or {}
            model_config = config.get("model") or {}
            agent_config = config.get("agent") or {}
            if (
                model_config.get("provider") != native_provider
                or model_config.get("default") != model
                or agent_config.get("system_prompt") != instructions
            ):
                raise MagenticExecutionError("magentic_orchestrator_materialization_mismatch")
        finally:
            reset_hermes_home_override(token)
    return native_identity, native_provider, model, openai_runtime


def _task_db_path() -> Path:
    _, hermes_home = _runtime_paths()
    return hermes_home / "kanban.db"


def _worker_scope(workers: list[dict[str, Any]]) -> tuple[list[str], str]:
    identities: list[str] = []
    lines: list[str] = []
    seen: set[str] = set()
    for worker in workers:
        card_id = _required_text(worker.get("cardId"), "magentic_worker_card")
        revision_id = _required_text(worker.get("cardRevisionId"), "magentic_worker_revision")
        identity = _required_text(worker.get("profile"), "magentic_worker_identity").lower()
        if identity in seen:
            raise MagenticExecutionError(f"magentic_worker_identity_duplicate:{identity}")
        seen.add(identity)
        identities.append(identity)
        title = str(worker.get("title") or card_id).strip()
        description = str(worker.get("description") or "").strip()
        capability = f"; {description}" if description else ""
        lines.append(
            f"- {identity}: Card {card_id} revision {revision_id}; "
            f"{title}{capability}"
        )
    if not identities:
        raise MagenticExecutionError("magentic_runtime_no_connected_participants")
    return identities, "\n".join(lines)


def _root_body(mission: str, worker_text: str) -> str:
    return (
        "You are the saved Magnetic orchestrator for this Mag One mission. This native task is "
        "both the orchestration root and the final result task.\n\n"
        "Available top-level worker Agents (the complete Mag One assignment scope):\n"
        f"{worker_text}\n\n"
        "Use only the listed saved profiles, and only when their work helps answer the mission. "
        "Do not discover, infer, create, or substitute another worker profile. Do not use "
        "auto-decomposition, triage, goal mode, delegate_task, or a separate synthesis task.\n\n"
        "For each useful worker assignment, create one native task with initial_status=\"running\" "
        "and an assignee from the list above. The task body must contain the bounded work request "
        "and require that saved worker to return its result directly through kanban_complete. Link "
        "each result needed for your next decision as a parent of THIS root task with kanban_link. "
        "Then end this attempt with kanban_block(kind=\"dependency\"); Hermes will keep this same "
        "root queued and promote it when those parents complete.\n\n"
        "Whenever Hermes runs this root again, inspect the parent handoffs already included in the "
        "native worker context. Decide whether another bounded worker round is useful. If so, create "
        "and link that round and dependency-block this same root again. When the evidence is enough, "
        "answer the original user directly and call kanban_complete on THIS root with the final answer "
        "as its summary. Never complete an intermediate decomposition and never create another task "
        "for final synthesis.\n\n"
        "Mission and selected context:\n"
        f"{mission}"
    )


def submit_magentic_execution(payload: dict[str, Any]) -> dict[str, Any]:
    run_id = _required_text(payload.get("runId"), "run_id")
    project_id = _required_text(payload.get("projectId"), "project_id")
    deck_id = _required_text(payload.get("deckId"), "deck_id")
    spec = payload.get("orchestrator")
    workers = payload.get("workers")
    input_file = payload.get("inputFile")
    notify_session = payload.get("notifySession")
    if not isinstance(spec, dict) or not isinstance(workers, list) or not isinstance(input_file, dict):
        raise MagenticExecutionError("magentic_execution_contract_invalid")
    if notify_session is not None and not isinstance(notify_session, dict):
        raise MagenticExecutionError("magentic_notification_session_invalid")
    from app.python_models.idf import load_idf, runtime_projection

    materialized = load_idf(
        input_file,
        project_id=project_id,
        deck_id=deck_id,
        run_id=run_id,
        card_id=_required_text(spec.get("cardId"), "magentic_card_id"),
    )
    mission = _required_text(
        runtime_projection(materialized).get("kanbanMission"),
        "magentic_mission",
    )
    if payload.get("mission") != mission:
        raise MagenticExecutionError("magentic_mission_input_mismatch")
    worker_identities, worker_text = _worker_scope(workers)
    native_identity, native_provider, native_model, openai_runtime = (
        _ensure_orchestrator_identity(spec, workers)
    )
    allowed_assignees = [native_identity, *worker_identities]
    tenant = f"mag-one:{run_id}"
    notify_session_key = (
        _required_text(notify_session.get("sessionKey"), "magentic_notification_session_key")
        if isinstance(notify_session, dict) else None
    )
    notify_profile = (
        _required_text(notify_session.get("profile"), "magentic_notification_profile")
        if isinstance(notify_session, dict) else None
    )

    from hermes_cli import kanban_db as task_db
    from hermes_cli import kanban_db_connect as task_db_connect

    db_path = _task_db_path()
    task_db_connect.init_db(db_path)
    root_body = _root_body(mission, worker_text)
    with task_db_connect.connect_closing(db_path) as connection:
        native_root_id = task_db.create_task(
            connection,
            title=f"Mag One {run_id}"[:200],
            body=root_body,
            assignee=native_identity,
            created_by=native_identity,
            tenant=tenant,
            workspace_kind="scratch",
            project_id="",
            idempotency_key=f"magentic:{run_id}:root",
            model_override=native_model,
            provider_override=native_provider,
            allowed_assignees=allowed_assignees,
            session_id=notify_session_key,
        )
        root = task_db.get_task(connection, native_root_id)
        if (
            root is None
            or root.allowed_assignees != allowed_assignees
            or root.assignee != native_identity
            or root.tenant != tenant
            or root.model_override != native_model
            or root.provider_override != native_provider
            or root.body != root_body
        ):
            raise MagenticExecutionError("magentic_native_root_readback_mismatch")
        if notify_session_key:
            from hermes_cli import kanban_db_notify

            kanban_db_notify.add_notify_sub(
                connection,
                task_id=native_root_id,
                platform="tui",
                chat_id=notify_session_key,
                notifier_profile=notify_profile,
            )
    return {
        "ok": True,
        "runId": run_id,
        "nativeRootId": native_root_id,
        "nativeIdentity": native_identity,
        "effectiveProvider": native_provider,
        "providerApiMode": openai_runtime,
        "model": native_model,
        "tenant": tenant,
        "state": root.status,
        "nativeNotification": bool(notify_session_key),
    }


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


def read_magentic_execution(payload: dict[str, Any]) -> dict[str, Any]:
    root_id = _required_text(payload.get("nativeRootId"), "native_root_id")
    from hermes_cli import kanban_db as task_db
    from hermes_cli import kanban_db_connect as task_db_connect

    with task_db_connect.connect_closing(_task_db_path()) as connection:
        root = task_db.get_task(connection, root_id)
        if root is None:
            raise MagenticExecutionError("magentic_native_root_not_found")
        task_ids = _execution_task_ids(connection, root_id)
        tasks = [task_db.get_task(connection, task_id) for task_id in task_ids]
        tasks = [task for task in tasks if task is not None]
        blocked = [task for task in tasks if task.status in {"blocked", "triage"}]
        latest_root_run = task_db.latest_run(connection, root_id)
        response: dict[str, Any] = {
            "ok": True,
            "nativeRootId": root_id,
            "state": "working",
            "nativePhase": "queued" if root.status == "ready" else "working",
            "nativeIdentity": root.assignee,
            "effectiveProvider": root.provider_override,
            "providerApiMode": (
                "codex_app_server" if root.provider_override == "openai-codex" else None
            ),
            "model": root.model_override,
            "nativeRunId": latest_root_run.id if latest_root_run else None,
        }
        if any(task.status == "archived" for task in tasks):
            return {**response, "state": "cancelled", "nativePhase": "cancelled"}
        if blocked:
            return {
                **response,
                "state": "blocked",
                "nativePhase": "blocked",
                "error": f"magentic_task_blocked:{blocked[0].id}",
            }
        if root.status != "done":
            return response
        final_result = task_db.latest_summary(connection, root_id) or root.result
        if not str(final_result or "").strip():
            return {
                **response,
                "state": "failed",
                "nativePhase": "failed",
                "error": "magentic_final_result_missing",
            }
        return {
            **response,
            "state": "completed",
            "nativePhase": "complete",
            "finalResult": str(final_result),
        }


def stop_magentic_execution(payload: dict[str, Any]) -> dict[str, Any]:
    root_id = _required_text(payload.get("nativeRootId"), "native_root_id")
    from hermes_cli import kanban_db as task_db
    from hermes_cli import kanban_db_connect as task_db_connect

    with task_db_connect.connect_closing(_task_db_path()) as connection:
        if task_db.get_task(connection, root_id) is None:
            raise MagenticExecutionError("magentic_native_root_not_found")
        task_ids = _execution_task_ids(connection, root_id)
        for task_id in reversed(task_ids):
            task_db.archive_task(connection, task_id)
    return {
        "ok": True,
        "nativeRootId": root_id,
        "state": "cancelled",
        "nativePhase": "cancelled",
    }
