"""Magnetic root validation, package-safe staging, activation and Run binding."""

# Entity: Magnetic TaskGraph
# Relationship: This file validates, stages, binds, and activates one same-root Hermes mission from exact saved blue-worker authority.
# Entity: IDF
# Relationship: This file reloads the canonical retained in.idf and rejects any transport mission that differs from the materialized mission bytes.
# Entity: Run Ledger
# Relationship: This file binds the staged Hermes root to the already accepted outer Run before activation and never creates a second product Run.
# Entity: Team
# Relationship: This file uses the same Hermes root path for a sole direct Team worker while preserving Team's saved profile and parent model.

from __future__ import annotations

from typing import Any

from app.python_models.magnetic_taskgraph_authority import (
    MagneticTaskGraphError,
    _direct_team_worker,
    _ensure_orchestrator_identity,
    _hermes_model,
    _required_text,
    _worker_authorities,
    _worker_scope,
    call_hermes_taskgraph_adapter,
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
        "running before that claim. Link each result needed for your next decision as a parent of "
        "THIS root task with kanban_link. Then end this attempt with "
        "kanban_block(kind=\"dependency\"); Hermes will keep this same root in todo while those "
        "parents are unfinished, then promote it to ready.\n\n"
        "Whenever Hermes runs this root again, inspect the parent handoffs already included in the "
        "Hermes worker context. Decide whether another bounded worker round is useful. If so, create "
        "and link that round and dependency-block this same root again. When the evidence is enough, "
        "answer the original user directly and call kanban_complete on THIS root with the final answer "
        "as its summary. Never complete an intermediate decomposition and never create another task "
        "for final synthesis.\n\nMission and selected context:\n"
        f"{mission}"
    )


def _bind_outer_magnetic_taskgraph_run(
    run_id: str, hermes_root_id: str, hermes_status: str,
) -> dict[str, Any]:
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
        input_file,
        project_id=project_id,
        deck_id=deck_id,
        run_id=run_id,
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
        "runId": run_id,
        "spec": spec,
        "workers": workers,
        "mission": mission,
        "workerIdentities": worker_identities,
        "workerText": worker_text,
        "workerAuthorities": _worker_authorities(
            workers, payload.get("workerAuthorities"),
        ),
        "directTeam": _direct_team_worker(workers),
    }


def submit_magnetic_taskgraph(payload: dict[str, Any]) -> dict[str, Any]:
    request = _validated_magnetic_submission(payload)
    run_id = request["runId"]
    spec = request["spec"]
    workers = request["workers"]
    mission = request["mission"]
    worker_identities = request["workerIdentities"]
    worker_authorities = request["workerAuthorities"]
    direct_team = request["directTeam"]
    tenant = f"mag-one:{run_id}"

    if direct_team is None:
        profile, provider, model = _ensure_orchestrator_identity(spec, workers)
        body = _root_body(mission, request["workerText"])
        title = f"Mag One {run_id}"[:200]
    else:
        team_provider = (
            direct_team.get("provider")
            if isinstance(direct_team.get("provider"), dict) else {}
        )
        team_options = (
            direct_team.get("runtimeOptions")
            if isinstance(direct_team.get("runtimeOptions"), dict) else {}
        )
        profile = worker_identities[0]
        provider, model = _hermes_model(team_provider, team_options)
        body = mission
        title = f"Team {run_id}"[:200]

    staged = call_hermes_taskgraph_adapter({
        "action": "stage_root",
        "runId": run_id,
        "profile": profile,
        "provider": provider,
        "model": model,
        "tenant": tenant,
        "title": title,
        "body": body,
        "workerProfiles": worker_identities,
        "workerAuthorities": worker_authorities,
        "createdBy": _required_text(
            spec.get("hermesProfile"), "magnetic_taskgraph_hermes_profile",
        ).lower(),
        "directTeam": direct_team is not None,
    })
    staged_root = staged.get("root")
    if not isinstance(staged_root, dict):
        raise MagneticTaskGraphError("magnetic_taskgraph_hermes_root_readback_mismatch")
    root_id = _required_text(staged_root.get("taskId"), "hermes_root_id")
    staged_status = _required_text(staged_root.get("status"), "hermes_root_status")
    _bind_outer_magnetic_taskgraph_run(run_id, root_id, staged_status)

    activated = call_hermes_taskgraph_adapter({
        "action": "activate_root",
        "rootId": root_id,
        "directTeam": direct_team is not None,
    })
    root = activated.get("root")
    if not isinstance(root, dict):
        raise MagneticTaskGraphError("magnetic_taskgraph_hermes_root_activation_failed")
    status = _required_text(root.get("status"), "hermes_root_status")
    return {
        "ok": True,
        "runId": run_id,
        "hermesRootId": root_id,
        "hermesProfile": profile,
        "configuredProvider": provider,
        "configuredModel": model,
        "tenant": tenant,
        "state": "running" if status == "running" else "pending",
        "hermesStatus": status,
        "outerRunBound": True,
    }
