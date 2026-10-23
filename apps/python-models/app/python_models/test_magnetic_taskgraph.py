# Entity: Magnetic TaskGraph
# Relationship: This file verifies exact blue-roster validation, package-bound root staging and activation, readback projection, and same-root continuation.
# Entity: IDF
# Relationship: This file verifies Magnetic reloads the retained canonical IDF and rejects a transport mission that differs from its materialized mission.
# Entity: Run Ledger
# Relationship: This file verifies root staging binds the existing outer Run before activation and terminal reconciliation settles that same Run.
# Entity: Tool Catalog
# Relationship: This file verifies worker scope carries only compact saved tool identifiers and rejects an alternate capability authority.
# Entity: Team
# Relationship: This file verifies a sole Team worker uses the same adapter root with the exact saved Team identity, provider, and model.

from __future__ import annotations

from typing import Any

import pytest

from app import mag_one_operation
from app.python_models import idf as idf_module
from app.python_models import (
    magnetic_taskgraph_authority,
    magnetic_taskgraph_readback,
    magnetic_taskgraph_submission,
)


def _execution_payload() -> dict[str, Any]:
    return {
        "runId": "run-one",
        "correlationId": "correlation-one",
        "projectId": "project-one",
        "deckId": "deck-one",
        "inputFile": {
            "idfPath": "retained/in.idf",
            "idfSha256": "exact-hash",
            "idfBytes": 123,
        },
        "mission": "Exact mission from the retained IDF.",
        "orchestrator": {
            "cardId": "card_magentic",
            "cardRevisionId": "mag-one-revision",
            "hermesProfile": "card_magentic",
            "instructions": "Coordinate the connected Cards.",
            "provider": {
                "provider": "openai",
                "modelKey": "gpt-5.6-sol",
                "providerModelId": "gpt-5.6-sol",
                "accessMode": "chatgpt-account",
            },
            "runtimeOptions": {},
        },
        "workers": [
            {
                "cardId": "worker-card-a",
                "cardRevisionId": "worker-revision-a",
                "profile": "worker-a",
                "title": "Worker A",
                "description": "First saved Card",
            },
            {
                "cardId": "worker-card-b",
                "cardRevisionId": "worker-revision-b",
                "profile": "worker-b",
                "title": "Worker B",
                "description": "Second saved Card",
            },
        ],
        "workerAuthorities": [
            {
                "cardId": "worker-card-a",
                "cardRevisionId": "worker-revision-a",
                "profile": "worker-a",
            },
            {
                "cardId": "worker-card-b",
                "cardRevisionId": "worker-revision-b",
                "profile": "worker-b",
            },
        ],
        "notification": {
            "sessionId": "source-session",
            "notifyPlatform": "api_server",
            "notifyChatId": "source-session",
            "notifyDeliveryMode": "notify+wake",
        },
    }


def _team_execution_payload() -> dict[str, Any]:
    payload = _execution_payload()
    payload["workers"] = [{
        "cardId": "card_team",
        "cardRevisionId": "team-revision",
        "profile": "team",
        "title": "Team",
        "description": "Automatic generalist Team",
        "teamTaskMode": True,
        "provider": {
            "provider": "openai",
            "accessMode": "chatgpt-account",
            "modelKey": "gpt-5.6-terra",
            "providerModelId": "gpt-5.6-terra",
        },
        "runtimeOptions": {
            "modelKey": "gpt-5.6-terra",
            "providerModelId": "gpt-5.6-terra",
        },
    }]
    payload["workerAuthorities"] = [{
        "cardId": "card_team",
        "cardRevisionId": "team-revision",
        "profile": "team",
    }]
    return payload


def _stub_retained_input(monkeypatch, *, mission: str | None = None) -> dict[str, str]:
    captured: dict[str, str] = {}

    def load_idf(_descriptor, **identity):
        captured.update(identity)
        return object()

    monkeypatch.setattr(idf_module, "load_idf", load_idf)
    monkeypatch.setattr(
        idf_module,
        "runtime_projection",
        lambda _materialized: {
            "taskGraphMission": mission or "Exact mission from the retained IDF.",
        },
    )
    monkeypatch.setattr(
        magnetic_taskgraph_submission,
        "_bind_outer_magnetic_taskgraph_run",
        lambda run_id, root_id, _status: {
            "ok": True,
            "runId": run_id,
            "hermesRootId": root_id,
            "updated": True,
        },
    )
    return captured


def test_worker_scope_includes_only_compact_saved_card_capability_metadata() -> None:
    workers = _execution_payload()["workers"]
    workers[0]["capabilities"] = {
        "savedToolIds": ["weather.read", "ais.history"],
    }

    identities, scope = magnetic_taskgraph_authority._worker_scope(workers)

    assert identities == ["worker-a", "worker-b"]
    assert "Saved Card tools: weather.read, ais.history" in scope
    assert "Saved Card tools" not in scope.splitlines()[1]


def test_worker_scope_rejects_a_second_capability_authority() -> None:
    workers = _execution_payload()["workers"]
    workers[0]["capabilities"] = {
        "savedToolIds": ["weather.read"],
        "projectEligibleToolIds": ["ais.history"],
    }

    with pytest.raises(magnetic_taskgraph_authority.MagneticTaskGraphError) as error:
        magnetic_taskgraph_authority._worker_scope(workers)
    assert str(error.value) == "magnetic_taskgraph_worker_capabilities_invalid"


def test_submit_reloads_idf_and_uses_validate_stage_bind_activate_order(monkeypatch) -> None:
    captured = _stub_retained_input(monkeypatch)
    calls: list[dict[str, Any]] = []

    def adapter(request: dict[str, Any], **_options) -> dict[str, Any]:
        calls.append(request)
        if request["action"] == "validate_profiles":
            return {"ok": True}
        if request["action"] == "stage_root":
            return {
                "ok": True,
                "root": {"taskId": "root-one", "status": "blocked"},
            }
        if request["action"] == "activate_root":
            return {
                "ok": True,
                "root": {"taskId": "root-one", "status": "ready"},
            }
        raise AssertionError(request)

    monkeypatch.setattr(
        magnetic_taskgraph_authority,
        "call_hermes_taskgraph_adapter",
        adapter,
    )
    monkeypatch.setattr(
        magnetic_taskgraph_submission,
        "call_hermes_taskgraph_adapter",
        adapter,
    )

    result = magnetic_taskgraph_submission.submit_magnetic_taskgraph(
        _execution_payload(),
    )

    assert captured == {
        "project_id": "project-one",
        "deck_id": "deck-one",
        "run_id": "run-one",
        "card_id": "card_magentic",
    }
    assert [request["action"] for request in calls] == [
        "validate_profiles", "stage_root", "activate_root",
    ]
    staged = calls[1]
    assert staged["workerProfiles"] == ["worker-a", "worker-b"]
    assert staged["workerAuthorities"] == _execution_payload()["workerAuthorities"]
    assert staged["directTeam"] is False
    assert staged["sessionId"] == "source-session"
    assert staged["notifyPlatform"] == "api_server"
    assert "both the orchestration root and the final result task" in staged["body"]
    assert result == {
        "ok": True,
        "runId": "run-one",
        "hermesRootId": "root-one",
        "hermesProfile": "card_magentic",
        "configuredProvider": "openai-codex",
        "configuredModel": "gpt-5.6-sol",
        "tenant": "mag-one:run-one",
        "state": "pending",
        "hermesStatus": "ready",
        "outerRunBound": True,
    }


def test_team_only_uses_the_same_adapter_root_without_magnetic_profile_validation(monkeypatch) -> None:
    _stub_retained_input(monkeypatch)
    calls: list[dict[str, Any]] = []

    def adapter(request: dict[str, Any], **_options) -> dict[str, Any]:
        calls.append(request)
        if request["action"] == "stage_root":
            return {"ok": True, "root": {"taskId": "team-root", "status": "blocked"}}
        if request["action"] == "activate_root":
            return {"ok": True, "root": {"taskId": "team-root", "status": "triage"}}
        raise AssertionError(request)

    monkeypatch.setattr(magnetic_taskgraph_submission, "call_hermes_taskgraph_adapter", adapter)

    result = magnetic_taskgraph_submission.submit_magnetic_taskgraph(
        _team_execution_payload(),
    )

    assert [request["action"] for request in calls] == ["stage_root", "activate_root"]
    assert calls[0]["directTeam"] is True
    assert calls[0]["profile"] == "team"
    assert result["hermesRootId"] == "team-root"
    assert result["hermesProfile"] == "team"
    assert result["configuredModel"] == "gpt-5.6-terra"


def test_team_marker_cannot_be_applied_to_another_worker(monkeypatch) -> None:
    payload = _execution_payload()
    payload["workers"][0]["teamTaskMode"] = True
    _stub_retained_input(monkeypatch)

    with pytest.raises(magnetic_taskgraph_authority.MagneticTaskGraphError) as error:
        magnetic_taskgraph_submission.submit_magnetic_taskgraph(payload)
    assert str(error.value) == "magnetic_taskgraph_team_identity_invalid:worker-card-a"


def test_submit_rejects_transport_mission_that_differs_from_reloaded_idf(monkeypatch) -> None:
    _stub_retained_input(monkeypatch, mission="Mission held by retained bytes.")

    with pytest.raises(magnetic_taskgraph_authority.MagneticTaskGraphError) as error:
        magnetic_taskgraph_submission.submit_magnetic_taskgraph(_execution_payload())
    assert str(error.value) == "magnetic_taskgraph_mission_input_mismatch"


def test_readback_projects_exact_adapter_tasks_and_terminal_result(monkeypatch) -> None:
    monkeypatch.setattr(
        magnetic_taskgraph_readback,
        "call_hermes_taskgraph_adapter",
        lambda request: {
            "ok": True,
            "root": {
                "taskId": request["rootId"],
                "assignee": "card_magentic",
                "status": "done",
                "provider": "openai-codex",
                "model": "gpt-5.6-sol",
            },
            "rootRunId": "attempt-two",
            "tasks": [{
                "taskId": request["rootId"],
                "title": "Mag One",
                "assignee": "card_magentic",
                "status": "done",
                "dependencyIds": ["worker-one"],
                "latestAttempt": {"runId": "attempt-two", "status": "done"},
                "resultAvailable": True,
                "handoffSummary": "Final answer",
            }],
            "finalResult": "Final answer",
        },
    )

    result = magnetic_taskgraph_readback.read_magnetic_taskgraph({
        "hermesRootId": "root-one",
    })

    assert result["state"] == "completed"
    assert result["hermesRootId"] == "root-one"
    assert result["hermesRunId"] == "attempt-two"
    assert result["finalResult"] == "Final answer"
    assert result["hermesTasks"][0]["dependencyIds"] == ["worker-one"]


def test_request_driven_reconciliation_settles_the_same_outer_run(monkeypatch) -> None:
    monkeypatch.setattr(
        magnetic_taskgraph_readback,
        "read_magnetic_taskgraph",
        lambda _payload: {
            "ok": True,
            "hermesRootId": "root-one",
            "state": "completed",
            "hermesStatus": "done",
            "configuredProvider": "openai-codex",
            "configuredModel": "gpt-5.6-sol",
            "hermesRunId": "attempt-two",
            "hermesTasks": [{
                "taskId": "root-one",
                "status": "done",
            }],
            "finalResult": "Final answer",
        },
    )
    settled: list[dict[str, Any]] = []
    monkeypatch.setattr(
        mag_one_operation,
        "_settle_terminal_result",
        lambda run_id, result, metrics: settled.append({
            "runId": run_id,
            "result": result,
            "metrics": metrics,
        }) or {**result, "runId": run_id, "outerRunSettled": True},
    )

    result = mag_one_operation.reconcile_magnetic_taskgraph_run(
        "run-one", "root-one",
    )

    assert result["runId"] == "run-one"
    assert result["outerRunSettled"] is True
    assert settled[0]["result"]["hermesRootId"] == "root-one"
    assert settled[0]["metrics"] == {
        "tasksCompleted": 1,
        "tasksTotal": 1,
        "activeWorkers": 0,
    }
