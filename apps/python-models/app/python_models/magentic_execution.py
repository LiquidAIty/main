"""Headless Hermes execution for the existing LiquidAIty Mag One bus."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class MagenticExecutionError(RuntimeError):
    pass


_TEAM_CARD_ID = "card_team"
_MAX_HANDOFF_SUMMARY_CHARS = 2_000
_MAX_TOOL_RECEIPTS = 64
_MAX_TOOL_RESULT_PREVIEW_CHARS = 1_000
_MAX_NATIVE_ID_CHARS = 512
_WORKER_TOOL_AUTH_MAX_PAYLOAD_BYTES = 512 * 1024
_WORKER_TOOL_AUTH_TTL_SECONDS = 300
_WORKER_TOOL_AUTH_MAX_PROFILE_CHARS = 128
_WORKER_TOOL_AUTH_MAX_TOOL_CHARS = 128
_WORKER_TOOL_AUTH_MAX_RUN_ID = (1 << 63) - 1
_EXECUTION_RECEIPT_SCHEMA = "agent-runtime.execution-receipt.v1"
_MAX_EXECUTION_RECEIPT_CORRELATION_CHARS = 512
_LOWER_HEX_64_RE = re.compile(r"^[a-f0-9]{64}$", re.ASCII)
_LOWER_HEX_32_RE = re.compile(r"^[a-f0-9]{32}$", re.ASCII)
_TASK_ID_RE = re.compile(r"^t_[A-Za-z0-9_-]+$", re.ASCII)
_NATIVE_AUTHORITY_EVENT = "card_authority_bound"


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
    instructions = spec.get("instructions")
    if not isinstance(instructions, str) or not instructions.strip():
        raise MagenticExecutionError("magentic_instructions_required")
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
            soul_path = orchestrator_home / "SOUL.md"
            try:
                soul = soul_path.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                soul = None
            if (
                model_config.get("provider") != native_provider
                or model_config.get("default") != model
                or "system_prompt" in agent_config
                or soul != instructions
            ):
                raise MagenticExecutionError("magentic_orchestrator_materialization_mismatch")
        finally:
            reset_hermes_home_override(token)
    return native_identity, native_provider, model, openai_runtime


def _task_db_path() -> Path:
    _, hermes_home = _runtime_paths()
    return hermes_home / "kanban.db"


def _task_store() -> tuple[Path, Any, Any]:
    """Resolve the repository Hermes path before importing its task modules."""
    db_path = _task_db_path()
    from hermes_cli import kanban_db as task_db
    from hermes_cli import kanban_db_connect as task_db_connect

    return db_path, task_db, task_db_connect


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


def _direct_team_worker(workers: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the sole Team worker, while rejecting a mismatched structural marker."""

    for worker in workers:
        card_id = _required_text(worker.get("cardId"), "magentic_worker_card")
        marked_team = worker.get("teamTaskMode") is True
        if marked_team != (card_id == _TEAM_CARD_ID):
            raise MagenticExecutionError(f"magentic_team_identity_invalid:{card_id}")
    if len(workers) == 1 and workers[0].get("cardId") == _TEAM_CARD_ID:
        return workers[0]
    return None


def _worker_authorities(
    workers: list[dict[str, Any]], value: Any,
) -> list[dict[str, str]]:
    if not isinstance(value, list) or len(value) != len(workers):
        raise MagenticExecutionError("magentic_worker_authorities_invalid")
    authorities: list[dict[str, str]] = []
    seen: set[str] = set()
    expected_keys = {
        "cardId", "cardRevisionId", "profile", "configurationFingerprint",
    }
    for worker, candidate in zip(workers, value, strict=True):
        if not isinstance(candidate, dict) or set(candidate) != expected_keys:
            raise MagenticExecutionError("magentic_worker_authorities_invalid")
        authority = {
            "cardId": _required_text(candidate.get("cardId"), "magentic_authority_card"),
            "cardRevisionId": _required_text(
                candidate.get("cardRevisionId"), "magentic_authority_revision",
            ),
            "profile": _required_text(
                candidate.get("profile"), "magentic_authority_profile",
            ).lower(),
            "configurationFingerprint": _required_text(
                candidate.get("configurationFingerprint"),
                "magentic_authority_configuration_fingerprint",
            ),
        }
        if (
            authority["cardId"] != _required_text(worker.get("cardId"), "magentic_worker_card")
            or authority["cardRevisionId"] != _required_text(
                worker.get("cardRevisionId"), "magentic_worker_revision",
            )
            or authority["profile"] != _required_text(
                worker.get("profile"), "magentic_worker_identity",
            ).lower()
            or not _LOWER_HEX_64_RE.fullmatch(authority["configurationFingerprint"])
            or authority["profile"] in seen
        ):
            raise MagenticExecutionError("magentic_worker_authorities_invalid")
        seen.add(authority["profile"])
        authorities.append(authority)
    return authorities


def _bind_native_worker_authorities(
    connection: Any,
    task_db: Any,
    root_id: str,
    authorities: list[dict[str, str]],
) -> None:
    expected = {"workers": authorities}
    with task_db.write_txn(connection):
        rows = connection.execute(
            "SELECT payload FROM task_events WHERE task_id = ? AND kind = ? ORDER BY id",
            (root_id, _NATIVE_AUTHORITY_EVENT),
        ).fetchall()
        if not rows:
            task_db._append_event(connection, root_id, _NATIVE_AUTHORITY_EVENT, expected)
            return
        if (
            len(rows) != 1
            or not isinstance(rows[0]["payload"], str)
            or _strict_json_object(rows[0]["payload"]) != expected
        ):
            raise MagenticExecutionError("magentic_worker_authority_binding_mismatch")


def _root_body(mission: str, worker_text: str) -> str:
    return (
        "You are the saved Magnetic orchestrator for this Mag One mission. This native task is "
        "both the orchestration root and the final result task.\n\n"
        "Main and the user already approved this mission after upstream context engineering. "
        "Execute this mission as given; do not invent a replacement mission or another approval step.\n\n"
        "Available top-level worker Agents (the complete Mag One assignment scope):\n"
        f"{worker_text}\n\n"
        "Use only the listed saved profiles, and only when their work helps answer the mission. "
        "Do not discover, infer, create, or substitute another worker profile. Do not use "
        "auto-decomposition, triage, goal mode, delegate_task, or a separate synthesis task.\n\n"
        "For each useful worker assignment, create one native task with initial_status=\"running\" "
        "and an assignee from the list above. The task body must contain the bounded work request "
        "and require that saved worker to return its result directly through kanban_complete. "
        "Launch useful worker tasks independently; never make one worker wait for another. "
        "Hermes stores that new task as ready until its dispatcher claims it; do not describe it as "
        "running before that claim. Link "
        "each result needed for your next decision as a parent of THIS root task with kanban_link. "
        "Then end this attempt with kanban_block(kind=\"dependency\"); Hermes will keep this same "
        "root in todo while those parents are unfinished, then promote it to ready.\n\n"
        "Whenever Hermes runs this root again, inspect the parent handoffs already included in the "
        "native worker context. Decide whether another bounded worker round is useful. If so, create "
        "and link that round and dependency-block this same root again. When the evidence is enough, "
        "answer the original user directly and call kanban_complete on THIS root with the final answer "
        "as its summary. Never complete an intermediate decomposition and never create another task "
        "for final synthesis.\n\n"
        "Mission and selected context:\n"
        f"{mission}"
    )


def _bind_outer_magentic_run(
    run_id: str, native_root_id: str, native_status: str,
) -> dict[str, Any]:
    """Bind the outer PostgreSQL Run before the native root becomes dispatchable."""

    from app.python_models.card_domain import update_run_progress

    result = update_run_progress({
        "runId": run_id,
        "nativeRootId": native_root_id,
        "nativeStatus": native_status,
    })
    if (
        not isinstance(result, dict)
        or result.get("ok") is not True
        or result.get("runId") != run_id
        or result.get("nativeRootId") != native_root_id
        or result.get("updated") is not True
    ):
        raise MagenticExecutionError("magentic_outer_run_binding_failed")
    return result


def submit_magentic_execution(payload: dict[str, Any]) -> dict[str, Any]:
    run_id = _required_text(payload.get("runId"), "run_id")
    project_id = _required_text(payload.get("projectId"), "project_id")
    deck_id = _required_text(payload.get("deckId"), "deck_id")
    spec = payload.get("orchestrator")
    workers = payload.get("workers")
    raw_worker_authorities = payload.get("workerAuthorities")
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
    worker_authorities = _worker_authorities(workers, raw_worker_authorities)
    direct_team = _direct_team_worker(workers)
    tenant = f"mag-one:{run_id}"
    notify_session_key = (
        _required_text(notify_session.get("sessionKey"), "magentic_notification_session_key")
        if isinstance(notify_session, dict) else None
    )
    notify_profile = (
        _required_text(notify_session.get("profile"), "magentic_notification_profile")
        if isinstance(notify_session, dict) else None
    )

    db_path, task_db, task_db_connect = _task_store()
    task_db_connect.init_db(db_path)
    _, hermes_home = _runtime_paths()
    with task_db_connect.connect_closing(db_path) as connection:
        if direct_team is not None:
            team_provider = (
                direct_team.get("provider")
                if isinstance(direct_team.get("provider"), dict) else {}
            )
            team_options = (
                direct_team.get("runtimeOptions")
                if isinstance(direct_team.get("runtimeOptions"), dict) else {}
            )
            native_identity = worker_identities[0]
            native_provider, native_model, openai_runtime = _native_model(
                team_provider, team_options,
            )
        else:
            native_identity, native_provider, native_model, openai_runtime = (
                _ensure_orchestrator_identity(spec, workers)
            )
            allowed_assignees = [native_identity, *worker_identities]
            root_body = _root_body(mission, worker_text)

        native_root_id = ""
        try:
            if direct_team is not None:
                try:
                    with _default_home_scope(hermes_home):
                        from hermes_cli.kanban_team import create_team_root

                        root = create_team_root(
                            connection,
                            title=f"Team {run_id}"[:200],
                            body=mission,
                            assignee=native_identity,
                            profile_home=hermes_home / "profiles" / native_identity,
                            created_by=_required_text(
                                spec.get("nativeIdentity"), "magentic_native_identity",
                            ).lower(),
                            tenant=tenant,
                            workspace_kind="scratch",
                            project_id="",
                            idempotency_key=f"magentic:{run_id}:root",
                            model_override=native_model,
                            provider_override=native_provider,
                            allowed_assignees=[native_identity],
                            session_id=notify_session_key,
                            initial_status="blocked",
                        )
                except (RuntimeError, ValueError) as error:
                    raise MagenticExecutionError(
                        f"magentic_team_root_invalid:{error}"
                    ) from error
                native_root_id = root.id
            else:
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
                    initial_status="blocked",
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
            _bind_native_worker_authorities(
                connection, task_db, native_root_id, worker_authorities,
            )
            _bind_outer_magentic_run(run_id, native_root_id, root.status)

            if notify_session_key:
                from hermes_cli import kanban_db_notify

                kanban_db_notify.add_notify_sub(
                    connection,
                    task_id=native_root_id,
                    platform="tui",
                    chat_id=notify_session_key,
                    notifier_profile=notify_profile,
                )
            if root.status == "blocked":
                if direct_team is not None:
                    from hermes_cli.kanban_team import activate_staged_team_root

                    activated = activate_staged_team_root(connection, native_root_id)
                else:
                    activated, _reason = task_db.promote_task(
                        connection,
                        native_root_id,
                        actor="card_magentic",
                        reason="outer Magnetic Run authority bound",
                    )
                if not activated:
                    raise MagenticExecutionError("magentic_native_root_activation_failed")
            root = task_db.get_task(connection, native_root_id)
            accepted_statuses = (
                {"triage", "todo", "ready", "running"}
                if direct_team is not None else {"todo", "ready", "running"}
            )
            if root is None or root.status not in accepted_statuses:
                raise MagenticExecutionError("magentic_native_root_activation_failed")
        except Exception:
            # A failed cross-store bind leaves the exact idempotent root blocked
            # and therefore unclaimable. Never delete here: another submit may
            # have created or bound this same native root concurrently.
            raise
    return {
        "ok": True,
        "runId": run_id,
        "nativeRootId": native_root_id,
        "nativeIdentity": native_identity,
        "effectiveProvider": native_provider,
        "providerApiMode": openai_runtime,
        "model": native_model,
        "tenant": tenant,
        "state": "running",
        "nativeStatus": root.status,
        "nativeNotification": bool(notify_session_key),
        "outerRunBound": True,
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


def _worker_tool_auth_failed() -> None:
    raise MagenticExecutionError("magentic_worker_tool_authentication_failed")


def _strict_json_object(raw: str) -> dict[str, Any]:
    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate key")
            value[key] = item
        return value

    try:
        parsed = json.loads(
            raw,
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError("invalid constant")),
        )
    except (TypeError, ValueError, RecursionError):
        _worker_tool_auth_failed()
    if not isinstance(parsed, dict):
        _worker_tool_auth_failed()
    return parsed


def _native_creation_authority(connection: Any, task_id: str) -> dict[str, Any]:
    rows = connection.execute(
        "SELECT payload FROM task_events WHERE task_id = ? AND kind = 'created' ORDER BY id",
        (task_id,),
    ).fetchall()
    if len(rows) != 1 or not isinstance(rows[0]["payload"], str):
        _worker_tool_auth_failed()
    return _strict_json_object(rows[0]["payload"])


def _exact_bounded_string(value: Any, limit: int) -> str | None:
    if not isinstance(value, str) or value != value.strip():
        return None
    if not value or len(value) > limit or not value.isprintable():
        return None
    return value


def _native_lineage_for_source(
    connection: Any, task_db: Any, source_task_id: str,
) -> tuple[Any, list[Any], list[dict[str, Any]]]:
    """Follow only this task's immutable native creator receipts back to its root."""

    lineage: list[Any] = []
    creations: list[dict[str, Any]] = []
    current_id = source_task_id
    seen: set[str] = set()
    while True:
        if not _TASK_ID_RE.fullmatch(current_id) or current_id in seen:
            _worker_tool_auth_failed()
        seen.add(current_id)
        task = task_db.get_task(connection, current_id)
        if task is None:
            _worker_tool_auth_failed()
        creation = _native_creation_authority(connection, current_id)
        lineage.append(task)
        creations.append(creation)
        creator = creation.get("creator_task_id")
        if creator is None:
            break
        creator_id = _exact_bounded_string(creator, _MAX_NATIVE_ID_CHARS)
        if creator_id is None or not _TASK_ID_RE.fullmatch(creator_id):
            _worker_tool_auth_failed()
        current_id = creator_id
    lineage.reverse()
    creations.reverse()
    return lineage[0], lineage, creations


def _native_team_decomposition(
    connection: Any, root_id: str,
) -> tuple[list[str], str]:
    rows = connection.execute(
        "SELECT payload FROM task_events "
        "WHERE task_id = ? AND kind = 'decomposed' ORDER BY id",
        (root_id,),
    ).fetchall()
    if len(rows) != 1 or not isinstance(rows[0]["payload"], str):
        _worker_tool_auth_failed()
    payload = _strict_json_object(rows[0]["payload"])
    child_ids = payload.get("child_ids")
    root_assignee = _exact_bounded_string(
        payload.get("root_assignee"), _WORKER_TOOL_AUTH_MAX_PROFILE_CHARS,
    )
    if (
        not isinstance(child_ids, list)
        or not child_ids
        or len(set(child_ids)) != len(child_ids)
        or any(
            not isinstance(child_id, str) or not _TASK_ID_RE.fullmatch(child_id)
            for child_id in child_ids
        )
        or root_assignee is None
    ):
        _worker_tool_auth_failed()
    return child_ids, root_assignee


def _native_worker_authority(
    connection: Any, root_id: str, authority_profile: str,
) -> dict[str, str]:
    rows = connection.execute(
        "SELECT payload FROM task_events WHERE task_id = ? AND kind = ? ORDER BY id",
        (root_id, _NATIVE_AUTHORITY_EVENT),
    ).fetchall()
    if len(rows) != 1 or not isinstance(rows[0]["payload"], str):
        _worker_tool_auth_failed()
    payload = _strict_json_object(rows[0]["payload"])
    workers = payload.get("workers")
    if set(payload) != {"workers"} or not isinstance(workers, list) or not workers:
        _worker_tool_auth_failed()
    matches: list[dict[str, str]] = []
    seen: set[str] = set()
    expected_keys = {
        "cardId", "cardRevisionId", "profile", "configurationFingerprint",
    }
    for candidate in workers:
        if not isinstance(candidate, dict) or set(candidate) != expected_keys:
            _worker_tool_auth_failed()
        card_id = _exact_bounded_string(candidate.get("cardId"), _MAX_NATIVE_ID_CHARS)
        revision_id = _exact_bounded_string(
            candidate.get("cardRevisionId"), _MAX_NATIVE_ID_CHARS,
        )
        profile = _exact_bounded_string(
            candidate.get("profile"), _WORKER_TOOL_AUTH_MAX_PROFILE_CHARS,
        )
        fingerprint = candidate.get("configurationFingerprint")
        if (
            card_id is None
            or revision_id is None
            or profile is None
            or profile in seen
            or not isinstance(fingerprint, str)
            or not _LOWER_HEX_64_RE.fullmatch(fingerprint)
        ):
            _worker_tool_auth_failed()
        seen.add(profile)
        if profile == authority_profile:
            matches.append({
                "cardId": card_id,
                "cardRevisionId": revision_id,
                "profile": profile,
                "configurationFingerprint": fingerprint,
            })
    if len(matches) != 1:
        _worker_tool_auth_failed()
    return matches[0]


def _validate_standard_native_child(
    task: Any,
    creation: dict[str, Any],
    *,
    parent_id: str,
    root_tenant: str,
) -> str:
    assignee = _exact_bounded_string(
        task.assignee, _WORKER_TOOL_AUTH_MAX_PROFILE_CHARS,
    )
    if (
        assignee is None
        or task.tenant != root_tenant
        or task.allowed_assignees != [assignee]
        or creation.get("creator_task_id") != parent_id
        or creation.get("assignee") != assignee
        or creation.get("tenant") != root_tenant
        or creation.get("allowed_assignees") != [assignee]
        or creation.get("workflow_template_id") != task.workflow_template_id
        or creation.get("current_step_key") != task.current_step_key
    ):
        _worker_tool_auth_failed()
    return assignee


def _read_outer_magentic_run(outer_run_id: str) -> dict[str, Any] | None:
    from psycopg.rows import dict_row

    from app.python_models.postgres import connect_postgres

    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute(
                """
                SELECT run.run_id,
                       run.project_id::text AS project_id,
                       run.deck_id,
                       run.state,
                       run.runtime_kind,
                       run.runtime_mode,
                       run.provider_thread_ref,
                       revision.card_id,
                       revision.runtime_profile
                FROM ag_catalog.agent_runs AS run
                JOIN ag_catalog.agent_card_revisions AS revision
                  ON revision.revision_id=run.target_card_revision_id
                WHERE run.run_id=%s
                LIMIT 1
                """,
                (outer_run_id,),
            )
            row = cursor.fetchone()
    return dict(row) if row is not None else None


def authenticate_magentic_worker_tool_request(envelope: dict[str, Any]) -> dict[str, Any]:
    """Verify one v2 Card-tool request against its live native worker claim."""

    if not isinstance(envelope, dict) or set(envelope) != {"keyId", "payload", "signature"}:
        _worker_tool_auth_failed()
    key_id = envelope.get("keyId")
    raw_payload = envelope.get("payload")
    signature = envelope.get("signature")
    if (
        not isinstance(key_id, str)
        or not _LOWER_HEX_64_RE.fullmatch(key_id)
        or not isinstance(signature, str)
        or not _LOWER_HEX_64_RE.fullmatch(signature)
        or not isinstance(raw_payload, str)
        or not raw_payload
        or len(raw_payload.encode("utf-8")) > _WORKER_TOOL_AUTH_MAX_PAYLOAD_BYTES
    ):
        _worker_tool_auth_failed()

    payload = _strict_json_object(raw_payload)
    if set(payload) != {
        "version", "expiresAt", "nonce", "sourceTaskId", "sourceTaskRunId",
        "sourceProfile", "tool", "arguments",
    }:
        _worker_tool_auth_failed()
    version = payload.get("version")
    expires_at = payload.get("expiresAt")
    nonce = payload.get("nonce")
    source_task_id = _exact_bounded_string(payload.get("sourceTaskId"), _MAX_NATIVE_ID_CHARS)
    source_task_run_id = payload.get("sourceTaskRunId")
    source_profile = _exact_bounded_string(
        payload.get("sourceProfile"), _WORKER_TOOL_AUTH_MAX_PROFILE_CHARS,
    )
    tool = _exact_bounded_string(payload.get("tool"), _WORKER_TOOL_AUTH_MAX_TOOL_CHARS)
    arguments = payload.get("arguments")
    now = int(time.time())
    if (
        type(version) is not int or version != 2
        or type(expires_at) is not int
        or expires_at <= now
        or expires_at > now + _WORKER_TOOL_AUTH_TTL_SECONDS
        or not isinstance(nonce, str)
        or not _LOWER_HEX_32_RE.fullmatch(nonce)
        or source_task_id is None
        or not _TASK_ID_RE.fullmatch(source_task_id)
        or type(source_task_run_id) is not int
        or source_task_run_id < 1
        or source_task_run_id > _WORKER_TOOL_AUTH_MAX_RUN_ID
        or source_profile is None
        or tool is None
        or not isinstance(arguments, dict)
    ):
        _worker_tool_auth_failed()

    db_path, task_db, task_db_connect = _task_store()
    try:
        with task_db_connect.connect_closing(db_path) as connection:
            connection.execute("BEGIN")
            source_task = task_db.get_task(connection, source_task_id)
            if (
                source_task is None
                or source_task.status != "running"
                or source_task.current_run_id != source_task_run_id
                or source_task.assignee != source_profile
                or source_task.allowed_assignees != [source_profile]
                or not isinstance(source_task.claim_lock, str)
                or not source_task.claim_lock
                or type(source_task.claim_expires) is not int
                or source_task.claim_expires <= now
            ):
                _worker_tool_auth_failed()
            source_run = task_db.get_run(connection, source_task_run_id)
            if (
                source_run is None
                or source_run.task_id != source_task_id
                or source_run.status != "running"
                or source_run.profile != source_profile
                or source_run.claim_lock != source_task.claim_lock
                or source_run.step_key != source_task.current_step_key
                or type(source_run.claim_expires) is not int
                or source_run.claim_expires <= now
                or source_run.claim_expires != source_task.claim_expires
            ):
                _worker_tool_auth_failed()

            secret = source_task.claim_lock.encode("utf-8")
            expected_key_id = hashlib.sha256(secret).hexdigest()
            expected_signature = hmac.new(
                secret, raw_payload.encode("utf-8"), hashlib.sha256,
            ).hexdigest()
            key_matches = hmac.compare_digest(key_id, expected_key_id)
            signature_matches = hmac.compare_digest(signature, expected_signature)
            if not (key_matches and signature_matches):
                _worker_tool_auth_failed()

            root, lineage, creations = _native_lineage_for_source(
                connection, task_db, source_task_id,
            )
            allowed_assignees = root.allowed_assignees
            root_creation = _native_creation_authority(connection, root.id)
            if (
                not isinstance(allowed_assignees, list)
                or not allowed_assignees
                or len(set(allowed_assignees)) != len(allowed_assignees)
                or any(
                    _exact_bounded_string(item, _WORKER_TOOL_AUTH_MAX_PROFILE_CHARS) is None
                    for item in allowed_assignees
                )
                or source_task.tenant != root.tenant
                or root.status not in {"todo", "ready", "running"}
                or root_creation.get("creator_task_id") is not None
                or root_creation.get("assignee") != root.assignee
                or root_creation.get("tenant") != root.tenant
                or root_creation.get("allowed_assignees") != allowed_assignees
                or root_creation.get("workflow_template_id") != root.workflow_template_id
            ):
                _worker_tool_auth_failed()
            tenant = _exact_bounded_string(root.tenant, _MAX_NATIVE_ID_CHARS)
            if tenant is None or not tenant.startswith("mag-one:"):
                _worker_tool_auth_failed()
            outer_run_id = _exact_bounded_string(
                tenant.removeprefix("mag-one:"), _MAX_NATIVE_ID_CHARS,
            )
            if outer_run_id is None:
                _worker_tool_auth_failed()
            if root.idempotency_key != f"magentic:{outer_run_id}:root":
                _worker_tool_auth_failed()

            from hermes_cli.kanban_team import (
                TEAM_DECOMPOSITION_STEP,
                TEAM_SYNTHESIS_STEP,
                TEAM_WORKER_STEP,
                TEAM_WORKFLOW_ID,
            )

            if root.workflow_template_id == TEAM_WORKFLOW_ID:
                authority_profile = _exact_bounded_string(
                    root.assignee, _WORKER_TOOL_AUTH_MAX_PROFILE_CHARS,
                )
                if (
                    root.created_by != "card_magentic"
                    or authority_profile is None
                    or allowed_assignees != [authority_profile]
                    or root.current_step_key != TEAM_SYNTHESIS_STEP
                ):
                    _worker_tool_auth_failed()
                decomposed_ids, decomposition_assignee = _native_team_decomposition(
                    connection, root.id,
                )
                if decomposition_assignee != authority_profile:
                    _worker_tool_auth_failed()
                if len(lineage) > 1:
                    first_child = lineage[1]
                    first_creation = creations[1]
                    if (
                        first_child.id not in decomposed_ids
                        or first_child.tenant != tenant
                        or first_child.assignee != authority_profile
                        or first_child.allowed_assignees != [authority_profile]
                        or first_child.workflow_template_id != TEAM_WORKFLOW_ID
                        or first_child.current_step_key != TEAM_WORKER_STEP
                        or first_creation.get("creator_task_id") != root.id
                        or first_creation.get("from_decompose_of") != root.id
                        or first_creation.get("by") != first_child.created_by
                        or first_creation.get("allowed_assignees") != [authority_profile]
                    ):
                        _worker_tool_auth_failed()
                    for index in range(2, len(lineage)):
                        _validate_standard_native_child(
                            lineage[index], creations[index],
                            parent_id=lineage[index - 1].id,
                            root_tenant=tenant,
                        )
            else:
                if (
                    len(lineage) < 2
                    or root.created_by != "card_magentic"
                    or root.assignee != "card_magentic"
                    or allowed_assignees[0] != "card_magentic"
                ):
                    _worker_tool_auth_failed()
                authority_task = lineage[1]
                authority_creation = creations[1]
                authority_profile = _exact_bounded_string(
                    authority_task.assignee, _WORKER_TOOL_AUTH_MAX_PROFILE_CHARS,
                ) or ""
                if authority_task.workflow_template_id == TEAM_WORKFLOW_ID:
                    if (
                        not authority_profile
                        or authority_task.tenant != tenant
                        or authority_task.allowed_assignees != [authority_profile]
                        or authority_task.current_step_key != TEAM_SYNTHESIS_STEP
                        or authority_creation.get("creator_task_id") != root.id
                        or authority_creation.get("assignee") != authority_profile
                        or authority_creation.get("tenant") != tenant
                        or authority_creation.get("allowed_assignees") != [authority_profile]
                        or authority_creation.get("workflow_template_id") != TEAM_WORKFLOW_ID
                        or authority_creation.get("current_step_key") != TEAM_DECOMPOSITION_STEP
                    ):
                        _worker_tool_auth_failed()
                    decomposed_ids, decomposition_assignee = _native_team_decomposition(
                        connection, authority_task.id,
                    )
                    if decomposition_assignee != authority_profile:
                        _worker_tool_auth_failed()
                    if len(lineage) > 2:
                        first_child = lineage[2]
                        first_creation = creations[2]
                        if (
                            first_child.id not in decomposed_ids
                            or first_child.tenant != tenant
                            or first_child.assignee != authority_profile
                            or first_child.allowed_assignees != [authority_profile]
                            or first_child.workflow_template_id != TEAM_WORKFLOW_ID
                            or first_child.current_step_key != TEAM_WORKER_STEP
                            or first_creation.get("creator_task_id") != authority_task.id
                            or first_creation.get("from_decompose_of") != authority_task.id
                            or first_creation.get("by") != first_child.created_by
                            or first_creation.get("allowed_assignees") != [authority_profile]
                        ):
                            _worker_tool_auth_failed()
                        for index in range(3, len(lineage)):
                            _validate_standard_native_child(
                                lineage[index], creations[index],
                                parent_id=lineage[index - 1].id,
                                root_tenant=tenant,
                            )
                else:
                    for index in range(1, len(lineage)):
                        _validate_standard_native_child(
                            lineage[index], creations[index],
                            parent_id=lineage[index - 1].id,
                            root_tenant=tenant,
                        )
                if authority_profile not in allowed_assignees[1:]:
                    _worker_tool_auth_failed()
            authority = _native_worker_authority(
                connection, root.id, authority_profile,
            )
            native_root_id = root.id
    except MagenticExecutionError:
        raise
    except Exception:
        _worker_tool_auth_failed()

    try:
        outer_run = _read_outer_magentic_run(outer_run_id)
    except Exception:
        _worker_tool_auth_failed()
    if not isinstance(outer_run, dict):
        _worker_tool_auth_failed()
    project_id = _exact_bounded_string(outer_run.get("project_id"), _MAX_NATIVE_ID_CHARS)
    deck_id = _exact_bounded_string(outer_run.get("deck_id"), _MAX_NATIVE_ID_CHARS)
    if (
        project_id is None
        or deck_id is None
        or outer_run.get("run_id") != outer_run_id
        or outer_run.get("state") != "running"
        or outer_run.get("runtime_kind") != "hermes"
        or outer_run.get("runtime_mode") != "magentic_one"
        or outer_run.get("card_id") != "card_magentic"
        or outer_run.get("runtime_profile") != "card_magentic"
        or outer_run.get("provider_thread_ref") != native_root_id
    ):
        _worker_tool_auth_failed()
    return {
        "projectId": project_id,
        "deckId": deck_id,
        "outerRunId": outer_run_id,
        "nativeRootId": native_root_id,
        "sourceTaskId": source_task_id,
        "sourceTaskRunId": source_task_run_id,
        "sourceProfile": source_profile,
        "authorityProfile": authority_profile,
        "authorityCardId": authority["cardId"],
        "authorityCardRevisionId": authority["cardRevisionId"],
        "authorityConfigurationFingerprint": authority["configurationFingerprint"],
        "expiresAt": expires_at,
        "nonce": nonce,
        "tool": tool,
        "arguments": arguments,
    }


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


def _exact_native_id(value: Any) -> str | None:
    if not isinstance(value, str) or value != value.strip():
        return None
    if not value or len(value) > _MAX_NATIVE_ID_CHARS or not value.isprintable():
        return None
    return value


def _profile_home_for_assignee(assignee: Any) -> Path | None:
    identity = _exact_native_id(assignee)
    if identity is None:
        return None
    _, hermes_home = _runtime_paths()
    from hermes_cli.profiles import normalize_profile_name, validate_profile_name
    from hermes_constants import named_profile_is_live

    try:
        canonical = normalize_profile_name(identity)
        validate_profile_name(canonical)
    except ValueError:
        return None
    candidate = hermes_home if canonical == "default" else hermes_home / "profiles" / canonical
    if canonical == "default":
        return candidate if candidate.is_dir() and candidate.joinpath("state.db").is_file() else None
    return candidate if named_profile_is_live(candidate) else None


def _materialized_card_tool_mapping(profile_home: Path) -> dict[str, str] | None:
    """Read the exact materialized wire-to-canonical Card-tool map."""
    manifest = profile_home / "plugins" / "card-tools" / "tools.json"
    try:
        if not manifest.is_file() or manifest.stat().st_size > 2 * 1024 * 1024:
            return None

        def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            value: dict[str, Any] = {}
            for key, item in pairs:
                if key in value:
                    raise ValueError("duplicate key")
                value[key] = item
            return value

        raw = json.loads(
            manifest.read_text(encoding="utf-8"),
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError("invalid constant")),
        )
    except (OSError, UnicodeError, TypeError, ValueError, RecursionError):
        return None
    if not isinstance(raw, dict) or set(raw) != {"tools"}:
        return None
    tools = raw.get("tools")
    if not isinstance(tools, list) or len(tools) > 256:
        return None
    mapping: dict[str, str] = {}
    canonical_names: set[str] = set()
    for candidate in tools:
        if not isinstance(candidate, dict):
            return None
        wire_name = _exact_bounded_string(candidate.get("hermesName"), _MAX_NATIVE_ID_CHARS)
        canonical_name = _exact_bounded_string(
            candidate.get("canonicalName"), _WORKER_TOOL_AUTH_MAX_TOOL_CHARS,
        )
        if (
            wire_name is None
            or canonical_name is None
            or wire_name in mapping
            or canonical_name in canonical_names
        ):
            return None
        mapping[wire_name] = canonical_name
        canonical_names.add(canonical_name)
    return mapping


def _tool_result_state(
    call_id: str,
    message: dict[str, Any],
    execution_receipt: dict[str, str] | None = None,
) -> str | None:
    if execution_receipt is not None:
        return "returned" if execution_receipt["state"] == "completed" else "failed"
    metadata = message.get("display_metadata")
    if isinstance(metadata, dict) and isinstance(metadata.get("success"), bool):
        return "returned" if metadata["success"] else "failed"
    content = message.get("content")
    if isinstance(content, str):
        stripped = content.lstrip()
        if (
            stripped.startswith("[error]")
            or stripped.startswith("[exit ")
            or stripped.startswith("success=False")
            or stripped.startswith("apply_patch status=failed")
        ):
            return "failed"
        if stripped.startswith("success=True"):
            return "returned"
        if call_id.startswith("codex_exec_") or call_id.startswith("codex_mcp__"):
            return "returned"
        if call_id.startswith("codex_apply_patch_") and stripped.startswith(
            "apply_patch status=completed"
        ):
            return "returned"
    return None


def _tool_result_preview(content: Any) -> str | None:
    if content is None:
        return ""
    if isinstance(content, str):
        rendered = content
    elif isinstance(content, (dict, list, int, float, bool)):
        try:
            rendered = json.dumps(content, ensure_ascii=False, sort_keys=True)
        except (TypeError, ValueError):
            return None
    else:
        return None
    if len(rendered) <= _MAX_TOOL_RESULT_PREVIEW_CHARS:
        return rendered
    return f"{rendered[:_MAX_TOOL_RESULT_PREVIEW_CHARS - 1]}…"


def _execution_receipt_from_tool_result(
    content: Any,
    expected_canonical_tool: str | None,
) -> tuple[dict[str, str] | None, bool]:
    if not isinstance(content, str):
        return None, False

    def decode(raw: str) -> Any:
        def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            value: dict[str, Any] = {}
            for key, item in pairs:
                if key in value:
                    raise ValueError("duplicate key")
                value[key] = item
            return value

        return json.loads(
            raw,
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError("invalid constant")),
        )

    decoded_documents: list[Any] = []
    malformed_evidence = False
    try:
        decoded_documents.append(decode(content))
    except (TypeError, ValueError, RecursionError):
        for line in content.splitlines():
            if not line.strip():
                continue
            try:
                decoded_documents.append(decode(line))
            except (TypeError, ValueError, RecursionError):
                if '"executionReceipt"' in line:
                    malformed_evidence = True

    blocks: list[Any] = []
    for decoded in decoded_documents:
        blocks.append(decoded)
        if isinstance(decoded, list):
            blocks.extend(decoded)
            for item in decoded:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    try:
                        blocks.append(decode(item["text"]))
                    except (TypeError, ValueError, RecursionError):
                        if '"executionReceipt"' in item["text"]:
                            malformed_evidence = True

    candidates: list[dict[str, str]] = []
    for block in blocks:
        if not isinstance(block, dict) or "executionReceipt" not in block:
            continue
        if set(block) != {"executionReceipt"}:
            malformed_evidence = True
            continue
        receipt = block.get("executionReceipt")
        if not isinstance(receipt, dict):
            malformed_evidence = True
            continue
        tool = _exact_bounded_string(receipt.get("tool"), _WORKER_TOOL_AUTH_MAX_TOOL_CHARS)
        correlation_id = _exact_bounded_string(
            receipt.get("correlationId"), _MAX_EXECUTION_RECEIPT_CORRELATION_CHARS,
        )
        state = receipt.get("state")
        if (
            receipt.get("schema") != _EXECUTION_RECEIPT_SCHEMA
            or tool is None
            or correlation_id is None
            or state not in {"completed", "failed"}
        ):
            malformed_evidence = True
            continue
        candidates.append({
            "schema": _EXECUTION_RECEIPT_SCHEMA,
            "tool": tool,
            "correlationId": correlation_id,
            "state": state,
        })
    if malformed_evidence:
        return None, False
    if expected_canonical_tool is None:
        return (None, True) if not candidates else (None, False)
    if len(candidates) != 1 or candidates[0]["tool"] != expected_canonical_tool:
        return None, False
    return candidates[0], True


def _worker_tool_receipts(
    assignee: Any, worker_session_id: str,
) -> tuple[list[dict[str, Any]], bool]:
    profile_home = _profile_home_for_assignee(assignee)
    if profile_home is None:
        return [], False
    card_tool_mapping = _materialized_card_tool_mapping(profile_home)
    if card_tool_mapping is None:
        return [], False
    state_path = profile_home / "state.db"
    try:
        from hermes_cli.session_export_md import redact_session_data
        from hermes_state import SessionDB

        session_db = SessionDB(db_path=state_path, read_only=True)
        try:
            exported = session_db.export_session(worker_session_id)
        finally:
            session_db.close()
        if not isinstance(exported, dict):
            return [], False
        redacted = redact_session_data(exported)
    except Exception:
        return [], False

    messages = redacted.get("messages")
    if not isinstance(messages, list):
        return [], False
    calls: list[tuple[str, str]] = []
    results: dict[str, dict[str, Any]] = {}
    structurally_complete = True
    seen_call_ids: set[str] = set()
    for message in messages:
        if not isinstance(message, dict):
            structurally_complete = False
            continue
        tool_calls = message.get("tool_calls")
        if tool_calls is not None:
            if not isinstance(tool_calls, list):
                structurally_complete = False
            else:
                for raw_call in tool_calls:
                    if not isinstance(raw_call, dict):
                        structurally_complete = False
                        continue
                    function = raw_call.get("function")
                    call_id = _exact_native_id(raw_call.get("id"))
                    tool_name = (
                        _exact_native_id(function.get("name"))
                        if isinstance(function, dict) else None
                    )
                    if call_id is None or tool_name is None or call_id in seen_call_ids:
                        structurally_complete = False
                        continue
                    seen_call_ids.add(call_id)
                    calls.append((call_id, tool_name))
        if message.get("role") == "tool":
            result_call_id = _exact_native_id(message.get("tool_call_id"))
            if result_call_id is None or result_call_id in results:
                structurally_complete = False
                continue
            results[result_call_id] = message

    receipts: list[dict[str, Any]] = []
    for call_id, tool_name in calls[:_MAX_TOOL_RECEIPTS]:
        result = results.pop(call_id, None)
        if result is None:
            structurally_complete = False
            receipts.append({
                "toolCallId": call_id,
                "toolName": tool_name,
                "state": None,
                "resultPreview": "",
                "executionReceipt": None,
            })
            continue
        preview = _tool_result_preview(result.get("content"))
        if preview is None:
            structurally_complete = False
            preview = ""
        execution_receipt, receipt_valid = _execution_receipt_from_tool_result(
            result.get("content"), card_tool_mapping.get(tool_name),
        )
        if not receipt_valid:
            structurally_complete = False
        receipts.append({
            "toolCallId": call_id,
            "toolName": tool_name,
            "state": _tool_result_state(call_id, result, execution_receipt),
            "resultPreview": preview,
            "executionReceipt": execution_receipt,
        })
    if len(calls) > _MAX_TOOL_RECEIPTS or results:
        structurally_complete = False
    return receipts, structurally_complete


def _native_attempt_evidence(task: Any, latest_attempt: Any) -> dict[str, Any]:
    summary = _bounded_redacted_text(
        latest_attempt.summary if latest_attempt is not None else None,
        _MAX_HANDOFF_SUMMARY_CHARS,
    )
    worker_session_id: str | None = None
    metadata = latest_attempt.metadata if latest_attempt is not None else None
    if metadata is None:
        pass
    elif isinstance(metadata, dict):
        worker_session_id = _exact_native_id(metadata.get("worker_session_id"))
    receipts: list[dict[str, Any]] = []
    receipts_complete = False
    if worker_session_id is not None:
        receipts, receipts_complete = _worker_tool_receipts(task.assignee, worker_session_id)
    return {
        "workerSessionId": worker_session_id,
        "handoffSummary": summary,
        "toolReceipts": receipts,
        "toolReceiptsComplete": receipts_complete,
    }


def read_magentic_execution(payload: dict[str, Any]) -> dict[str, Any]:
    root_id = _required_text(payload.get("nativeRootId"), "native_root_id")
    db_path, task_db, task_db_connect = _task_store()

    with task_db_connect.connect_closing(db_path) as connection:
        root = task_db.get_task(connection, root_id)
        if root is None:
            raise MagenticExecutionError("magentic_native_root_not_found")
        task_ids = _execution_task_ids(connection, root_id)
        tasks = [task_db.get_task(connection, task_id) for task_id in task_ids]
        tasks = [task for task in tasks if task is not None]
        blocked = [task for task in tasks if task.status == "blocked"]
        latest_root_run = task_db.latest_run(connection, root_id)
        native_tasks = []
        for task in tasks:
            latest_attempt = task_db.latest_run(connection, task.id)
            native_tasks.append({
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
                **_native_attempt_evidence(task, latest_attempt),
            })
        response: dict[str, Any] = {
            "ok": True,
            "nativeRootId": root_id,
            "state": "running",
            "nativeStatus": root.status,
            "nativeIdentity": root.assignee,
            "effectiveProvider": root.provider_override,
            "providerApiMode": (
                "codex_app_server" if root.provider_override == "openai-codex" else None
            ),
            "model": root.model_override,
            "nativeRunId": latest_root_run.id if latest_root_run else None,
            "nativeTasks": native_tasks,
        }
        if any(task.status == "archived" for task in tasks):
            return {**response, "state": "cancelled"}
        if blocked:
            return {
                **response,
                "state": "blocked",
                "error": f"magentic_task_blocked:{blocked[0].id}",
            }
        if root.status != "done":
            return response
        final_result = task_db.latest_summary(connection, root_id) or root.result
        if not str(final_result or "").strip():
            return {
                **response,
                "state": "failed",
                "error": "magentic_final_result_missing",
            }
        return {
            **response,
            "state": "completed",
            "finalResult": str(final_result),
        }


def stop_magentic_execution(payload: dict[str, Any]) -> dict[str, Any]:
    root_id = _required_text(payload.get("nativeRootId"), "native_root_id")
    db_path, task_db, task_db_connect = _task_store()

    with task_db_connect.connect_closing(db_path) as connection:
        if task_db.get_task(connection, root_id) is None:
            raise MagenticExecutionError("magentic_native_root_not_found")
        task_ids = _execution_task_ids(connection, root_id)
        for task_id in reversed(task_ids):
            task_db.archive_task(connection, task_id)
        root = task_db.get_task(connection, root_id)
        return {
            "ok": True,
            "nativeRootId": root_id,
            "state": "cancelled",
            "nativeStatus": root.status if root is not None else "archived",
        }
