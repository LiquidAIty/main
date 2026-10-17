from __future__ import annotations

import json

from hermes_cli import taskgraph_adapter


def _stage_request() -> dict:
    return {
        "action": "stage_root",
        "runId": "run-one",
        "profile": "card_magentic",
        "provider": "openai-codex",
        "model": "gpt-5.6-sol",
        "tenant": "mag-one:run-one",
        "title": "Mag One run-one",
        "body": "Complete one bounded mission.",
        "workerProfiles": ["builder", "team"],
        "workerAuthorities": [
            {"cardId": "builder", "cardRevisionId": "revision-builder", "profile": "builder"},
            {"cardId": "card_team", "cardRevisionId": "revision-team", "profile": "team"},
        ],
        "createdBy": "card_magentic",
        "directTeam": False,
    }


def test_stage_activate_and_read_use_one_existing_kanban_root(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(taskgraph_adapter, "_hermes_home", lambda: home)

    staged = taskgraph_adapter.stage_root(_stage_request())
    root_id = staged["root"]["taskId"]

    assert staged["root"] == {
        "taskId": root_id,
        "title": "Mag One run-one",
        "body": "Complete one bounded mission.",
        "assignee": "card_magentic",
        "createdBy": "card_magentic",
        "status": "blocked",
        "tenant": "mag-one:run-one",
        "provider": "openai-codex",
        "model": "gpt-5.6-sol",
        "allowedAssignees": ["card_magentic", "builder", "team"],
    }

    activated = taskgraph_adapter.activate_root({
        "action": "activate_root",
        "rootId": root_id,
        "directTeam": False,
    })
    assert activated["root"]["taskId"] == root_id
    assert activated["root"]["status"] in {"todo", "ready", "running"}

    readback = taskgraph_adapter.read_root({"action": "read_root", "rootId": root_id})
    assert readback["root"]["taskId"] == root_id
    assert [task["taskId"] for task in readback["tasks"]] == [root_id]

    from hermes_cli import kanban_db, kanban_db_connect

    with kanban_db_connect.connect_closing(home / "kanban.db") as connection:
        events = connection.execute(
            "SELECT payload FROM task_events WHERE task_id = ? AND kind = ?",
            (root_id, taskgraph_adapter.AUTHORITY_EVENT),
        ).fetchall()
    assert len(events) == 1
    assert json.loads(events[0]["payload"]) == {
        "workers": _stage_request()["workerAuthorities"],
    }


def test_duplicate_stage_is_idempotent_and_rejects_authority_drift(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(taskgraph_adapter, "_hermes_home", lambda: home)
    request = _stage_request()

    first = taskgraph_adapter.stage_root(request)
    second = taskgraph_adapter.stage_root(request)

    assert second["root"]["taskId"] == first["root"]["taskId"]
    changed = {
        **request,
        "workerAuthorities": [
            {"cardId": "builder", "cardRevisionId": "changed", "profile": "builder"},
            request["workerAuthorities"][1],
        ],
    }
    try:
        taskgraph_adapter.stage_root(changed)
    except taskgraph_adapter.TaskGraphAdapterError as error:
        assert str(error) == "worker_authority_binding_mismatch"
    else:
        raise AssertionError("authority drift was accepted")
