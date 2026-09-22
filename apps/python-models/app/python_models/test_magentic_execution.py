from __future__ import annotations

import builtins
from typing import Any

import pytest

from app.python_models import idf as idf_module
from app.python_models import magentic_execution


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
            "nativeIdentity": "card_magentic",
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
    return payload


@pytest.fixture
def native_task_store(tmp_path, monkeypatch):
    magentic_execution._runtime_paths()
    from hermes_cli import kanban_db_connect as task_db_connect

    db_path = tmp_path / "tasks.db"
    task_db_connect.init_db(db_path)
    monkeypatch.setattr(magentic_execution, "_task_db_path", lambda: db_path)
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
            "kanbanMission": mission or "Exact mission from the retained IDF.",
        },
    )
    monkeypatch.setattr(
        magentic_execution,
        "_ensure_orchestrator_identity",
        lambda _spec, _workers: (
            "card_magentic", "openai-codex", "gpt-5.6-sol", "codex_app_server",
        ),
    )
    return captured


def test_orchestrator_identity_resolves_the_repository_profile_tree(
    tmp_path, monkeypatch,
) -> None:
    magentic_execution._runtime_paths()
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
        magentic_execution,
        "_runtime_paths",
        lambda: (hermes_root, hermes_home),
    )

    assert magentic_execution._ensure_orchestrator_identity(
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
    magentic_execution._runtime_paths()
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
        magentic_execution,
        "_runtime_paths",
        lambda: (hermes_root, hermes_home),
    )

    with pytest.raises(
        magentic_execution.MagenticExecutionError,
        match="magentic_orchestrator_materialization_mismatch",
    ):
        magentic_execution._ensure_orchestrator_identity(
            _execution_payload()["orchestrator"],
            [_execution_payload()["workers"][0]],
        )


def test_submit_uses_reloaded_idf_and_creates_one_idempotent_bounded_root(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    captured = _stub_retained_input(monkeypatch)
    payload = _execution_payload()
    payload["notifySession"] = {
        "sessionKey": "main-stored-session",
        "profile": "liquidaity-main",
    }
    first = magentic_execution.submit_magentic_execution(payload)
    second = magentic_execution.submit_magentic_execution(payload)

    assert captured == {
        "project_id": "project-one",
        "deck_id": "deck-one",
        "run_id": "run-one",
        "card_id": "card_magentic",
    }
    assert second["nativeRootId"] == first["nativeRootId"]
    assert first == {
        "ok": True,
        "runId": "run-one",
        "nativeRootId": first["nativeRootId"],
        "nativeIdentity": "card_magentic",
        "effectiveProvider": "openai-codex",
        "providerApiMode": "codex_app_server",
        "model": "gpt-5.6-sol",
        "tenant": "mag-one:run-one",
        "state": "running",
        "nativeStatus": "ready",
        "nativeNotification": True,
    }
    with task_db_connect.connect_closing(native_task_store) as connection:
        root = task_db.get_task(connection, first["nativeRootId"])
        assert root is not None
        assert root.allowed_assignees == ["card_magentic", "worker-a", "worker-b"]
        assert root.assignee == "card_magentic"
        assert root.tenant == "mag-one:run-one"
        assert root.model_override == "gpt-5.6-sol"
        assert root.provider_override == "openai-codex"
        assert root.session_id == "main-stored-session"
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


def test_team_only_bypasses_magnetic_model_and_uses_the_same_team_root(
    native_task_store, tmp_path, monkeypatch,
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
        magentic_execution, "_runtime_paths", lambda: (hermes_root, hermes_home),
    )

    def magnetic_model_must_not_run(*_args, **_kwargs):
        raise AssertionError("Team-only execution must bypass the Magnetic model")

    monkeypatch.setattr(
        magentic_execution, "_ensure_orchestrator_identity", magnetic_model_must_not_run,
    )
    payload = _team_execution_payload()
    payload["notifySession"] = {
        "sessionKey": "main-stored-session",
        "profile": "liquidaity-main",
    }

    result = magentic_execution.submit_magentic_execution(payload)

    assert result == {
        "ok": True,
        "runId": "run-one",
        "nativeRootId": result["nativeRootId"],
        "nativeIdentity": "team",
        "effectiveProvider": "openai-codex",
        "providerApiMode": "codex_app_server",
        "model": "gpt-5.6-terra",
        "tenant": "mag-one:run-one",
        "state": "running",
        "nativeStatus": "triage",
        "nativeNotification": True,
    }
    with task_db_connect.connect_closing(native_task_store) as connection:
        root = task_db.get_task(connection, result["nativeRootId"])
        assert root is not None
        assert root.assignee == "team"
        assert root.created_by == "card_magentic"
        assert root.allowed_assignees == ["team"]
        assert root.workflow_template_id == TEAM_WORKFLOW_ID
        assert root.current_step_key == TEAM_DECOMPOSITION_STEP
        assert root.model_override == "gpt-5.6-terra"
        assert root.provider_override == "openai-codex"
        assert root.body == "Exact mission from the retained IDF."
        assert root.session_id == "main-stored-session"
        subscriptions = connection.execute(
            "SELECT platform, chat_id, notifier_profile FROM kanban_notify_subs "
            "WHERE task_id = ?",
            (root.id,),
        ).fetchall()
        assert [tuple(row) for row in subscriptions] == [
            ("tui", "main-stored-session", "liquidaity-main"),
        ]


def test_team_marker_cannot_be_applied_to_another_worker(monkeypatch) -> None:
    payload = _execution_payload()
    payload["workers"][0]["teamTaskMode"] = True
    _stub_retained_input(monkeypatch)

    with pytest.raises(
        magentic_execution.MagenticExecutionError,
        match="magentic_team_identity_invalid:worker-card-a",
    ):
        magentic_execution.submit_magentic_execution(payload)
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE idempotency_key = ?",
            ("magentic:run-one:root",),
        ).fetchone()["count"] == 1
        subscription = connection.execute(
            "SELECT platform, chat_id, notifier_profile FROM kanban_notify_subs WHERE task_id = ?",
            (first["nativeRootId"],),
        ).fetchone()
        assert dict(subscription) == {
            "platform": "tui",
            "chat_id": "main-stored-session",
            "notifier_profile": "liquidaity-main",
        }


def test_submit_rejects_transport_mission_that_differs_from_reloaded_idf(
    native_task_store, monkeypatch,
) -> None:
    _stub_retained_input(monkeypatch, mission="Mission held by retained bytes.")

    with pytest.raises(
        magentic_execution.MagenticExecutionError,
        match="magentic_mission_input_mismatch",
    ):
        magentic_execution.submit_magentic_execution(_execution_payload())


def _submit_root(monkeypatch) -> str:
    _stub_retained_input(monkeypatch)
    return magentic_execution.submit_magentic_execution(
        _execution_payload(),
    )["nativeRootId"]


def test_same_root_waits_on_native_dependencies_then_returns_its_own_final_result(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
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
        assert not task_db.link_tasks(connection, parent_id=worker_a, child_id=root_id)
        assert not task_db.link_tasks(connection, parent_id=worker_b, child_id=root_id)
        assert task_db.block_task(
            connection, root_id, reason="Waiting for the selected workers.",
            kind="dependency", expected_run_id=first_run_id,
        )
        assert task_db.get_task(connection, root_id).status == "todo"

    waiting = magentic_execution.read_magentic_execution({"nativeRootId": root_id})
    assert waiting["state"] == "running"
    assert waiting["nativeStatus"] == "todo"
    assert waiting["nativeRunId"] == first_run_id
    assert waiting["nativeTasks"] == [
        {
            "taskId": root_id,
            "title": "Mag One run-one",
            "assignee": "card_magentic",
            "status": "todo",
            "dependencyIds": sorted([worker_a, worker_b]),
            "latestAttempt": {
                "runId": first_run_id,
                "status": "blocked",
                "startedAt": waiting["nativeTasks"][0]["latestAttempt"]["startedAt"],
                "endedAt": waiting["nativeTasks"][0]["latestAttempt"]["endedAt"],
            },
            "resultAvailable": True,
        },
        {
            "taskId": worker_a,
            "title": "Worker A task",
            "assignee": "worker-a",
            "status": "ready",
            "dependencyIds": [],
            "latestAttempt": None,
            "resultAvailable": False,
        },
        {
            "taskId": worker_b,
            "title": "Worker B task",
            "assignee": "worker-b",
            "status": "ready",
            "dependencyIds": [],
            "latestAttempt": None,
            "resultAvailable": False,
        },
    ]

    with task_db_connect.connect_closing(native_task_store) as connection:
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

    status = magentic_execution.read_magentic_execution({"nativeRootId": root_id})
    assert status["state"] == "completed"
    assert status["nativeStatus"] == "done"
    assert status["nativeRootId"] == root_id
    assert status["nativeRunId"] == second_run_id
    assert status["finalResult"] == "The real synthesized answer."
    assert status["effectiveProvider"] == "openai-codex"
    assert status["model"] == "gpt-5.6-sol"
    assert status["nativeTasks"][0] == {
        "taskId": root_id,
        "title": "Mag One run-one",
        "assignee": "card_magentic",
        "status": "done",
        "dependencyIds": sorted([worker_a, worker_b]),
        "latestAttempt": {
            "runId": second_run_id,
            "status": "done",
            "startedAt": status["nativeTasks"][0]["latestAttempt"]["startedAt"],
            "endedAt": status["nativeTasks"][0]["latestAttempt"]["endedAt"],
        },
        "resultAvailable": True,
    }
    assert [task["resultAvailable"] for task in status["nativeTasks"]] == [True, True, True]
    assert "finalTaskId" not in status
    assert "tasksTotal" not in status
    assert "tasksCompleted" not in status
    assert "activeWorkers" not in status


def test_completed_root_without_its_own_result_fails_closed(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        assert task_db.complete_task(connection, root_id)

    status = magentic_execution.read_magentic_execution({"nativeRootId": root_id})
    assert status["state"] == "failed"
    assert status["nativeStatus"] == "done"
    assert status["error"] == "magentic_final_result_missing"


def test_native_allowed_assignees_reject_an_unwired_profile(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        with pytest.raises(ValueError, match="outside this execution's allowed assignees"):
            task_db.create_task(
                connection, title="Ungrantable task", assignee="worker-c",
                created_by="card_magentic", creator_task_id=root_id,
                initial_status="running",
            )


def test_stop_archives_only_the_exact_execution_creator_tree(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        child_id = task_db.create_task(
            connection, title="Worker task", assignee="worker-a", creator_task_id=root_id,
        )
        nested_id = task_db.create_task(
            connection, title="Nested task", assignee="worker-a", creator_task_id=child_id,
        )
        unrelated_id = task_db.create_task(
            connection, title="Unrelated native task", assignee="unrelated",
        )

    stopped = magentic_execution.stop_magentic_execution({"nativeRootId": root_id})
    assert stopped == {
        "ok": True,
        "nativeRootId": root_id,
        "state": "cancelled",
        "nativeStatus": "archived",
    }
    with task_db_connect.connect_closing(native_task_store) as connection:
        assert task_db.get_task(connection, root_id).status == "archived"
        assert task_db.get_task(connection, child_id).status == "archived"
        assert task_db.get_task(connection, nested_id).status == "archived"
        assert task_db.get_task(connection, unrelated_id).status == "ready"


def test_status_and_stop_resolve_the_task_store_before_importing_hermes(
    native_task_store, monkeypatch,
) -> None:
    root_id = _submit_root(monkeypatch)
    original_import = builtins.__import__
    path_resolved = False

    def cold_task_path():
        nonlocal path_resolved
        path_resolved = True
        return native_task_store

    def guarded_import(name, *args, **kwargs):
        if name == "hermes_cli" or name.startswith("hermes_cli."):
            assert path_resolved, f"Hermes import preceded task-store resolution: {name}"
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(magentic_execution, "_task_db_path", cold_task_path)
    monkeypatch.setattr(builtins, "__import__", guarded_import)

    status = magentic_execution.read_magentic_execution({"nativeRootId": root_id})
    assert status["nativeRootId"] == root_id
    assert len(status["nativeTasks"]) == 1

    path_resolved = False
    stopped = magentic_execution.stop_magentic_execution({"nativeRootId": root_id})
    assert stopped["state"] == "cancelled"
