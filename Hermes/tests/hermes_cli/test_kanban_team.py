"""Focused proof for the structural saved-profile Auto Team workflow."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from hermes_cli import kanban_db as kb
from hermes_cli import kanban_db_connect as kbc


TEAM_PROFILE = "team"
PARENT_PROVIDER = "openai-codex"
PARENT_MODEL = "gpt-5.6-terra"
WORKER_PROVIDER = "openai-codex"
WORKER_MODEL = "gpt-5.6-luna"


@pytest.fixture
def team_board(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    db_path = home / "kanban.db"
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_KANBAN_DB", str(db_path))
    monkeypatch.delenv("HERMES_KANBAN_TEAM_WORKER", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    kbc._INITIALIZED_PATHS.clear()
    kbc.init_db(db_path)
    _write_profile(home, TEAM_PROFILE, team=True)
    _write_profile(home, "ordinary", team=False)
    return db_path


def _write_profile(home: Path, name: str, *, team: bool, task_mode: str | None = None) -> Path:
    profile = home / "profiles" / name
    profile.mkdir(parents=True, exist_ok=True)
    mode = "team" if team else (task_mode or "")
    mode_yaml = f"  task_mode: {mode}\n" if mode else ""
    (profile / "config.yaml").write_text(
        "model:\n"
        f"  provider: {PARENT_PROVIDER}\n"
        f"  default: {PARENT_MODEL}\n"
        "delegation:\n"
        f"  provider: {WORKER_PROVIDER}\n"
        f"  model: {WORKER_MODEL}\n"
        "  reasoning_effort: high\n"
        "kanban:\n"
        f"{mode_yaml}",
        encoding="utf-8",
    )
    return profile


def _new_team_root(conn, **overrides):
    from hermes_cli.kanban_team import create_team_root

    kwargs = {
        "assignee": TEAM_PROFILE,
        "title": "Team mission",
        "body": "Inspect source and return one bounded report.",
        "created_by": "test",
        "allowed_assignees": [TEAM_PROFILE],
        "session_id": "session-1",
    }
    kwargs.update(overrides)
    return create_team_root(conn, **kwargs)


def test_profile_marker_is_exact_and_invalid_values_refuse_assignment(team_board):
    from hermes_cli.config_defaults import DEFAULT_CONFIG
    from hermes_cli.kanban_team import is_team_profile, profile_task_mode, team_profile_policy

    home = team_board.parent
    assert DEFAULT_CONFIG["kanban"]["task_mode"] == ""
    assert "team_worker_provider" not in DEFAULT_CONFIG["kanban"]
    assert "team_worker_model" not in DEFAULT_CONFIG["kanban"]
    assert "team_worker_reasoning_effort" not in DEFAULT_CONFIG["kanban"]
    assert profile_task_mode(TEAM_PROFILE) == "team"
    assert is_team_profile(TEAM_PROFILE) is True
    assert profile_task_mode("ordinary") is None
    assert is_team_profile("ordinary") is False
    assert team_profile_policy(TEAM_PROFILE) == {
        "profile": TEAM_PROFILE,
        "parent_provider": PARENT_PROVIDER,
        "parent_model": PARENT_MODEL,
        "worker_provider": WORKER_PROVIDER,
        "worker_model": WORKER_MODEL,
        "worker_reasoning": "high",
    }

    _write_profile(home, "invalid", team=False, task_mode="swarm")
    with pytest.raises(ValueError, match="unsupported kanban.task_mode"):
        profile_task_mode("invalid")
    with pytest.raises(RuntimeError, match="not configured"):
        team_profile_policy("ordinary")


def test_profile_resolution_honors_context_local_and_explicit_home(team_board, monkeypatch):
    from hermes_cli.kanban_team import create_team_root, profile_task_mode, team_profile_policy
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    alternate_root = team_board.parent.parent / "repository-hermes"
    alternate_root.mkdir()
    alternate_profile = _write_profile(alternate_root, "context-team", team=True)
    monkeypatch.delenv("HERMES_HOME", raising=False)

    token = set_hermes_home_override(alternate_root)
    try:
        assert profile_task_mode("context-team") == "team"
        assert team_profile_policy("context-team")["worker_model"] == WORKER_MODEL
    finally:
        reset_hermes_home_override(token)

    assert profile_task_mode(
        "context-team", profile_home=alternate_profile
    ) == "team"
    with pytest.raises(ValueError, match="does not match profile"):
        profile_task_mode("wrong-name", profile_home=alternate_profile)
    with kbc.connect_closing(team_board) as conn:
        root = create_team_root(
            conn,
            assignee="context-team",
            profile_home=alternate_profile,
            title="Context-local Team mission",
        )
    assert root.assignee == "context-team"
    assert root.allowed_assignees == ["context-team"]


def test_public_helper_creates_one_readback_root_and_full_notification(team_board):
    from hermes_cli import kanban_db_notify as notify
    from hermes_cli.kanban_team import TEAM_DECOMPOSITION_STEP, TEAM_WORKFLOW_ID

    with kbc.connect_closing() as conn:
        root = _new_team_root(
            conn,
            tenant="tenant-a",
            idempotency_key="team:mission-1",
            max_retries=2,
            skills=["source-review"],
            notify_platform="api_server",
            notify_chat_id="chat-1",
            notify_thread_id="thread-1",
            notify_user_id="user-1",
            notify_user_id_alt="alt-1",
            notify_chat_type="group",
            notifier_profile="main",
            notify_delivery_mode="notify+wake",
            notify_delivery_metadata={"scope_id": "scope-1"},
        )
        same = _new_team_root(
            conn,
            tenant="tenant-a",
            idempotency_key="team:mission-1",
            max_retries=2,
            skills=["source-review"],
            notify_platform="api_server",
            notify_chat_id="chat-1",
            notify_thread_id="thread-1",
            notify_user_id="user-1",
            notify_user_id_alt="alt-1",
            notify_chat_type="group",
            notifier_profile="main",
            notify_delivery_mode="notify+wake",
            notify_delivery_metadata={"scope_id": "scope-1"},
        )
        subscriptions = notify.list_notify_subs(
            conn, root.id, notifier_profiles=["main"]
        )
        count = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]

    assert same.id == root.id
    assert count == 1
    assert root.status == "triage"
    assert root.assignee == TEAM_PROFILE
    assert root.workflow_template_id == TEAM_WORKFLOW_ID
    assert root.current_step_key == TEAM_DECOMPOSITION_STEP
    assert root.provider_override == PARENT_PROVIDER
    assert root.model_override == PARENT_MODEL
    assert root.allowed_assignees == [TEAM_PROFILE]
    assert root.skills == ["source-review"]
    assert root.session_id == "session-1"
    assert len(subscriptions) == 1
    assert subscriptions[0]["platform"] == "api_server"
    assert subscriptions[0]["chat_id"] == "chat-1"
    assert subscriptions[0]["thread_id"] == "thread-1"
    assert subscriptions[0]["user_id_alt"] == "alt-1"
    assert subscriptions[0]["chat_type"] == "group"
    assert subscriptions[0]["delivery_mode"] == "notify+wake"
    assert subscriptions[0]["delivery_metadata"] == {"scope_id": "scope-1"}


def test_public_helper_rejects_model_override_and_incomplete_notification(team_board):
    with kbc.connect_closing() as conn:
        with pytest.raises(ValueError, match="model must match"):
            _new_team_root(conn, model_override="wrong-model")
        with pytest.raises(ValueError, match="both platform and chat id"):
            _new_team_root(conn, notify_platform="tui")
        with pytest.raises(ValueError, match="enter Triage directly"):
            _new_team_root(conn, initial_status="blocked")
        with pytest.raises(ValueError, match="only the saved Team profile"):
            _new_team_root(conn, allowed_assignees=[TEAM_PROFILE, "ordinary"])
        assert conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 0


def test_kanban_create_uses_structure_without_a_public_workflow_knob(team_board, monkeypatch):
    from hermes_cli.kanban_team import TEAM_WORKFLOW_ID
    from tools import kanban_tools
    from tools.kanban_tools_schemas import KANBAN_CREATE_SCHEMA

    monkeypatch.setattr(kanban_tools, "_maybe_auto_subscribe", lambda _conn, _tid: False)
    team_result = json.loads(kanban_tools._handle_create({
        "title": "Use the saved Team",
        "body": "One ordinary assignment.",
        "assignee": TEAM_PROFILE,
    }))
    ordinary_result = json.loads(kanban_tools._handle_create({
        "title": "Use one ordinary profile",
        "assignee": "ordinary",
    }))

    with kbc.connect_closing() as conn:
        team = kb.get_task(conn, team_result["task_id"])
        ordinary = kb.get_task(conn, ordinary_result["task_id"])

    properties = KANBAN_CREATE_SCHEMA["parameters"]["properties"]
    assert "task_mode" not in properties
    assert "workflow_template_id" not in properties
    assert team.status == "triage"
    assert team.workflow_template_id == TEAM_WORKFLOW_ID
    assert team.assignee == TEAM_PROFILE
    assert team.provider_override == PARENT_PROVIDER
    assert team.model_override == PARENT_MODEL
    assert ordinary.status == "ready"
    assert ordinary.workflow_template_id is None
    assert ordinary.current_step_key is None


def _decompose_team_root(team_board, monkeypatch, worker_count=2):
    from hermes_cli import kanban_decompose as decompose

    with kbc.connect_closing() as conn:
        root = _new_team_root(conn)
        conn.execute(
            "UPDATE tasks SET consecutive_failures=1, last_failure_error='prior' WHERE id=?",
            (root.id,),
        )
        conn.commit()

    def no_global_routing():
        raise AssertionError("Team decomposition must not read the global roster")

    monkeypatch.setattr(decompose, "_load_routing", no_global_routing)
    monkeypatch.setattr(
        decompose,
        "_call_aux",
        lambda *_args, **_kwargs: (
            json.dumps({
                "fanout": True,
                "tasks": [
                    {
                        "title": f"Evidence {index}",
                        "body": f"Read source {index}",
                        "assignee": "outside-profile",
                        "parents": [index - 1] if index else [],
                    }
                    for index in range(worker_count)
                ],
            }),
            "",
        ),
    )
    outcome = decompose.decompose_task(root.id, author="terra")
    assert outcome.ok is True
    return root.id, outcome.child_ids or []


def test_team_decomposition_uses_same_profile_and_same_root_synthesis(team_board, monkeypatch):
    from hermes_cli import kanban_db_dispatch as dispatch
    from hermes_cli.kanban_team import TEAM_SYNTHESIS_STEP, TEAM_WORKER_STEP, TEAM_WORKFLOW_ID
    from tools import process_registry
    from tools.environments import local as local_env

    root_id, child_ids = _decompose_team_root(team_board, monkeypatch)
    assert len(child_ids) == 2
    with kbc.connect_closing() as conn:
        root = kb.get_task(conn, root_id)
        children = [kb.get_task(conn, task_id) for task_id in child_ids]
        assert root.status == "todo"
        assert root.current_step_key == TEAM_SYNTHESIS_STEP
        assert root.consecutive_failures == 0
        assert root.last_failure_error is None
        assert all(child.assignee == TEAM_PROFILE for child in children)
        assert all(child.workflow_template_id == TEAM_WORKFLOW_ID for child in children)
        assert all(child.current_step_key == TEAM_WORKER_STEP for child in children)
        assert all(child.provider_override == WORKER_PROVIDER for child in children)
        assert all(child.model_override == WORKER_MODEL for child in children)
        assert all(child.reasoning_effort == "high" for child in children)
        assert all(child.allowed_assignees == [TEAM_PROFILE] for child in children)

        for index, child in enumerate(children, start=1):
            current = kb.get_task(conn, child.id)
            assert current.status == "ready"
            claimed = kb.claim_task(conn, child.id)
            assert claimed is not None
            assert kb.complete_task(
                conn,
                child.id,
                result=f"Luna report {index}",
                expected_run_id=claimed.current_run_id,
            )
        synthesis_root = kb.get_task(conn, root_id)
        synthesis_context = kb.build_worker_context(conn, root_id)
        claimed_root = kb.claim_task(conn, root_id)

    assert synthesis_root.status == "ready"
    assert claimed_root is not None
    assert claimed_root.id == root_id
    assert "separate final review/synthesis pass" in synthesis_context
    assert "Luna report 1" in synthesis_context
    assert "Luna report 2" in synthesis_context

    captured = {}

    class FakeProcess:
        pid = 4245

    def fake_popen(cmd, *args, **kwargs):
        captured["cmd"] = list(cmd)
        captured["env"] = dict(kwargs["env"])
        return FakeProcess()

    monkeypatch.setattr(dispatch, "_resolve_hermes_argv", lambda: ["hermes"])
    monkeypatch.setattr(dispatch, "_resolve_worker_cli_toolsets", lambda _home: [])
    monkeypatch.setattr(dispatch, "_restart_safe_worker_argv", lambda _task, command: command)
    monkeypatch.setattr(dispatch, "_open_worker_log", lambda _task, _board: open(os.devnull, "wb"))
    monkeypatch.setattr(dispatch, "_process_fingerprint", lambda _pid: 123.0)
    monkeypatch.setattr(local_env, "build_subprocess_env", lambda **_kwargs: {})
    monkeypatch.setattr(local_env, "strip_launch_profile_env", lambda *_args: None)
    monkeypatch.setattr(process_registry, "systemd_user_bus_env", lambda env: env)
    monkeypatch.setattr(dispatch.subprocess, "Popen", fake_popen)

    dispatch._default_spawn(claimed_root, str(team_board.parent))
    assert captured["env"]["HERMES_KANBAN_TEAM_WORKER"] == "1"
    assert captured["cmd"][captured["cmd"].index("-p") + 1] == TEAM_PROFILE
    assert captured["cmd"][captured["cmd"].index("-m") + 1] == PARENT_MODEL

    with kbc.connect_closing() as conn:
        dispatch._set_worker_pid(conn, root_id, FakeProcess.pid)
        spawned = [event for event in kb.list_events(conn, root_id) if event.kind == "spawned"][-1]
    assert spawned.payload == {
        "pid": 4245,
        "started_at": 123.0,
        "workflow_template_id": TEAM_WORKFLOW_ID,
        "step_key": TEAM_SYNTHESIS_STEP,
        "provider": PARENT_PROVIDER,
        "model": PARENT_MODEL,
    }


@pytest.mark.parametrize("worker_count", [1, 5, 9])
def test_team_decomposition_preserves_existing_graph_size_policy(
    team_board, monkeypatch, worker_count
):
    _root_id, child_ids = _decompose_team_root(
        team_board, monkeypatch, worker_count=worker_count
    )
    assert len(child_ids) == worker_count


def test_team_workers_auto_promote_when_generic_manual_review_is_enabled(
    team_board, monkeypatch
):
    (team_board.parent / "config.yaml").write_text(
        "kanban:\n  auto_promote_children: false\n",
        encoding="utf-8",
    )
    _root_id, child_ids = _decompose_team_root(
        team_board, monkeypatch, worker_count=1
    )
    with kbc.connect_closing() as conn:
        child = kb.get_task(conn, child_ids[0])
    assert child.status == "ready"


def test_team_process_marker_blocks_nested_task_creation(team_board, monkeypatch):
    monkeypatch.setenv("HERMES_KANBAN_TEAM_WORKER", "1")
    with kbc.connect_closing() as conn, pytest.raises(
        RuntimeError, match="cannot create nested Kanban tasks"
    ):
        kb.create_task(conn, title="Nested escape")

    from tools.delegate_tool import delegate_task

    refusal = delegate_task(goal="Nested delegate escape", parent_agent=object())
    assert "cannot delegate nested" in refusal


def test_team_decomposition_failures_block_once_without_retry_spend_loop(
    team_board, monkeypatch
):
    from gateway import kanban_watchers_dispatcher as watcher
    from hermes_cli import kanban_decompose as decompose
    from hermes_cli.kanban_decompose import DecomposeOutcome
    from hermes_cli.kanban_team import record_decomposition_failure

    with kbc.connect_closing() as conn:
        team = _new_team_root(conn, max_retries=2)
        ordinary_id = kb.create_task(
            conn,
            title="Ordinary triage",
            assignee="ordinary",
            triage=True,
        )

    calls = {team.id: 0, ordinary_id: 0}

    def fail(task_id, **_kwargs):
        calls[task_id] += 1
        return DecomposeOutcome(task_id, False, "auxiliary unavailable")

    monkeypatch.setattr(decompose, "decompose_task", fail)
    settings = watcher._DispatcherSettings(
        interval=1,
        max_spawn=None,
        max_in_progress=None,
        failure_limit=3,
        stale_timeout_seconds=0,
        reconcile_orphans=True,
        default_assignee=None,
        max_in_progress_per_profile=None,
    )
    dispatcher = watcher._KanbanDispatcher(kb, settings)
    monkeypatch.setattr(dispatcher, "_board_slugs", lambda: ["default"])

    assert dispatcher.auto_decompose_tick(10) == 0
    assert dispatcher.auto_decompose_tick(10) == 0
    assert dispatcher.auto_decompose_tick(10) == 0

    with kbc.connect_closing() as conn:
        team_after = kb.get_task(conn, team.id)
        ordinary_after = kb.get_task(conn, ordinary_id)
        terminal = [
            event for event in kb.list_events(conn, team.id)
            if event.kind == "gave_up"
        ]
        repeated = record_decomposition_failure(
            conn, team.id, "must not append", failure_limit=3
        )

    assert calls == {team.id: 2, ordinary_id: 3}
    assert team_after.status == "blocked"
    assert team_after.consecutive_failures == 2
    assert team_after.last_failure_error == "auxiliary unavailable"
    assert len(terminal) == 1
    assert terminal[0].payload["trigger_outcome"] == "decomposition_failed"
    assert terminal[0].payload["effective_limit"] == 2
    assert terminal[0].payload["limit_source"] == "task"
    assert repeated == {"handled": False, "blocked": False}
    assert ordinary_after.status == "triage"
    assert ordinary_after.consecutive_failures == 0
    assert ordinary_after.last_failure_error is None
