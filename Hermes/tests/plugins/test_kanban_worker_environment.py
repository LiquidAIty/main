"""Generic Kanban child-environment provider contract proof."""

from __future__ import annotations

import subprocess
import json

import pytest

from hermes_cli import kanban_db as kb
from hermes_cli.plugins import (
    KanbanWorkerEnvironmentContext,
    PluginContext,
    PluginManager,
    PluginManifest,
)


def _context(**overrides) -> KanbanWorkerEnvironmentContext:
    values = {
        "task_id": "t_worker",
        "run_id": "7",
        "board": "default",
        "assignee": "worker-profile",
        "profile": "worker-profile",
        "workspace": "/workspace/project",
        "claim_lock": "worker:claim-7",
    }
    values.update(overrides)
    return KanbanWorkerEnvironmentContext(**values)


def _task() -> kb.Task:
    return kb.Task(
        id="t_worker",
        title="worker",
        body="bounded task",
        assignee="worker-profile",
        status="running",
        priority=0,
        created_by="auto-decomposer",
        created_at=1,
        started_at=1,
        completed_at=None,
        workspace_kind="dir",
        workspace_path=None,
        claim_lock="worker:claim-7",
        claim_expires=None,
        tenant=None,
        current_run_id=7,
    )


def test_registered_provider_is_additive_and_disposable():
    manager = PluginManager()
    ctx = PluginContext(PluginManifest(name="test-provider"), manager)
    handle = ctx.register_kanban_worker_environment_provider(
        lambda context: {"SCOPED_VALUE": f"{context.task_id}:{context.run_id}"}
    )

    assert manager.resolve_kanban_worker_environment(_context()) == {
        "SCOPED_VALUE": "t_worker:7"
    }
    handle.dispose()
    assert manager.resolve_kanban_worker_environment(_context()) == {}


def test_provider_rejects_stock_or_duplicate_environment_keys():
    manager = PluginManager()
    first = PluginContext(PluginManifest(name="first"), manager)
    first.register_kanban_worker_environment_provider(
        lambda _context: {"HERMES_KANBAN_TASK": "replacement"}
    )
    with pytest.raises(ValueError, match="cannot replace"):
        manager.resolve_kanban_worker_environment(_context())

    manager = PluginManager()
    first = PluginContext(PluginManifest(name="first"), manager)
    second = PluginContext(PluginManifest(name="second"), manager)
    first.register_kanban_worker_environment_provider(
        lambda _context: {"SCOPED_VALUE": "one"}
    )
    second.register_kanban_worker_environment_provider(
        lambda _context: {"SCOPED_VALUE": "two"}
    )
    with pytest.raises(ValueError, match="cannot replace"):
        manager.resolve_kanban_worker_environment(_context())


def test_default_spawn_adds_only_provider_value(monkeypatch, tmp_path):
    root = tmp_path / ".hermes"
    profile = root / "profiles" / "worker-profile"
    profile.mkdir(parents=True)
    profile.joinpath("config.yaml").write_text("{}\n", encoding="utf-8")
    root.joinpath("config.yaml").write_text("{}\n", encoding="utf-8")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setattr(kb, "_resolve_hermes_argv", lambda: ["hermes"])

    from hermes_cli import plugins as plugins_module

    seen = []

    def provide(context):
        seen.append(context)
        return {"SCOPED_VALUE": "scoped-child-value"}

    monkeypatch.setattr(
        plugins_module, "resolve_kanban_worker_environment", provide
    )
    captured = {}

    class FakeProc:
        pid = 4242

    def fake_popen(cmd, *args, **kwargs):
        captured["cmd"] = list(cmd)
        captured["env"] = dict(kwargs["env"])
        return FakeProc()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    assert kb._default_spawn(_task(), str(workspace), board="default") == 4242

    assert seen == [_context(workspace=str(workspace))]
    assert captured["env"]["SCOPED_VALUE"] == "scoped-child-value"
    assert captured["env"]["HERMES_KANBAN_TASK"] == "t_worker"
    assert captured["env"]["HERMES_KANBAN_RUN_ID"] == "7"
    assert captured["env"]["HERMES_KANBAN_CLAIM_LOCK"] == "worker:claim-7"


def test_default_spawn_without_provider_preserves_stock_lane(monkeypatch, tmp_path):
    root = tmp_path / ".hermes"
    (root / "profiles" / "worker-profile").mkdir(parents=True)
    root.joinpath("config.yaml").write_text("{}\n", encoding="utf-8")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setattr(kb, "_resolve_hermes_argv", lambda: ["hermes"])
    from hermes_cli import plugins as plugins_module

    monkeypatch.setattr(
        plugins_module, "resolve_kanban_worker_environment", lambda _context: {}
    )
    captured = {}

    class FakeProc:
        pid = 4243

    def fake_popen(cmd, *args, **kwargs):
        captured["env"] = dict(kwargs["env"])
        return FakeProc()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    assert kb._default_spawn(_task(), str(workspace)) == 4243
    assert "SCOPED_VALUE" not in captured["env"]
    assert captured["env"]["HERMES_KANBAN_TASK"] == "t_worker"


def test_default_spawn_validates_process_mcp_before_launch_and_keeps_native_toolsets(monkeypatch, tmp_path):
    from hermes_cli import plugins
    from tools.mcp_tool import process_mcp_servers

    root = tmp_path / ".hermes"
    (root / "profiles" / "worker-profile").mkdir(parents=True)
    root.joinpath("config.yaml").write_text("{}\n", encoding="utf-8")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setattr(kb, "_resolve_hermes_argv", lambda: ["hermes"])
    monkeypatch.setattr(kb, "_resolve_worker_cli_toolsets", lambda _: ["hermes-cli"])
    provided = {"SCOPED_VALUE": "test-value", "HERMES_MCP_SERVERS": json.dumps({
        "host-tools": {"url": "http://127.0.0.1:8765/mcp", "headers": {"Authorization": "Bearer ${SCOPED_VALUE}"}},
    })}
    monkeypatch.setattr(plugins, "resolve_kanban_worker_environment", lambda _: provided)
    captured = {}

    def spawn(cmd, **kwargs):
        captured.update(cmd=cmd, env=kwargs["env"])
        return type("Process", (), {"pid": 1234})()

    monkeypatch.setattr(subprocess, "Popen", spawn)
    kb._default_spawn(_task(), str(workspace))
    assert process_mcp_servers(captured["env"])["host-tools"]["headers"]["Authorization"] == "Bearer test-value"
    assert captured["cmd"][captured["cmd"].index("--toolsets") + 1] == "hermes-cli,mcp-host-tools"
    captured.clear()
    del provided["SCOPED_VALUE"]
    with pytest.raises(ValueError, match="MCP environment value missing"):
        kb._default_spawn(_task(), str(workspace))
    assert captured == {}
