"""Focused native Auto-Kanban proof for ``delegate_task(role="team")``."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from hermes_cli import kanban_db as kb
from hermes_cli import kanban_db_connect as kbc


@pytest.fixture
def team_board(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    db_path = home / "kanban.db"
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_KANBAN_DB", str(db_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    kbc._INITIALIZED_PATHS.clear()
    kbc.init_db(db_path)
    return db_path


def _policy():
    return {
        "root_provider": "openai-codex",
        "root_model": "gpt-5.6-terra",
        "worker_provider": "openai-codex",
        "worker_model": "gpt-5.6-luna",
        "worker_reasoning": "high",
        "max_retries": 2,
    }


def _policy_config():
    return {
        "auxiliary": {
            "kanban_decomposer": {
                "provider": "openai-codex",
                "model": "gpt-5.6-terra",
            },
        },
        "kanban": {
            "auto_decompose": True,
            "dispatch_in_gateway": True,
            "failure_limit": 2,
            "team_worker_provider": "openai-codex",
            "team_worker_model": "gpt-5.6-luna",
            "team_worker_reasoning_effort": "high",
        },
    }


def test_team_policy_requires_explicit_native_routes():
    from hermes_cli.kanban_team import team_policy

    with pytest.raises(RuntimeError, match="kanban_decomposer.provider/model"):
        team_policy({"auxiliary": {}, "kanban": {}})
    with pytest.raises(RuntimeError, match="team_worker_provider/model"):
        team_policy({
            "auxiliary": {"kanban_decomposer": {"provider": "p", "model": "m"}},
            "kanban": {},
        })
    assert team_policy(_policy_config()) == _policy()


def test_submit_team_commits_nothing_before_dispatcher_readiness(team_board, monkeypatch):
    from hermes_cli import kanban, kanban_team

    monkeypatch.setattr(kanban_team, "team_policy", lambda: _policy())
    monkeypatch.setattr(kanban, "_check_dispatcher_presence", lambda _root: (False, "No gateway is running"))

    with pytest.raises(RuntimeError, match="No gateway is running"):
        kanban_team.submit_team(
            goal="Do not persist this mission without a dispatcher.",
            context="The isolated Hermes home has no gateway artifacts.",
            parent_agent=object(),
        )

    with kbc.connect_closing() as conn:
        assert conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 0


def test_submit_team_parks_then_activates_one_native_root(team_board, monkeypatch):
    from hermes_cli import kanban, kanban_team
    from tools import kanban_tools

    monkeypatch.setattr(kanban_team, "team_policy", lambda: _policy())
    monkeypatch.setattr(kanban_team, "_active_profile_name", lambda: "card-main")
    monkeypatch.setattr(kanban_team, "_origin_session_id", lambda _parent: "session-1")
    monkeypatch.setattr(kanban, "_check_dispatcher_presence", lambda _root: (True, "ready"))
    monkeypatch.setattr(kanban_tools, "_maybe_auto_subscribe", lambda _conn, _tid: True)

    observed = {}
    activate = kb.activate_team_triage_task

    def observe_activation(conn, task_id):
        task = kb.get_task(conn, task_id)
        observed.update({
            "status": task.status,
            "step": task.current_step_key,
            "provider": task.provider_override,
            "model": task.model_override,
        })
        return activate(conn, task_id)

    monkeypatch.setattr(kb, "activate_team_triage_task", observe_activation)
    result = kanban_team.submit_team(
        goal="Inspect the native execution path and synthesize one report.",
        context="Use explicit source evidence only.",
        parent_agent=object(),
    )

    assert observed == {
        "status": "blocked",
        "step": "correlation",
        "provider": "openai-codex",
        "model": "gpt-5.6-terra",
    }
    assert result["policy"] == {
        "decomposition_provider": "openai-codex",
        "decomposition_model": "gpt-5.6-terra",
        "worker_provider": "openai-codex",
        "worker_model": "gpt-5.6-luna",
        "worker_reasoning": "high",
        "max_depth": 1,
        "synthesis_provider": "openai-codex",
        "synthesis_model": "gpt-5.6-terra",
    }
    with kbc.connect_closing() as conn:
        root = kb.get_task(conn, result["task_id"])
        count = conn.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE created_by='delegate_task:team'"
        ).fetchone()["count"]
    assert count == 1
    assert root.status == "triage"
    assert root.workflow_template_id == "delegate-team-v1"
    assert root.current_step_key == "decomposition"
    assert root.assignee == "card-main"


def _decompose_team_root(team_board, monkeypatch, worker_count=2):
    from hermes_cli import kanban_decompose as decompose
    from hermes_cli import kanban_team

    with kbc.connect_closing() as conn:
        root_id = kb.create_task(
            conn,
            title="Team mission",
            body="Explicit mission packet",
            assignee="card-main",
            created_by="delegate_task:team",
            triage=True,
            model_override="gpt-5.6-terra",
            provider_override="openai-codex",
            workflow_template_id="delegate-team-v1",
            current_step_key="decomposition",
        )
    routing = decompose._Routing(
        orchestrator="other-orchestrator",
        default_assignee="auto-worker",
        auto_promote=True,
        roster=[{"name": "auto-worker", "description": "Worker", "has_description": True}],
        valid_names={"auto-worker"},
    )
    monkeypatch.setattr(decompose, "_load_routing", lambda: routing)
    monkeypatch.setattr(kanban_team, "team_policy", lambda: _policy())
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
                        "assignee": "auto-worker",
                        "parents": [],
                    }
                    for index in range(worker_count)
                ],
            }),
            "",
        ),
    )
    outcome = decompose.decompose_task(root_id, author="terra")
    assert outcome.ok is True
    return root_id, outcome.child_ids or []


def test_team_decomposition_pins_workers_and_root_synthesis(team_board, monkeypatch):
    from hermes_cli import kanban_db_dispatch as dispatch
    from tools.environments import local as local_env
    from tools import process_registry

    root_id, child_ids = _decompose_team_root(team_board, monkeypatch)
    assert len(child_ids) == 2
    with kbc.connect_closing() as conn:
        root = kb.get_task(conn, root_id)
        children = [kb.get_task(conn, task_id) for task_id in child_ids]
    assert root.assignee == "card-main"
    assert root.current_step_key == "synthesis"
    assert all(child.workflow_template_id == "delegate-team-v1" for child in children)
    assert all(child.current_step_key == "worker" for child in children)
    assert all(child.provider_override == "openai-codex" for child in children)
    assert all(child.model_override == "gpt-5.6-luna" for child in children)
    assert all(child.reasoning_effort == "high" for child in children)

    with kbc.connect_closing() as conn:
        for index, child in enumerate(children, start=1):
            claimed = kb.claim_task(conn, child.id)
            assert claimed is not None
            assert kb.complete_task(
                conn,
                child.id,
                result=f"Luna report {index}",
                expected_run_id=claimed.current_run_id,
            )
        terra_root = kb.get_task(conn, root_id)
        assert terra_root.status == "ready"
        synthesis_context = kb.build_worker_context(conn, root_id)
        claimed_root = kb.claim_task(conn, root_id)
        assert claimed_root is not None

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
    assert captured["cmd"][captured["cmd"].index("-m") + 1] == "gpt-5.6-terra"

    with kbc.connect_closing() as conn:
        dispatch._set_worker_pid(conn, root_id, FakeProcess.pid)
        event = conn.execute(
            "SELECT payload FROM task_events WHERE task_id=? AND kind='spawned' ORDER BY id DESC LIMIT 1",
            (root_id,),
        ).fetchone()
    receipt = json.loads(event["payload"])
    assert receipt == {
        "pid": 4245,
        "started_at": 123.0,
        "workflow_template_id": "delegate-team-v1",
        "step_key": "synthesis",
        "provider": "openai-codex",
        "model": "gpt-5.6-terra",
    }


@pytest.mark.parametrize("worker_count", [1, 5, 9])
def test_team_decomposition_does_not_add_a_new_task_count_cap(team_board, monkeypatch, worker_count):
    _root_id, child_ids = _decompose_team_root(team_board, monkeypatch, worker_count=worker_count)
    assert len(child_ids) == worker_count


def test_team_process_marker_blocks_direct_nested_task_creation(team_board, monkeypatch):
    monkeypatch.setenv("HERMES_KANBAN_TEAM_WORKER", "1")
    with kbc.connect_closing() as conn, pytest.raises(
        RuntimeError, match="cannot create nested Kanban tasks"
    ):
        kb.create_task(conn, title="Nested escape")
