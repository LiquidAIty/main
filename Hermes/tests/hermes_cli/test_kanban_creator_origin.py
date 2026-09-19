"""All explicit creator paths share durable lineage without graph coupling."""
import pytest


@pytest.mark.parametrize("surface", ["db", "builtin", "cli"])
def test_creator_origin_survives_without_dependency_parent(tmp_path, monkeypatch, capsys, surface):
    from hermes_cli import kanban_db as kb, kanban_db_connect as kbc, kanban_db_notify as kn
    from hermes_cli.kanban_db_graph import decompose_triage_task

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.delenv("HERMES_KANBAN_TASK", raising=False)
    kb.init_db()
    with kbc.connect_closing() as conn:
        owner = kb.create_task(conn, title="owner", session_id="durable", triage=True)
        kn.add_notify_sub(conn, task_id=owner, platform="telegram", chat_id="chat",
                         delivery_mode="wake", notifier_profile="default")
        if surface == "builtin":
            tid = decompose_triage_task(conn, owner, root_assignee="default",
                                       children=[{"title": "child"}])[0]
        elif surface == "db":
            tid = kb.create_task(conn, title="child", creator_task_id=owner)
        else:
            import json
            import argparse
            from hermes_cli.kanban import kanban_command
            from hermes_cli.kanban_parser import build_parser
            parser = argparse.ArgumentParser()
            build_parser(parser.add_subparsers())
            monkeypatch.setenv("HERMES_KANBAN_TASK", owner)
            assert kanban_command(parser.parse_args(["kanban", "create", "child", "--json"])) == 0
            tid = json.loads(capsys.readouterr().out)["id"]
        assert kb.get_task(conn, tid).session_id == "durable"
        subs = kn.list_notify_subs(conn, tid)
        assert len(subs) == 1 and subs[0]["delivery_mode"] == "wake"
        assert not conn.execute("SELECT 1 FROM task_links WHERE child_id = ?", (tid,)).fetchone()
        # No ambient identity guessing in the storage API.
        plain = kb.create_task(conn, title="plain", session_id="explicit")
        assert kb.get_task(conn, plain).session_id == "explicit"
        assert not kn.list_notify_subs(conn, plain)


def test_creator_task_inherits_and_enforces_allowed_assignees(tmp_path, monkeypatch):
    from hermes_cli import kanban_db as kb, kanban_db_connect as kbc

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    kb.init_db()
    with kbc.connect_closing() as conn:
        root = kb.create_task(
            conn,
            title="root",
            assignee="orchestrator",
            allowed_assignees=["orchestrator", "worker-a", "worker-b", "worker-a"],
        )
        assert kb.get_task(conn, root).allowed_assignees == [
            "orchestrator", "worker-a", "worker-b",
        ]

        child = kb.create_task(
            conn,
            title="allowed child",
            assignee="worker-a",
            creator_task_id=root,
        )
        assert kb.get_task(conn, child).allowed_assignees == [
            "orchestrator", "worker-a", "worker-b",
        ]

        with pytest.raises(ValueError, match="outside this execution's allowed assignees"):
            kb.create_task(
                conn,
                title="foreign child",
                assignee="unwired-worker",
                creator_task_id=root,
            )
        assert conn.execute(
            "SELECT 1 FROM tasks WHERE title = 'foreign child'",
        ).fetchone() is None

        with pytest.raises(ValueError, match="cannot change its inherited"):
            kb.create_task(
                conn,
                title="widened child",
                assignee="worker-a",
                creator_task_id=root,
                allowed_assignees=["orchestrator", "worker-a", "worker-b", "unwired-worker"],
            )

        with pytest.raises(ValueError, match="outside this execution's allowed assignees"):
            kb.assign_task(conn, child, "unwired-worker")
        assert kb.get_task(conn, child).assignee == "worker-a"
        assert kb.assign_task(conn, child, "worker-b") is True
        assert kb.get_task(conn, child).assignee == "worker-b"

        with pytest.raises(ValueError, match="outside this execution's allowed assignees"):
            kb.request_review(conn, child, reviewer="unwired-reviewer")
        assert kb.get_task(conn, child).status == "ready"
        assert kb.get_task(conn, child).assignee == "worker-b"


def test_allowed_assignees_null_preserves_existing_behavior(tmp_path, monkeypatch):
    from hermes_cli import kanban_db as kb, kanban_db_connect as kbc

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    kb.init_db()
    with kbc.connect_closing() as conn:
        root = kb.create_task(conn, title="ordinary root", assignee="one")
        child = kb.create_task(
            conn,
            title="ordinary child",
            assignee="any-existing-assignee",
            creator_task_id=root,
        )
        assert kb.get_task(conn, root).allowed_assignees is None
        assert kb.get_task(conn, child).allowed_assignees is None


def test_bounded_triage_decomposition_cannot_escape_and_inherits_the_ceiling(
    tmp_path, monkeypatch,
):
    from hermes_cli import kanban_db as kb, kanban_db_connect as kbc
    from hermes_cli.kanban_db_graph import decompose_triage_task

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    kb.init_db()
    with kbc.connect_closing() as conn:
        root = kb.create_task(
            conn,
            title="bounded triage root",
            assignee="orchestrator",
            triage=True,
            allowed_assignees=["orchestrator", "worker-a"],
        )
        with pytest.raises(ValueError, match="outside this execution's allowed assignees"):
            decompose_triage_task(
                conn,
                root,
                root_assignee="orchestrator",
                children=[{"title": "foreign child", "assignee": "unwired-worker"}],
            )
        assert kb.get_task(conn, root).status == "triage"

        child_ids = decompose_triage_task(
            conn,
            root,
            root_assignee="orchestrator",
            children=[{"title": "allowed child", "assignee": "worker-a"}],
            auto_promote=False,
        )
        assert child_ids and len(child_ids) == 1
        child = kb.get_task(conn, child_ids[0])
        assert child is not None
        assert child.allowed_assignees == ["orchestrator", "worker-a"]
        created = next(event for event in kb.list_events(conn, child.id) if event.kind == "created")
        assert created.payload["creator_task_id"] == root
