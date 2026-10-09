from __future__ import annotations

from typing import Any

import pytest

from app.python_models import idf as idf_module
from app.python_models import magnetic_taskgraph


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
                "configurationFingerprint": "a" * 64,
            },
            {
                "cardId": "worker-card-b",
                "cardRevisionId": "worker-revision-b",
                "profile": "worker-b",
                "configurationFingerprint": "b" * 64,
            },
        ],
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
        "configurationFingerprint": "c" * 64,
    }]
    return payload


def test_worker_scope_includes_only_compact_project_eligible_capability_metadata() -> None:
    workers = _execution_payload()["workers"]
    workers[0]["capabilities"] = {
        "savedToolIds": ["weather.read", "ais.history"],
        "projectEligibleToolIds": ["weather.read"],
    }

    identities, scope = magnetic_taskgraph._worker_scope(workers)

    assert identities == ["worker-a", "worker-b"]
    assert "Project-eligible tools: weather.read" in scope
    assert "ais.history" not in scope
    assert "Project-eligible tools" not in scope.splitlines()[1]


def test_worker_scope_rejects_project_capabilities_not_owned_by_the_saved_card() -> None:
    workers = _execution_payload()["workers"]
    workers[0]["capabilities"] = {
        "savedToolIds": ["weather.read"],
        "projectEligibleToolIds": ["ais.history"],
    }

    with pytest.raises(
        magnetic_taskgraph.MagneticTaskGraphError,
        match="magnetic_taskgraph_worker_capabilities_invalid",
    ):
        magnetic_taskgraph._worker_scope(workers)


@pytest.fixture
def hermes_task_store(tmp_path, monkeypatch):
    magnetic_taskgraph._runtime_paths()
    from hermes_cli import kanban_db_connect as task_db_connect

    db_path = tmp_path / "tasks.db"
    task_db_connect.init_db(db_path)
    monkeypatch.setattr(magnetic_taskgraph, "_task_db_path", lambda: db_path)
    return db_path


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
        magnetic_taskgraph,
        "_ensure_orchestrator_identity",
        lambda _spec, _workers: (
            "card_magentic", "openai-codex", "gpt-5.6-sol", "codex_app_server",
        ),
    )
    monkeypatch.setattr(
        magnetic_taskgraph,
            "_bind_outer_magnetic_taskgraph_run",
        lambda run_id, hermes_root_id, _status: {
            "ok": True,
            "runId": run_id,
            "hermesRootId": hermes_root_id,
            "updated": True,
        },
    )
    return captured


def test_orchestrator_identity_resolves_the_repository_profile_tree(
    tmp_path, monkeypatch,
) -> None:
    magnetic_taskgraph._runtime_paths()
    hermes_root = tmp_path / "Hermes"
    hermes_home = hermes_root / ".hermes"
    orchestrator_home = hermes_home / "profiles" / "card_magentic"
    worker_home = hermes_home / "profiles" / "worker-a"
    orchestrator_home.mkdir(parents=True)
    worker_home.mkdir(parents=True)
    orchestrator_home.joinpath("config.yaml").write_text(
        "model:\n"
        "  provider: openai-codex\n"
        "  default: gpt-5.6-sol\n",
        encoding="utf-8",
    )
    orchestrator_home.joinpath("SOUL.md").write_text(
        "Coordinate the connected Cards.",
        encoding="utf-8",
    )
    worker_home.joinpath("config.yaml").write_text("model: {}\n", encoding="utf-8")
    monkeypatch.setattr(
        magnetic_taskgraph,
        "_runtime_paths",
        lambda: (hermes_root, hermes_home),
    )

    assert magnetic_taskgraph._ensure_orchestrator_identity(
        _execution_payload()["orchestrator"],
        [_execution_payload()["workers"][0]],
    ) == ("card_magentic", "openai-codex", "gpt-5.6-sol", "codex_app_server")


@pytest.mark.parametrize(
    ("soul", "agent_config"),
    [
        ("Wrong instructions.", ""),
        (
            "Coordinate the connected Cards.",
            "agent:\n  system_prompt: Coordinate the connected Cards.\n",
        ),
    ],
)
def test_orchestrator_identity_rejects_duplicate_or_mismatched_prompt_authority(
    tmp_path, monkeypatch, soul: str, agent_config: str,
) -> None:
    magnetic_taskgraph._runtime_paths()
    hermes_root = tmp_path / "Hermes"
    hermes_home = hermes_root / ".hermes"
    orchestrator_home = hermes_home / "profiles" / "card_magentic"
    worker_home = hermes_home / "profiles" / "worker-a"
    orchestrator_home.mkdir(parents=True)
    worker_home.mkdir(parents=True)
    orchestrator_home.joinpath("config.yaml").write_text(
        "model:\n"
        "  provider: openai-codex\n"
        "  default: gpt-5.6-sol\n"
        f"{agent_config}",
        encoding="utf-8",
    )
    orchestrator_home.joinpath("SOUL.md").write_text(soul, encoding="utf-8")
    worker_home.joinpath("config.yaml").write_text("model: {}\n", encoding="utf-8")
    monkeypatch.setattr(
        magnetic_taskgraph,
        "_runtime_paths",
        lambda: (hermes_root, hermes_home),
    )

    with pytest.raises(
        magnetic_taskgraph.MagneticTaskGraphError,
        match="magnetic_taskgraph_orchestrator_materialization_mismatch",
    ):
        magnetic_taskgraph._ensure_orchestrator_identity(
            _execution_payload()["orchestrator"],
            [_execution_payload()["workers"][0]],
        )


def test_submit_uses_reloaded_idf_and_creates_one_idempotent_bounded_root(
    hermes_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    captured = _stub_retained_input(monkeypatch)
    payload = _execution_payload()
    first = magnetic_taskgraph.submit_magnetic_taskgraph(payload)
    second = magnetic_taskgraph.submit_magnetic_taskgraph(payload)

    assert captured == {
        "project_id": "project-one",
        "deck_id": "deck-one",
        "run_id": "run-one",
        "card_id": "card_magentic",
    }
    assert second["hermesRootId"] == first["hermesRootId"]
    assert first == {
        "ok": True,
        "runId": "run-one",
        "hermesRootId": first["hermesRootId"],
        "hermesProfile": "card_magentic",
        "configuredProvider": "openai-codex",
        "configuredProviderApiMode": "codex_app_server",
        "configuredModel": "gpt-5.6-sol",
        "tenant": "mag-one:run-one",
        "state": "pending",
        "hermesStatus": "ready",
        "outerRunBound": True,
    }
    with task_db_connect.connect_closing(hermes_task_store) as connection:
        root = task_db.get_task(connection, first["hermesRootId"])
        assert root is not None
        assert root.allowed_assignees == ["card_magentic", "worker-a", "worker-b"]
        assert root.assignee == "card_magentic"
        assert root.tenant == "mag-one:run-one"
        assert root.model_override == "gpt-5.6-sol"
        assert root.provider_override == "openai-codex"
        assert root.session_id is None
        assert root.status == "ready"
        assert "Exact mission from the retained IDF." in (root.body or "")
        assert "First saved Card" in (root.body or "")
        assert "both the orchestration root and the final result task" in (root.body or "")
        assert "already approved this mission after upstream context engineering" in (root.body or "")
        assert "do not invent a replacement mission or another approval step" in (root.body or "")
        assert "initial_status=\"running\"" in (root.body or "")
        assert "parent of THIS root task" in (root.body or "")
        assert "kanban_block(kind=\"dependency\")" in (root.body or "")
        assert "root in todo while those parents are unfinished" in (root.body or "")
        assert "then promote it to ready" in (root.body or "")
        assert "Never complete an intermediate decomposition" in (root.body or "")
        assert "never create another task for final synthesis" in (root.body or "")
        assert "auto-decomposition, triage, goal mode, delegate_task" in (root.body or "")
        assert "never make one worker wait for another" in (root.body or "")
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE idempotency_key = ?",
            ("magentic:run-one:root",),
        ).fetchone()["count"] == 1
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM task_events WHERE task_id = ? AND kind = ?",
            (first["hermesRootId"], magnetic_taskgraph._HERMES_AUTHORITY_EVENT),
        ).fetchone()["count"] == 1


def test_team_only_bypasses_magnetic_model_and_uses_the_same_team_root(
    hermes_task_store, tmp_path, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect
    from hermes_cli.kanban_team import TEAM_DECOMPOSITION_STEP, TEAM_WORKFLOW_ID

    _stub_retained_input(monkeypatch)
    hermes_root = tmp_path / "Hermes"
    hermes_home = hermes_root / ".hermes"
    profile_home = hermes_home / "profiles" / "team"
    profile_home.mkdir(parents=True)
    profile_home.joinpath("config.yaml").write_text(
        "model:\n"
        "  provider: openai-codex\n"
        "  default: gpt-5.6-terra\n"
        "delegation:\n"
        "  provider: openai-codex\n"
        "  model: gpt-5.6-luna\n"
        "  reasoning_effort: high\n"
        "kanban:\n"
        "  task_mode: team\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        magnetic_taskgraph, "_runtime_paths", lambda: (hermes_root, hermes_home),
    )

    def magnetic_model_must_not_run(*_args, **_kwargs):
        raise AssertionError("Team-only execution must bypass the Magnetic model")

    monkeypatch.setattr(
        magnetic_taskgraph, "_ensure_orchestrator_identity", magnetic_model_must_not_run,
    )
    payload = _team_execution_payload()

    result = magnetic_taskgraph.submit_magnetic_taskgraph(payload)

    assert result == {
        "ok": True,
        "runId": "run-one",
        "hermesRootId": result["hermesRootId"],
        "hermesProfile": "team",
        "configuredProvider": "openai-codex",
        "configuredProviderApiMode": "codex_app_server",
        "configuredModel": "gpt-5.6-terra",
        "tenant": "mag-one:run-one",
        "state": "pending",
        "hermesStatus": "triage",
        "outerRunBound": True,
    }
    with task_db_connect.connect_closing(hermes_task_store) as connection:
        root = task_db.get_task(connection, result["hermesRootId"])
        assert root is not None
        assert root.assignee == "team"
        assert root.created_by == "card_magentic"
        assert root.allowed_assignees == ["team"]
        assert root.workflow_template_id == TEAM_WORKFLOW_ID
        assert root.current_step_key == TEAM_DECOMPOSITION_STEP
        assert root.model_override == "gpt-5.6-terra"
        assert root.provider_override == "openai-codex"
        assert root.body == "Exact mission from the retained IDF."
        assert root.session_id is None


def test_submit_rejoin_rejects_changed_immutable_worker_authority(
    hermes_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db_connect as task_db_connect

    _stub_retained_input(monkeypatch)
    payload = _execution_payload()
    first = magnetic_taskgraph.submit_magnetic_taskgraph(payload)
    changed = _execution_payload()
    changed["workerAuthorities"][0]["configurationFingerprint"] = "d" * 64

    with pytest.raises(
        magnetic_taskgraph.MagneticTaskGraphError,
        match="magnetic_taskgraph_worker_authority_binding_mismatch",
    ):
        magnetic_taskgraph.submit_magnetic_taskgraph(changed)

    with task_db_connect.connect_closing(hermes_task_store) as connection:
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE idempotency_key = ?",
            ("magentic:run-one:root",),
        ).fetchone()["count"] == 1
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM task_events WHERE task_id = ? AND kind = ?",
            (first["hermesRootId"], magnetic_taskgraph._HERMES_AUTHORITY_EVENT),
        ).fetchone()["count"] == 1


def test_submit_preserves_an_unbound_staged_root_for_exact_retry(
    hermes_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db_connect as task_db_connect

    _stub_retained_input(monkeypatch)
    monkeypatch.setattr(
        magnetic_taskgraph,
        "_bind_outer_magnetic_taskgraph_run",
        lambda *_args: (_ for _ in ()).throw(
            magnetic_taskgraph.MagneticTaskGraphError("magnetic_taskgraph_outer_run_binding_failed")
        ),
    )

    with pytest.raises(
        magnetic_taskgraph.MagneticTaskGraphError,
        match="magnetic_taskgraph_outer_run_binding_failed",
    ):
        magnetic_taskgraph.submit_magnetic_taskgraph(_execution_payload())
    with task_db_connect.connect_closing(hermes_task_store) as connection:
        staged = connection.execute(
            "SELECT id, status, current_run_id FROM tasks WHERE idempotency_key = ?",
            ("magentic:run-one:root",),
        ).fetchone()
        assert staged is not None
        assert staged["status"] == "blocked"
        assert staged["current_run_id"] is None
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM task_events WHERE task_id = ? AND kind = ?",
            (staged["id"], magnetic_taskgraph._HERMES_AUTHORITY_EVENT),
        ).fetchone()["count"] == 1


def test_submit_preserves_a_bound_staged_root_when_activation_fails_for_retry(
    hermes_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    _stub_retained_input(monkeypatch)
    promote_task = task_db.promote_task
    monkeypatch.setattr(task_db, "promote_task", lambda *_args, **_kwargs: (False, "injected"))

    with pytest.raises(
        magnetic_taskgraph.MagneticTaskGraphError,
        match="magnetic_taskgraph_hermes_root_activation_failed",
    ):
        magnetic_taskgraph.submit_magnetic_taskgraph(_execution_payload())
    with task_db_connect.connect_closing(hermes_task_store) as connection:
        staged = connection.execute(
            "SELECT id, status FROM tasks WHERE idempotency_key = ?",
            ("magentic:run-one:root",),
        ).fetchone()
        assert staged is not None and staged["status"] == "blocked"
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM task_events WHERE task_id = ? AND kind = ?",
            (staged["id"], magnetic_taskgraph._HERMES_AUTHORITY_EVENT),
        ).fetchone()["count"] == 1

    monkeypatch.setattr(task_db, "promote_task", promote_task)
    retried = magnetic_taskgraph.submit_magnetic_taskgraph(_execution_payload())
    assert retried["hermesRootId"] == staged["id"]
    assert retried["hermesStatus"] == "ready"


def test_team_marker_cannot_be_applied_to_another_worker(monkeypatch) -> None:
    payload = _execution_payload()
    payload["workers"][0]["teamTaskMode"] = True
    _stub_retained_input(monkeypatch)

    with pytest.raises(
        magnetic_taskgraph.MagneticTaskGraphError,
        match="magnetic_taskgraph_team_identity_invalid:worker-card-a",
    ):
        magnetic_taskgraph.submit_magnetic_taskgraph(payload)


def test_submit_rejects_transport_mission_that_differs_from_reloaded_idf(
    hermes_task_store, monkeypatch,
) -> None:
    _stub_retained_input(monkeypatch, mission="Mission held by retained bytes.")

    with pytest.raises(
        magnetic_taskgraph.MagneticTaskGraphError,
        match="magnetic_taskgraph_mission_input_mismatch",
    ):
        magnetic_taskgraph.submit_magnetic_taskgraph(_execution_payload())


def _submit_root(monkeypatch) -> str:
    _stub_retained_input(monkeypatch)
    return magnetic_taskgraph.submit_magnetic_taskgraph(
        _execution_payload(),
    )["hermesRootId"]


def test_same_root_waits_on_hermes_dependencies_then_returns_its_own_final_result(
    hermes_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(hermes_task_store) as connection:
        first_attempt = task_db.claim_task(connection, root_id, claimer="dispatcher:first")
        assert first_attempt is not None
        first_run_id = first_attempt.current_run_id
        worker_a = task_db.create_task(
            connection,
            title="Worker A task",
            assignee="worker-a",
            created_by="card_magentic",
            creator_task_id=root_id,
            initial_status="running",
        )
        worker_b = task_db.create_task(
            connection,
            title="Worker B task",
            assignee="worker-b",
            created_by="card_magentic",
            creator_task_id=root_id,
            initial_status="running",
        )
        assert not task_db.link_tasks(
            connection,
            parent_id=worker_a,
            child_id=root_id,
            expected_child_run_id=first_run_id,
        )
        assert not task_db.link_tasks(
            connection,
            parent_id=worker_b,
            child_id=root_id,
            expected_child_run_id=first_run_id,
        )
        assert task_db.block_task(
            connection, root_id, reason="Waiting for the selected workers.",
            kind="dependency", expected_run_id=first_run_id,
        )
        assert task_db.get_task(connection, root_id).status == "todo"

    waiting = magnetic_taskgraph.read_magnetic_taskgraph({"hermesRootId": root_id})
    assert waiting["state"] == "pending"
    assert waiting["hermesStatus"] == "todo"
    assert waiting["hermesRunId"] == first_run_id
    assert waiting["hermesTasks"] == [
        {
            "taskId": root_id,
            "title": "Mag One run-one",
            "assignee": "card_magentic",
            "status": "todo",
            "dependencyIds": sorted([worker_a, worker_b]),
            "latestAttempt": {
                "runId": first_run_id,
                "status": "blocked",
                "startedAt": waiting["hermesTasks"][0]["latestAttempt"]["startedAt"],
                "endedAt": waiting["hermesTasks"][0]["latestAttempt"]["endedAt"],
            },
            "resultAvailable": True,
            "handoffSummary": "Waiting for the selected workers.",
        },
        {
            "taskId": worker_a,
            "title": "Worker A task",
            "assignee": "worker-a",
            "status": "ready",
            "dependencyIds": [],
            "latestAttempt": None,
            "resultAvailable": False,
            "handoffSummary": None,
        },
        {
            "taskId": worker_b,
            "title": "Worker B task",
            "assignee": "worker-b",
            "status": "ready",
            "dependencyIds": [],
            "latestAttempt": None,
            "resultAvailable": False,
            "handoffSummary": None,
        },
    ]

    with task_db_connect.connect_closing(hermes_task_store) as connection:
        assert task_db.complete_task(
            connection, worker_a, summary="Worker A result", result="Worker A result",
        )
        assert task_db.get_task(connection, root_id).status == "todo"
        assert task_db.complete_task(
            connection, worker_b, summary="Worker B result", result="Worker B result",
        )
        assert task_db.get_task(connection, root_id).status == "ready"
        second_attempt = task_db.claim_task(connection, root_id, claimer="dispatcher:second")
        assert second_attempt is not None
        second_run_id = second_attempt.current_run_id
        context = task_db.build_worker_context(connection, root_id)
        assert "Worker A result" in context
        assert "Worker B result" in context
        assert task_db.complete_task(
            connection, root_id, summary="The real synthesized answer.",
            result="The real synthesized answer.",
            expected_run_id=second_run_id,
        )

    status = magnetic_taskgraph.read_magnetic_taskgraph({"hermesRootId": root_id})
    assert status["state"] == "completed"
    assert status["hermesStatus"] == "done"
    assert status["hermesRootId"] == root_id
    assert status["hermesRunId"] == second_run_id
    assert status["finalResult"] == "The real synthesized answer."
    assert status["configuredProvider"] == "openai-codex"
    assert status["configuredProviderApiMode"] == "codex_app_server"
    assert status["configuredModel"] == "gpt-5.6-sol"
    assert status["hermesTasks"][0] == {
        "taskId": root_id,
        "title": "Mag One run-one",
        "assignee": "card_magentic",
        "status": "done",
        "dependencyIds": sorted([worker_a, worker_b]),
        "latestAttempt": {
            "runId": second_run_id,
            "status": "done",
            "startedAt": status["hermesTasks"][0]["latestAttempt"]["startedAt"],
            "endedAt": status["hermesTasks"][0]["latestAttempt"]["endedAt"],
        },
        "resultAvailable": True,
        "handoffSummary": "The real synthesized answer.",
    }
    assert [task["resultAvailable"] for task in status["hermesTasks"]] == [True, True, True]
    assert "finalTaskId" not in status
    assert "tasksTotal" not in status
    assert "tasksCompleted" not in status
    assert "activeWorkers" not in status


def test_status_does_not_project_detached_worker_session_metadata(
    hermes_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(hermes_task_store) as connection:
        worker_id = task_db.create_task(
            connection,
            title="Worker task",
            assignee="worker-a",
            created_by="card_magentic",
            creator_task_id=root_id,
            initial_status="running",
        )
        claimed = task_db.claim_task(connection, worker_id, claimer="dispatcher:worker-a")
        assert claimed is not None
        assert task_db.complete_task(
            connection,
            worker_id,
            summary="Bounded handoff.",
            expected_run_id=claimed.current_run_id,
            metadata={"worker_session_id": 7},
        )

    status = magnetic_taskgraph.read_magnetic_taskgraph({"hermesRootId": root_id})
    worker = next(task for task in status["hermesTasks"] if task["taskId"] == worker_id)
    assert worker["handoffSummary"] == "Bounded handoff."
    assert "workerSessionId" not in worker
    assert "toolReceipts" not in worker
    assert "toolReceiptsComplete" not in worker


def test_completed_root_without_its_own_result_fails_closed(
    hermes_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(hermes_task_store) as connection:
        with pytest.raises(task_db.EmptyCompletionError):
            task_db.complete_task(connection, root_id)

    status = magnetic_taskgraph.read_magnetic_taskgraph({"hermesRootId": root_id})
    assert status["state"] == "pending"
    assert status["hermesStatus"] == "ready"
    assert "finalResult" not in status


def test_hermes_allowed_assignees_reject_an_unwired_profile(
    hermes_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(hermes_task_store) as connection:
        with pytest.raises(ValueError, match="outside this execution's allowed assignees"):
            task_db.create_task(
                connection, title="Ungrantable task", assignee="worker-c",
                created_by="card_magentic", creator_task_id=root_id,
                initial_status="running",
            )
