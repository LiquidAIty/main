"""Headless delegate-Team recipe over native Auto-Kanban and SQLite."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess

import pytest

from hermes_cli import kanban_db as kb


@pytest.fixture
def team_board(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    db_path = home / "kanban.db"
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_KANBAN_DB", str(db_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    kb._INITIALIZED_PATHS.clear()
    kb.init_db()
    return db_path


def _policy_config(max_workers=4):
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
            "team_max_workers": max_workers,
            "team_worker_provider": "openai-codex",
            "team_worker_model": "gpt-5.6-luna",
        },
    }


def test_submit_team_commits_nothing_before_real_readiness_succeeds(team_board):
    home = team_board.parent
    (home / "config.yaml").write_text(
        """auxiliary:
  kanban_decomposer:
    provider: openai-codex
    model: gpt-5.6-terra
kanban:
  auto_decompose: true
  dispatch_in_gateway: true
  team_worker_provider: openai-codex
  team_worker_model: gpt-5.6-luna
""",
        encoding="utf-8",
    )

    from hermes_cli import kanban_team

    with pytest.raises(RuntimeError) as raised:
        kanban_team.submit_team(
            goal="Do not persist this mission without a dispatcher.",
            context="The isolated Hermes home has no gateway artifacts.",
            parent_agent=object(),
        )

    assert f"repository Hermes home {home}" in str(raised.value)
    assert "No gateway is running" in str(raised.value)
    with kb.connect_closing() as conn:
        assert conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 0


def test_submit_team_commits_one_blocked_root_before_host_then_activates(
    team_board, monkeypatch,
):
    from types import SimpleNamespace

    from acp_adapter import host_profiles
    from hermes_cli import kanban, kanban_team
    from tools import kanban_tools

    monkeypatch.setattr(kanban_team, "_shared_config", _policy_config)
    monkeypatch.setattr(kanban_team, "_active_profile_name", lambda: "card-main")
    monkeypatch.setattr(kanban_team, "_origin_session_id", lambda _parent: "session-1")
    monkeypatch.setattr(kanban, "_check_dispatcher_presence", lambda _root: (True, "ready"))
    monkeypatch.setattr(kanban_tools, "_maybe_auto_subscribe", lambda _conn, _tid: True)

    observed = {}

    def allocate(_parent, *, native_child_id, provider, model):
        with kb.connect_closing() as conn:
            task = kb.get_task(conn, native_child_id)
        observed.update({
            "status": task.status,
            "step": task.current_step_key,
            "provider": provider,
            "model": model,
        })
        return {
            "executionContextId": "ctx-1",
            "runId": "child-run-1",
            "toolCallMeta": {"liquidaity/execution": "ctx-1"},
        }

    monkeypatch.setattr(host_profiles, "allocate_host_native_execution", allocate)

    parent = SimpleNamespace(_host_session_config={"team": {
        "mode": "auto", "maxWorkers": 3, "retryLimit": 0,
        "worker": {"provider": "openai-codex", "model": "gpt-5.6-luna-card"},
        "lead": {"provider": "openai-codex", "model": "gpt-5.6-terra-card"},
    }})
    result = kanban_team.submit_team(
        goal="Inspect the native execution path and synthesize one report.",
        context="Use explicit source evidence only.",
        parent_agent=parent,
    )
    assert observed == {
        "status": "blocked",
        "step": "correlation",
        "provider": "openai-codex",
        "model": "gpt-5.6-terra-card",
    }
    assert result["policy"] == {
        "decomposition_provider": "openai-codex",
        "decomposition_model": "gpt-5.6-terra-card",
        "worker_provider": "openai-codex",
        "worker_model": "gpt-5.6-luna-card",
        "max_workers": 3,
        "retry_limit": 0,
        "max_depth": 1,
        "lead_provider": "openai-codex",
        "lead_model": "gpt-5.6-terra-card",
        "synthesis_provider": "openai-codex",
        "synthesis_model": "gpt-5.6-terra-card",
    }
    with kb.connect_closing() as conn:
        root = kb.get_task(conn, result["task_id"])
        count = conn.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE created_by='delegate_task:team'"
        ).fetchone()["count"]
    assert count == 1
    assert root.status == "triage"
    assert root.workflow_template_id == "delegate-team-v1"
    assert root.current_step_key == "decomposition"
    assert root.assignee == "card-main"
    assert root.provider_override == "openai-codex"
    assert root.model_override == "gpt-5.6-terra-card"
    assert root.max_retries == 1
    with kb.connect_closing() as conn:
        receipt = next(
            event.payload for event in kb.list_events(conn, root.id)
            if event.kind == "team_policy_applied"
        )
    assert receipt == {
        "schema_version": "hermes.team.policy.v1",
        "source": "host_session",
        "mode": "auto",
        "auto_decompose": True,
        "max_workers": 3,
        "retry_limit": 0,
        "max_retries": 1,
        "worker_provider": "openai-codex",
        "worker_model": "gpt-5.6-luna-card",
        "lead_provider": "openai-codex",
        "lead_model": "gpt-5.6-terra-card",
        "max_depth": 1,
    }


def test_team_decomposer_creates_two_to_four_luna_workers_and_terra_root(
    team_board, monkeypatch,
):
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    from agent import auxiliary_client
    from hermes_cli import kanban_decompose as decompose

    with kb.connect_closing() as conn:
        root_id = kb.create_task(
            conn,
            title="Team mission",
            body="Explicit mission packet",
            assignee="card-main",
            created_by="delegate_task:team",
            triage=True,
            model_override="gpt-5.6-terra",
            provider_override="openai-codex",
            max_retries=1,
            workflow_template_id="delegate-team-v1",
            current_step_key="decomposition",
        )
        with kb.write_txn(conn):
            kb._append_event(conn, root_id, "team_policy_applied", {
                "schema_version": "hermes.team.policy.v1",
                "source": "host_session",
                "mode": "auto",
                "auto_decompose": True,
                "max_workers": 2,
                "retry_limit": 0,
                "max_retries": 1,
                "worker_provider": "openai-codex",
                "worker_model": "gpt-5.6-luna-card",
                "lead_provider": "openai-codex",
                "lead_model": "gpt-5.6-terra-card",
                "max_depth": 1,
            })

    monkeypatch.setattr(
        decompose,
        "_build_roster",
        lambda: (_ for _ in ()).throw(
            AssertionError("Team must not read the global Hermes profile roster")
        ),
    )
    monkeypatch.setattr(decompose, "_load_config", _policy_config)
    response = MagicMock()
    response.choices = [MagicMock()]
    response.choices[0].message.content = json.dumps({
        "fanout": True,
        "tasks": [
            {"title": "Evidence A", "body": "Read source A", "assignee": "other-card", "parents": []},
            {"title": "Evidence B", "body": "Read source B", "assignee": None, "parents": []},
        ],
    })
    llm_calls = []
    monkeypatch.setattr(
        auxiliary_client,
        "call_llm",
        lambda **kwargs: llm_calls.append(kwargs) or response,
    )

    outcome = decompose.decompose_task(root_id, author="terra")
    assert outcome.ok is True
    assert len(outcome.child_ids or []) == 2
    with kb.connect_closing() as conn:
        root = kb.get_task(conn, root_id)
        children = [kb.get_task(conn, task_id) for task_id in outcome.child_ids or []]
    assert root.assignee == "card-main"
    assert root.current_step_key == "synthesis"
    assert root.model_override == "gpt-5.6-terra"
    assert llm_calls[0]["provider"] == "openai-codex"
    assert llm_calls[0]["model"] == "gpt-5.6-terra-card"
    assert "card-main" in llm_calls[0]["messages"][1]["content"]
    assert "other-card" not in llm_calls[0]["messages"][1]["content"]
    assert all(child.workflow_template_id == "delegate-team-v1" for child in children)
    assert all(child.current_step_key == "worker" for child in children)
    assert all(child.assignee == "card-main" for child in children)
    assert all(child.provider_override == "openai-codex" for child in children)
    assert all(child.model_override == "gpt-5.6-luna-card" for child in children)
    assert all(child.max_retries == 1 for child in children)

    with kb.connect_closing() as conn:
        for index, child in enumerate(children, start=1):
            claimed = kb.claim_task(conn, child.id)
            assert claimed is not None
            assert kb.complete_task(
                conn,
                child.id,
                result=f"Luna report {index}",
                expected_run_id=claimed.current_run_id,
            )
        # Completing the last dependency performs the native promotion; a
        # later dispatcher recompute is intentionally idempotent.
        kb.recompute_ready(conn)
        terra_root = kb.get_task(conn, root_id)
        assert terra_root.status == "ready"
        synthesis_context = kb.build_worker_context(conn, root_id)

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

    monkeypatch.setattr(kb, "_resolve_hermes_argv", lambda: ["hermes"])
    monkeypatch.setattr(kb, "_resolve_worker_cli_toolsets", lambda _home: [])
    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    kb._default_spawn(terra_root, str(team_board.parent))
    command = captured["cmd"]
    assert command[command.index("-p") + 1] == "card-main"
    assert "--resume" not in command
    assert command[command.index("-m") + 1] == "gpt-5.6-terra"
    assert command[command.index("--provider") + 1] == "openai-codex"
    assert captured["env"]["HERMES_KANBAN_TEAM_WORKER"] == "1"
    assert captured["env"]["HERMES_SESSION_SOURCE"] == "kanban"

    with kb.connect_closing() as conn:
        claimed_root = kb.claim_task(conn, root_id)
        assert claimed_root is not None
        kb._set_worker_pid(conn, root_id, FakeProcess.pid)
        event = conn.execute(
            "SELECT payload FROM task_events "
            "WHERE task_id=? AND kind='spawned' ORDER BY id DESC LIMIT 1",
            (root_id,),
        ).fetchone()
    receipt = json.loads(event["payload"])
    assert receipt == {
        "pid": 4245,
        "workflow_template_id": "delegate-team-v1",
        "step_key": "synthesis",
        "provider": "openai-codex",
        "model": "gpt-5.6-terra",
    }


def test_team_db_boundary_pins_foreign_child_and_root_assignees_to_origin(
    team_board,
):
    with kb.connect_closing() as conn:
        root_id = kb.create_task(
            conn,
            title="Private Team root",
            assignee="origin-card",
            triage=True,
            workflow_template_id="delegate-team-v1",
        )
        child_ids = kb.decompose_triage_task(
            conn,
            root_id,
            root_assignee="foreign-orchestrator",
            children=[
                {"title": "First", "assignee": "foreign-card", "parents": []},
                {"title": "Second", "assignee": None, "parents": [0]},
            ],
            auto_promote=False,
        )
        root = kb.get_task(conn, root_id)
        children = [kb.get_task(conn, child_id) for child_id in child_ids or []]

    assert len(children) == 2
    assert root.assignee == "origin-card"
    assert all(child.assignee == "origin-card" for child in children)


@pytest.mark.parametrize("worker_count", [1, 5])
def test_team_decomposer_rejects_worker_counts_outside_two_to_four(
    team_board, monkeypatch, worker_count,
):
    from unittest.mock import MagicMock

    from agent import auxiliary_client
    from hermes_cli import kanban_decompose as decompose

    with kb.connect_closing() as conn:
        root_id = kb.create_task(
            conn,
            title="Bounded Team mission",
            assignee="card-main",
            triage=True,
            workflow_template_id="delegate-team-v1",
        )
    monkeypatch.setattr(decompose, "_load_config", _policy_config)
    monkeypatch.setattr(decompose, "_build_roster", lambda: ([], {"default"}))
    response = MagicMock()
    response.choices = [MagicMock()]
    response.choices[0].message.content = json.dumps({
        "fanout": True,
        "tasks": [
            {"title": f"Worker {index}", "body": "Bounded work", "parents": []}
            for index in range(worker_count)
        ],
    })
    monkeypatch.setattr(auxiliary_client, "call_llm", lambda **_kwargs: response)

    outcome = decompose.decompose_task(root_id)
    assert outcome.ok is False
    assert "2-4 workers" in outcome.reason
    with kb.connect_closing() as conn:
        assert kb.get_task(conn, root_id).status == "triage"
        assert conn.execute("SELECT COUNT(*) AS count FROM tasks").fetchone()["count"] == 1


def test_team_process_marker_blocks_direct_nested_task_creation(team_board, monkeypatch):
    monkeypatch.setenv("HERMES_KANBAN_TEAM_WORKER", "1")
    with kb.connect_closing() as conn, pytest.raises(
        RuntimeError, match="cannot create nested Kanban tasks"
    ):
        kb.create_task(conn, title="Nested escape")
