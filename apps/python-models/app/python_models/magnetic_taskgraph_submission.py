"""Magnetic root staging, submission, activation, and outer Run binding."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.python_models.magnetic_taskgraph_authority import (
    MagneticTaskGraphError,
    _bind_hermes_worker_authorities,
    _default_home_scope,
    _direct_team_worker,
    _ensure_orchestrator_identity,
    _hermes_model,
    hermes_task_runtime_scope,
    _required_text,
    _runtime_paths,
    _task_store,
    _worker_authorities,
    _worker_scope,
)
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

    from app.python_models.card_run_execution import update_run_progress

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
    """Stage one root while all embedded Hermes imports use Hermes's modules."""

    with hermes_task_runtime_scope():
        return _submit_magnetic_taskgraph(payload)


def _submit_magnetic_taskgraph(payload: dict[str, Any]) -> dict[str, Any]:
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
