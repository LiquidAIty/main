"""Focused proof for the wire-reduced Magnetic taskgraph."""

import json
from pathlib import Path

import pytest

from hermes_cli import kanban_db as kb
from hermes_cli import kanban_db_connect as kbc


MAGNETIC = "card_magentic"
WORKERS = ["worker-a", "worker-b"]


def _profile(
    home: Path,
    name: str,
    *,
    mode: str = "",
    roster: list[str] | None = None,
) -> Path:
    path = home / "profiles" / name
    path.mkdir(parents=True, exist_ok=True)
    (path / "config.yaml").write_text(
        "model:\n"
        "  provider: openai-codex\n"
        "  default: gpt-5.6-sol\n"
        "kanban:\n"
        + (f"  task_mode: {mode}\n" if mode else "")
        + ("bot_mode:\n  roster:\n" + "".join(
            f"    - {worker}\n" for worker in roster
        ) if roster is not None else ""),
        encoding="utf-8",
    )
    return path


@pytest.fixture
def magnetic_board(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    db_path = home / "kanban.db"
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_KANBAN_DB", str(db_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    kbc._INITIALIZED_PATHS.clear()
    kbc.init_db(db_path)
    magnetic_home = _profile(home, MAGNETIC, mode="magnetic", roster=WORKERS)
    for worker in WORKERS:
        _profile(home, worker)
    return db_path, magnetic_home


def test_blue_roster_is_the_complete_assignment_ceiling(magnetic_board):
    from hermes_cli.kanban_magnetic import (
        activate_staged_magnetic_root,
        create_magnetic_root,
    )

    db_path, magnetic_home = magnetic_board
    with kbc.connect_closing(db_path) as conn:
        root = create_magnetic_root(
            conn,
            assignee=MAGNETIC,
            worker_profiles=WORKERS,
            profile_home=magnetic_home,
            title="Approved mission",
            body="Run the exact bounded mission.",
            created_by="message_agent:main",
            session_id="main-session",
        )
        assert root.status == "blocked"
        assert root.allowed_assignees == [MAGNETIC, *WORKERS]
        assert activate_staged_magnetic_root(conn, root.id) is True
        assert kb.get_task(conn, root.id).status == "ready"

        child = kb.create_task(
            conn,
            title="Worker A",
            assignee="worker-a",
            creator_task_id=root.id,
        )
        assert kb.get_task(conn, child).allowed_assignees == ["worker-a"]
        with pytest.raises(ValueError, match="outside this execution's allowed assignees"):
            kb.create_task(
                conn,
                title="Unwired worker",
                assignee="worker-c",
                creator_task_id=root.id,
            )


def test_missing_or_duplicate_blue_workers_fail_before_root_creation(magnetic_board):
    from hermes_cli.kanban_magnetic import create_magnetic_root

    db_path, magnetic_home = magnetic_board
    base = dict(
        assignee=MAGNETIC,
        profile_home=magnetic_home,
        title="Approved mission",
        body="Run the exact bounded mission.",
        created_by="message_agent:main",
        session_id="main-session",
    )
    with kbc.connect_closing(db_path) as conn:
        with pytest.raises(ValueError, match="at least one blue-wire worker"):
            create_magnetic_root(conn, worker_profiles=[], **base)
        with pytest.raises(ValueError, match="duplicate"):
            create_magnetic_root(
                conn,
                worker_profiles=["worker-a", "worker-a"],
                **base,
            )
        with pytest.raises(ValueError, match="not live"):
            create_magnetic_root(conn, worker_profiles=["worker-c"], **base)
        assert conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE title = 'Approved mission'"
        ).fetchone()[0] == 0


def test_ordinary_hermes_tasks_remain_unrestricted(magnetic_board):
    db_path, _magnetic_home = magnetic_board
    with kbc.connect_closing(db_path) as conn:
        ordinary = kb.create_task(conn, title="Ordinary", assignee="worker-a")
        assert kb.get_task(conn, ordinary).allowed_assignees is None


def test_public_kanban_create_admits_magnetic_from_the_saved_bot_roster(
    magnetic_board, monkeypatch,
):
    from hermes_cli.kanban_magnetic import MAGNETIC_WORKFLOW_ID
    from tools import kanban_tools

    db_path, magnetic_home = magnetic_board
    monkeypatch.setenv("HERMES_HOME", str(magnetic_home))
    monkeypatch.setattr(kanban_tools, "_persisted_session_id", lambda value: value)
    monkeypatch.setattr(kanban_tools, "_persisted_identity", lambda: "liquidaity-plugin")
    monkeypatch.setattr(kanban_tools, "_maybe_auto_subscribe", lambda _conn, _task: True)

    result = json.loads(kanban_tools._handle_create({
        "title": "Magnetic mission",
        "body": "Run one bounded mission.",
        "assignee": MAGNETIC,
        "workspace_kind": "scratch",
        "project": "",
        "session_id": "main-session",
        "idempotency_key": "tool-call-one",
    }))

    assert result["ok"] is True
    assert result["subscribed"] is True
    with kbc.connect_closing(db_path) as conn:
        root = kb.get_task(conn, result["task_id"])
    assert root is not None
    assert root.status == "ready"
    assert root.workflow_template_id == MAGNETIC_WORKFLOW_ID
    assert root.allowed_assignees == [MAGNETIC, *WORKERS]
    assert root.session_id == "main-session"


def test_magnetic_root_is_idempotent_and_cannot_assign_itself_as_a_child(
    magnetic_board,
):
    from hermes_cli.kanban_db_graph import decompose_triage_task
    from hermes_cli.kanban_magnetic import (
        activate_staged_magnetic_root,
        create_magnetic_root,
    )

    db_path, magnetic_home = magnetic_board
    kwargs = {
        "assignee": MAGNETIC,
        "worker_profiles": WORKERS,
        "profile_home": magnetic_home,
        "title": "Approved mission",
        "body": "Run the exact bounded mission.",
        "created_by": "liquidaity-plugin",
        "session_id": "main-session",
        "idempotency_key": "same-bot-tool-call",
    }
    with kbc.connect_closing(db_path) as conn:
        root = create_magnetic_root(conn, **kwargs)
        assert activate_staged_magnetic_root(conn, root.id) is True
        repeated = create_magnetic_root(conn, **kwargs)
        assert repeated.id == root.id
        assert repeated.status == "ready"
        assert conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 1

        with pytest.raises(ValueError, match="assignment is immutable"):
            kb.assign_task(conn, root.id, "worker-a")
        with pytest.raises(ValueError, match="self-assigned child"):
            kb.create_task(
                conn,
                title="Invalid nested orchestrator",
                assignee=MAGNETIC,
                creator_task_id=root.id,
            )

        conn.execute("UPDATE tasks SET status = 'triage' WHERE id = ?", (root.id,))
        conn.commit()
        with pytest.raises(ValueError, match="self-assigned child"):
            decompose_triage_task(
                conn,
                root.id,
                root_assignee=MAGNETIC,
                children=[{"title": "Invalid", "assignee": MAGNETIC}],
            )
