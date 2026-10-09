"""LiquidAIty Magnetic TaskGraph over Hermes task and dependency APIs."""

from __future__ import annotations

import json
import re
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class MagneticTaskGraphError(RuntimeError):
    pass


_TEAM_CARD_ID = "card_team"
_MAX_HANDOFF_SUMMARY_CHARS = 2_000
_LOWER_HEX_64_RE = re.compile(r"^[a-f0-9]{64}$", re.ASCII)
_HERMES_AUTHORITY_EVENT = "card_authority_bound"


def _required_text(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise MagneticTaskGraphError(f"{field}_required")
    return text


def _runtime_paths() -> tuple[Path, Path]:
    repository = Path(__file__).resolve().parents[4]
    hermes_root = repository / "HermesLatest"
    hermes_home = hermes_root / ".hermes"
    if not hermes_root.is_dir():
        raise MagneticTaskGraphError("magnetic_taskgraph_hermes_runtime_missing")
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


def _hermes_model(provider: dict[str, Any], options: dict[str, Any]) -> tuple[str, str, str | None]:
    saved_provider = _required_text(provider.get("provider"), "magnetic_taskgraph_provider")
    access_mode = _required_text(provider.get("accessMode"), "magnetic_taskgraph_access_mode")
    model = _required_text(
        provider.get("providerModelId") or provider.get("modelKey")
        or options.get("providerModelId") or options.get("modelKey"),
        "magnetic_taskgraph_model",
    )
    mapping = {
        ("openai", "chatgpt-account"): ("openai-codex", "codex_app_server"),
        ("openai", "openai-api"): ("openai", None),
        ("openrouter", "openrouter-api"): ("openrouter", None),
        ("local_openai_compatible", "openai-api"): ("local_openai_compatible", None),
    }
    resolved = mapping.get((saved_provider, access_mode))
    if resolved is None:
        raise MagneticTaskGraphError(
            f"magnetic_taskgraph_provider_binding_unsupported:{saved_provider}:{access_mode}"
        )
    return resolved[0], model, resolved[1]


def _ensure_orchestrator_identity(
    spec: dict[str, Any], workers: list[dict[str, Any]],
) -> tuple[str, str, str, str | None]:
    hermes_profile = _required_text(spec.get("hermesProfile"), "magnetic_taskgraph_hermes_profile").lower()
    instructions = spec.get("instructions")
    if not isinstance(instructions, str) or not instructions.strip():
        raise MagneticTaskGraphError("magnetic_taskgraph_instructions_required")
    provider = spec.get("provider") if isinstance(spec.get("provider"), dict) else {}
    options = spec.get("runtimeOptions") if isinstance(spec.get("runtimeOptions"), dict) else {}
    hermes_provider, model, openai_runtime = _hermes_model(provider, options)
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

        orchestrator_home = profile_home(hermes_profile)
        if orchestrator_home is None:
            raise MagneticTaskGraphError(
                f"magnetic_taskgraph_orchestrator_profile_missing:{hermes_profile}"
            )
        missing = [
            _required_text(worker.get("profile"), "magnetic_taskgraph_worker_identity")
            for worker in workers
            if profile_home(_required_text(worker.get("profile"), "magnetic_taskgraph_worker_identity")) is None
        ]
        if missing:
            raise MagneticTaskGraphError(
                f"magnetic_taskgraph_worker_profile_missing:{','.join(missing)}"
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
                model_config.get("provider") != hermes_provider
                or model_config.get("default") != model
                or "system_prompt" in agent_config
                or soul != instructions
            ):
                raise MagneticTaskGraphError("magnetic_taskgraph_orchestrator_materialization_mismatch")
        finally:
            reset_hermes_home_override(token)
    return hermes_profile, hermes_provider, model, openai_runtime


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
        card_id = _required_text(worker.get("cardId"), "magnetic_taskgraph_worker_card")
        revision_id = _required_text(worker.get("cardRevisionId"), "magnetic_taskgraph_worker_revision")
        identity = _required_text(worker.get("profile"), "magnetic_taskgraph_worker_identity").lower()
        if identity in seen:
            raise MagneticTaskGraphError(f"magnetic_taskgraph_worker_identity_duplicate:{identity}")
        seen.add(identity)
        identities.append(identity)
        title = str(worker.get("title") or card_id).strip()
        description = str(worker.get("description") or "").strip()
        capabilities = worker.get("capabilities")
        eligible_tools: list[str] = []
        if capabilities is not None:
            if (
                not isinstance(capabilities, dict)
                or set(capabilities) != {"savedToolIds", "projectEligibleToolIds"}
                or not isinstance(capabilities.get("savedToolIds"), list)
                or not isinstance(capabilities.get("projectEligibleToolIds"), list)
                or len(capabilities["savedToolIds"]) > 128
                or len(capabilities["projectEligibleToolIds"]) > 128
            ):
                raise MagneticTaskGraphError("magnetic_taskgraph_worker_capabilities_invalid")
            saved_tools = [
                _required_text(value, "magnetic_taskgraph_worker_saved_capability")
                for value in capabilities["savedToolIds"]
            ]
            eligible_tools = [
                _required_text(value, "magnetic_taskgraph_worker_project_capability")
                for value in capabilities["projectEligibleToolIds"]
            ]
            if (
                len(saved_tools) != len(set(saved_tools))
                or len(eligible_tools) != len(set(eligible_tools))
                or not set(eligible_tools) <= set(saved_tools)
            ):
                raise MagneticTaskGraphError("magnetic_taskgraph_worker_capabilities_invalid")
        details = [description] if description else []
        if capabilities is not None:
            details.append(
                "Project-eligible tools: "
                + (", ".join(eligible_tools) if eligible_tools else "none")
            )
        capability = f"; {'; '.join(details)}" if details else ""
        lines.append(
            f"- {identity}: Card {card_id} revision {revision_id}; "
            f"{title}{capability}"
        )
    if not identities:
        raise MagneticTaskGraphError("magnetic_taskgraph_no_connected_workers")
    return identities, "\n".join(lines)


def _direct_team_worker(workers: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the sole Team worker, while rejecting a mismatched structural marker."""

    for worker in workers:
        card_id = _required_text(worker.get("cardId"), "magnetic_taskgraph_worker_card")
        marked_team = worker.get("teamTaskMode") is True
        if marked_team != (card_id == _TEAM_CARD_ID):
            raise MagneticTaskGraphError(f"magnetic_taskgraph_team_identity_invalid:{card_id}")
    if len(workers) == 1 and workers[0].get("cardId") == _TEAM_CARD_ID:
        return workers[0]
    return None


def _worker_authorities(
    workers: list[dict[str, Any]], value: Any,
) -> list[dict[str, str]]:
    if not isinstance(value, list) or len(value) != len(workers):
        raise MagneticTaskGraphError("magnetic_taskgraph_worker_authorities_invalid")
    authorities: list[dict[str, str]] = []
    seen: set[str] = set()
    expected_keys = {
        "cardId", "cardRevisionId", "profile", "configurationFingerprint",
    }
    for worker, candidate in zip(workers, value, strict=True):
        if not isinstance(candidate, dict) or set(candidate) != expected_keys:
            raise MagneticTaskGraphError("magnetic_taskgraph_worker_authorities_invalid")
        authority = {
            "cardId": _required_text(candidate.get("cardId"), "magnetic_taskgraph_authority_card"),
            "cardRevisionId": _required_text(
                candidate.get("cardRevisionId"), "magnetic_taskgraph_authority_revision",
            ),
            "profile": _required_text(
                candidate.get("profile"), "magnetic_taskgraph_authority_profile",
            ).lower(),
            "configurationFingerprint": _required_text(
                candidate.get("configurationFingerprint"),
                "magnetic_taskgraph_authority_configuration_fingerprint",
            ),
        }
        if (
            authority["cardId"] != _required_text(worker.get("cardId"), "magnetic_taskgraph_worker_card")
            or authority["cardRevisionId"] != _required_text(
                worker.get("cardRevisionId"), "magnetic_taskgraph_worker_revision",
            )
            or authority["profile"] != _required_text(
                worker.get("profile"), "magnetic_taskgraph_worker_identity",
            ).lower()
            or not _LOWER_HEX_64_RE.fullmatch(authority["configurationFingerprint"])
            or authority["profile"] in seen
        ):
            raise MagneticTaskGraphError("magnetic_taskgraph_worker_authorities_invalid")
        seen.add(authority["profile"])
        authorities.append(authority)
    return authorities


def _bind_hermes_worker_authorities(
    connection: Any,
    task_db: Any,
    root_id: str,
    authorities: list[dict[str, str]],
) -> None:
    expected = {"workers": authorities}
    with task_db.write_txn(connection):
        rows = connection.execute(
            "SELECT payload FROM task_events WHERE task_id = ? AND kind = ? ORDER BY id",
            (root_id, _HERMES_AUTHORITY_EVENT),
        ).fetchall()
        if not rows:
            task_db._append_event(connection, root_id, _HERMES_AUTHORITY_EVENT, expected)
            return
        if (
            len(rows) != 1
            or not isinstance(rows[0]["payload"], str)
            or _parse_worker_authority_event(rows[0]["payload"]) != expected
        ):
            raise MagneticTaskGraphError("magnetic_taskgraph_worker_authority_binding_mismatch")


def _root_body(mission: str, worker_text: str) -> str:
    return (
        "You are the saved Magnetic orchestrator for this Mag One mission. This Hermes task is "
        "both the orchestration root and the final result task.\n\n"
        "Main and the user already approved this mission after upstream context engineering. "
        "Execute this mission as given; do not invent a replacement mission or another approval step.\n\n"
        "Available top-level worker Agents (the complete Mag One assignment scope):\n"
        f"{worker_text}\n\n"
        "Use only the listed saved profiles, and only when their work helps answer the mission. "
        "Do not discover, infer, create, or substitute another worker profile. Do not use "
        "auto-decomposition, triage, goal mode, delegate_task, or a separate synthesis task.\n\n"
        "For each useful worker assignment, create one Hermes task with initial_status=\"running\" "
        "and an assignee from the list above. The task body must contain the bounded work request "
        "and require that saved worker to return its result directly through kanban_complete. "
        "Launch useful worker tasks independently; never make one worker wait for another. "
        "Hermes stores that new task as ready until its dispatcher claims it; do not describe it as "
        "running before that claim. Link "
        "each result needed for your next decision as a parent of THIS root task with kanban_link. "
        "Then end this attempt with kanban_block(kind=\"dependency\"); Hermes will keep this same "
        "root in todo while those parents are unfinished, then promote it to ready.\n\n"
        "Whenever Hermes runs this root again, inspect the parent handoffs already included in the "
        "Hermes worker context. Decide whether another bounded worker round is useful. If so, create "
        "and link that round and dependency-block this same root again. When the evidence is enough, "
        "answer the original user directly and call kanban_complete on THIS root with the final answer "
        "as its summary. Never complete an intermediate decomposition and never create another task "
        "for final synthesis.\n\n"
        "Mission and selected context:\n"
        f"{mission}"
    )


def _bind_outer_magnetic_taskgraph_run(
    run_id: str, hermes_root_id: str, hermes_status: str,
) -> dict[str, Any]:
    """Bind the outer PostgreSQL Run before the Hermes root becomes dispatchable."""

    from app.python_models.card_runs import update_run_progress

    result = update_run_progress({
        "runId": run_id,
        "hermesRootId": hermes_root_id,
        "hermesStatus": hermes_status,
    })
    if (
        not isinstance(result, dict)
        or result.get("ok") is not True
        or result.get("runId") != run_id
        or result.get("hermesRootId") != hermes_root_id
        or result.get("updated") is not True
    ):
        raise MagneticTaskGraphError("magnetic_taskgraph_outer_run_binding_failed")
    return result


def _validated_magnetic_submission(payload: dict[str, Any]) -> dict[str, Any]:
    run_id = _required_text(payload.get("runId"), "run_id")
    project_id = _required_text(payload.get("projectId"), "project_id")
    deck_id = _required_text(payload.get("deckId"), "deck_id")
    spec = payload.get("orchestrator")
    workers = payload.get("workers")
    input_file = payload.get("inputFile")
    if not isinstance(spec, dict) or not isinstance(workers, list) or not isinstance(input_file, dict):
        raise MagneticTaskGraphError("magnetic_taskgraph_contract_invalid")
    from app.python_models.idf import load_idf, runtime_projection

    materialized = load_idf(
        input_file, project_id=project_id, deck_id=deck_id, run_id=run_id,
        card_id=_required_text(spec.get("cardId"), "magnetic_taskgraph_card_id"),
    )
    mission = _required_text(
        runtime_projection(materialized).get("taskGraphMission"),
        "magnetic_taskgraph_mission",
    )
    if payload.get("mission") != mission:
        raise MagneticTaskGraphError("magnetic_taskgraph_mission_input_mismatch")
    worker_identities, worker_text = _worker_scope(workers)
    return {
        "runId": run_id, "spec": spec, "workers": workers, "mission": mission,
        "workerIdentities": worker_identities, "workerText": worker_text,
        "workerAuthorities": _worker_authorities(
            workers, payload.get("workerAuthorities"),
        ),
        "directTeam": _direct_team_worker(workers),
    }


def _bind_activate_magnetic_root(
    *, connection: Any, task_db: Any, run_id: str, hermes_root_id: str,
    root: Any, worker_authorities: list[dict[str, str]], direct_team: Any,
) -> Any:
    _bind_hermes_worker_authorities(
        connection, task_db, hermes_root_id, worker_authorities,
    )
    _bind_outer_magnetic_taskgraph_run(run_id, hermes_root_id, root.status)
    if root.status == "blocked":
        if direct_team is not None:
            from hermes_cli.kanban_team import activate_staged_team_root

            activated = activate_staged_team_root(connection, hermes_root_id)
        else:
            activated, _reason = task_db.promote_task(
                connection, hermes_root_id, actor="card_magentic",
                reason="outer Magnetic Run authority bound",
            )
        if not activated:
            raise MagneticTaskGraphError("magnetic_taskgraph_hermes_root_activation_failed")
    root = task_db.get_task(connection, hermes_root_id)
    accepted_statuses = (
        {"triage", "todo", "ready", "running"}
        if direct_team is not None else {"todo", "ready", "running"}
    )
    if root is None or root.status not in accepted_statuses:
        raise MagneticTaskGraphError("magnetic_taskgraph_hermes_root_activation_failed")
    return root


def _stage_team_root(
    *, connection: Any, direct_team: dict[str, Any],
    worker_identities: list[str], spec: dict[str, Any], mission: str,
    run_id: str, tenant: str, hermes_home: Path,
) -> tuple[Any, str, str, str, str, str | None]:
    team_provider = (
        direct_team.get("provider")
        if isinstance(direct_team.get("provider"), dict) else {}
    )
    team_options = (
        direct_team.get("runtimeOptions")
        if isinstance(direct_team.get("runtimeOptions"), dict) else {}
    )
    hermes_profile = worker_identities[0]
    hermes_provider, hermes_model, openai_runtime = _hermes_model(
        team_provider, team_options,
    )
    try:
        with _default_home_scope(hermes_home):
            from hermes_cli.kanban_team import create_team_root

            root = create_team_root(
                connection, title=f"Team {run_id}"[:200], body=mission,
                assignee=hermes_profile,
                profile_home=hermes_home / "profiles" / hermes_profile,
                created_by=_required_text(
                    spec.get("hermesProfile"), "magnetic_taskgraph_hermes_profile",
                ).lower(),
                tenant=tenant, workspace_kind="scratch", project_id="",
                idempotency_key=f"magentic:{run_id}:root",
                model_override=hermes_model, provider_override=hermes_provider,
                allowed_assignees=[hermes_profile], initial_status="blocked",
            )
    except (RuntimeError, ValueError) as error:
        raise MagneticTaskGraphError(
            f"magnetic_taskgraph_team_root_invalid:{error}"
        ) from error
    return root, root.id, hermes_profile, hermes_provider, hermes_model, openai_runtime


def _stage_magnetic_root(
    *, connection: Any, task_db: Any, spec: dict[str, Any],
    workers: list[dict[str, Any]], worker_identities: list[str],
    worker_text: str, mission: str, run_id: str, tenant: str,
) -> tuple[Any, str, str, str, str, str | None]:
    hermes_profile, hermes_provider, hermes_model, openai_runtime = (
        _ensure_orchestrator_identity(spec, workers)
    )
    allowed_assignees = [hermes_profile, *worker_identities]
    root_body = _root_body(mission, worker_text)
    hermes_root_id = task_db.create_task(
        connection, title=f"Mag One {run_id}"[:200], body=root_body,
        assignee=hermes_profile, created_by=hermes_profile, tenant=tenant,
        workspace_kind="scratch", project_id="",
        idempotency_key=f"magentic:{run_id}:root",
        model_override=hermes_model, provider_override=hermes_provider,
        allowed_assignees=allowed_assignees, initial_status="blocked",
    )
    root = task_db.get_task(connection, hermes_root_id)
    if (
        root is None or root.allowed_assignees != allowed_assignees
        or root.assignee != hermes_profile or root.tenant != tenant
        or root.model_override != hermes_model
        or root.provider_override != hermes_provider or root.body != root_body
    ):
        raise MagneticTaskGraphError("magnetic_taskgraph_hermes_root_readback_mismatch")
    return root, hermes_root_id, hermes_profile, hermes_provider, hermes_model, openai_runtime


def submit_magnetic_taskgraph(payload: dict[str, Any]) -> dict[str, Any]:
    request = _validated_magnetic_submission(payload)
    run_id = request["runId"]
    spec = request["spec"]
    workers = request["workers"]
    mission = request["mission"]
    worker_identities = request["workerIdentities"]
    worker_text = request["workerText"]
    worker_authorities = request["workerAuthorities"]
    direct_team = request["directTeam"]
    tenant = f"mag-one:{run_id}"
    db_path, task_db, task_db_connect = _task_store()
    task_db_connect.init_db(db_path)
    _, hermes_home = _runtime_paths()
    with task_db_connect.connect_closing(db_path) as connection:
        hermes_root_id = ""
        try:
            if direct_team is not None:
                root, hermes_root_id, hermes_profile, hermes_provider, hermes_model, openai_runtime = _stage_team_root(
                    connection=connection, direct_team=direct_team,
                    worker_identities=worker_identities, spec=spec, mission=mission,
                    run_id=run_id, tenant=tenant, hermes_home=hermes_home,
                )
            else:
                root, hermes_root_id, hermes_profile, hermes_provider, hermes_model, openai_runtime = _stage_magnetic_root(
                    connection=connection, task_db=task_db, spec=spec,
                    workers=workers, worker_identities=worker_identities,
                    worker_text=worker_text, mission=mission, run_id=run_id,
                    tenant=tenant,
                )
            root = _bind_activate_magnetic_root(
                connection=connection, task_db=task_db, run_id=run_id,
                hermes_root_id=hermes_root_id, root=root,
                worker_authorities=worker_authorities, direct_team=direct_team,
            )
        except Exception:
            # A failed cross-store bind leaves the exact idempotent root blocked
            # and therefore unclaimable. Never delete here: another submit may
            # have created or bound this same Hermes root concurrently.
            raise
    return {
        "ok": True,
        "runId": run_id,
        "hermesRootId": hermes_root_id,
        "hermesProfile": hermes_profile,
        "configuredProvider": hermes_provider,
        "configuredProviderApiMode": openai_runtime,
        "configuredModel": hermes_model,
        "tenant": tenant,
        "state": "running" if root.status == "running" else "pending",
        "hermesStatus": root.status,
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


def _parse_worker_authority_event(raw: str) -> dict[str, Any]:
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
    except (TypeError, ValueError, RecursionError) as error:
        raise MagneticTaskGraphError("magnetic_taskgraph_worker_authority_event_invalid") from error
    if not isinstance(parsed, dict):
        raise MagneticTaskGraphError("magnetic_taskgraph_worker_authority_event_invalid")
    return parsed


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
