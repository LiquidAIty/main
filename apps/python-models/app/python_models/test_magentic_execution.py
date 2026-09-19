from __future__ import annotations

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


def test_submit_uses_reloaded_idf_and_creates_one_idempotent_bounded_root(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    captured = _stub_retained_input(monkeypatch)
    payload = _execution_payload()
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
        "state": "ready",
    }
    with task_db_connect.connect_closing(native_task_store) as connection:
        root = task_db.get_task(connection, first["nativeRootId"])
        assert root is not None
        assert root.allowed_assignees == ["card_magentic", "worker-a", "worker-b"]
        assert root.assignee == "card_magentic"
        assert root.tenant == "mag-one:run-one"
        assert root.model_override == "gpt-5.6-sol"
        assert root.provider_override == "openai-codex"
        assert "Exact mission from the retained IDF." in (root.body or "")
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE idempotency_key = ?",
            ("magentic:run-one:root",),
        ).fetchone()["count"] == 1


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


def test_status_returns_only_real_final_synthesis_from_native_dependency_graph(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        worker_a = task_db.create_task(
            connection,
            title="Worker A task",
            assignee="worker-a",
            created_by="card_magentic",
            creator_task_id=root_id,
        )
        worker_b = task_db.create_task(
            connection,
            title="Worker B task",
            assignee="worker-b",
            created_by="card_magentic",
            creator_task_id=root_id,
        )
        final_id = task_db.create_task(
            connection,
            title="Final synthesis",
            assignee="card_magentic",
            created_by="card_magentic",
            creator_task_id=root_id,
            parents=[worker_a, worker_b],
        )
        task_db.create_task(
            connection,
            title="Unrelated native task",
            assignee="unrelated",
        )
        assert task_db.complete_task(
            connection, worker_a, summary="Worker A result", result="Worker A result",
        )
        assert task_db.complete_task(
            connection, worker_b, summary="Worker B result", result="Worker B result",
        )
        assert task_db.complete_task(
            connection, final_id, summary="The real synthesized answer.",
            result="The real synthesized answer.",
        )
        assert task_db.complete_task(
            connection,
            root_id,
            summary="Decomposition complete.",
            result="Decomposition complete.",
            created_cards=[worker_a, worker_b, final_id],
        )

    status = magentic_execution.read_magentic_execution({"nativeRootId": root_id})
    assert status["state"] == "completed"
    assert status["nativePhase"] == "complete"
    assert status["finalTaskId"] == final_id
    assert status["finalResult"] == "The real synthesized answer."
    assert status["effectiveProvider"] == "openai-codex"
    assert status["model"] == "gpt-5.6-sol"
    assert "nativeRunId" not in status
    assert "tasksTotal" not in status
    assert "tasksCompleted" not in status
    assert "activeWorkers" not in status


def test_status_fails_closed_when_completed_root_has_no_unique_final_task(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        worker_a = task_db.create_task(
            connection, title="Worker A task", assignee="worker-a",
            created_by="card_magentic", creator_task_id=root_id,
        )
        worker_b = task_db.create_task(
            connection, title="Worker B task", assignee="worker-b",
            created_by="card_magentic", creator_task_id=root_id,
        )
        assert task_db.complete_task(connection, worker_a, summary="A")
        assert task_db.complete_task(connection, worker_b, summary="B")
        assert task_db.complete_task(
            connection,
            root_id,
            summary="Incorrectly complete",
            created_cards=[worker_a, worker_b],
        )

    status = magentic_execution.read_magentic_execution({"nativeRootId": root_id})
    assert status["state"] == "failed"
    assert status["nativePhase"] == "failed"
    assert status["error"] == "magentic_final_task_ambiguous"


def test_status_rejects_tasks_created_outside_the_orchestrator_root(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        worker_id = task_db.create_task(
            connection, title="Worker task", assignee="worker-a",
            created_by="card_magentic", creator_task_id=root_id,
        )
        final_id = task_db.create_task(
            connection, title="Final synthesis", assignee="card_magentic",
            created_by="card_magentic", creator_task_id=root_id, parents=[worker_id],
        )
        nested_id = task_db.create_task(
            connection, title="Unexpected nested task", assignee="worker-b",
            created_by="worker-a", creator_task_id=worker_id,
        )
        assert task_db.complete_task(connection, nested_id, summary="Nested")
        assert task_db.complete_task(connection, worker_id, summary="Worker")
        assert task_db.complete_task(connection, final_id, summary="Final")
        assert task_db.complete_task(
            connection, root_id, summary="Decomposed",
            created_cards=[worker_id, final_id],
        )

    status = magentic_execution.read_magentic_execution({"nativeRootId": root_id})
    assert status["state"] == "failed"
    assert status["error"] == "magentic_task_tree_invalid"


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
            connection, title="Nested task", assignee="worker-b", creator_task_id=child_id,
        )
        unrelated_id = task_db.create_task(
            connection, title="Unrelated native task", assignee="unrelated",
        )

    stopped = magentic_execution.stop_magentic_execution({"nativeRootId": root_id})
    assert stopped == {
        "ok": True,
        "nativeRootId": root_id,
        "state": "cancelled",
        "nativePhase": "cancelled",
    }
    with task_db_connect.connect_closing(native_task_store) as connection:
        assert task_db.get_task(connection, root_id).status == "archived"
        assert task_db.get_task(connection, child_id).status == "archived"
        assert task_db.get_task(connection, nested_id).status == "archived"
        assert task_db.get_task(connection, unrelated_id).status == "ready"
