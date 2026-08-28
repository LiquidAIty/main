from __future__ import annotations

import asyncio
from contextlib import nullcontext
import importlib
import inspect
import sys
from pathlib import Path
from types import SimpleNamespace


def _bridge(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parent))
    return importlib.import_module("hermes_acp_bridge")


def test_native_kanban_extensions_create_rejoin_and_read_back(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / ".hermes"))
    monkeypatch.setenv("HERMES_KANBAN_BOARD", "default")
    bridge = _bridge(monkeypatch)
    agent = bridge.LiquidAItyHermesACPAgent.__new__(bridge.LiquidAItyHermesACPAgent)
    params = {
        "title": "Bounded operating map",
        "body": "Exact project-scoped mission",
        "assignee": "liquidaity-hermes-steward",
        "createdBy": "card_hermes_steward",
        "idempotencyKey": "mission-identity",
    }

    async def exercise():
        first = await agent.ext_method("kanban/create", params)
        second = await agent.ext_method("kanban/create", params)
        found = await agent.ext_method(
            "kanban/find",
            {"title": params["title"], "body": params["body"], "createdBy": params["createdBy"]},
        )
        snapshot = await agent.ext_method("kanban/show", {"taskId": first["id"]})
        return first, second, found, snapshot

    first, second, found, snapshot = asyncio.run(exercise())
    assert first["id"].startswith("t_")
    assert first["rejoined"] is False
    assert second["id"] == first["id"]
    assert second["rejoined"] is True
    assert found == {"id": first["id"], "duplicateIds": []}
    assert snapshot["task"]["status"] == "triage"
    assert snapshot["task"]["model_override"] is None
    assert snapshot["task"]["provider_override"] is None
    assert snapshot["children"] == []
    assert snapshot["runs"] == []
    assert [event["kind"] for event in snapshot["events"]] == ["created"]


def test_native_manager_extension_is_an_exact_allowlisted_pass_through(monkeypatch):
    bridge = _bridge(monkeypatch)
    manager_calls = []
    profile_calls = []

    def native_call(method, params):
        manager_calls.append((method, params))
        return {"native_method": method, "native_params": params}

    def profile_call(profile, method, params):
        profile_calls.append((profile, method, params))
        return {"native_method": method, "native_params": params, "profile": profile}

    monkeypatch.setattr(bridge, "_native_manager_call", native_call)
    monkeypatch.setattr(bridge, "_native_profile_scope_call", profile_call)
    agent = bridge.LiquidAItyHermesACPAgent.__new__(bridge.LiquidAItyHermesACPAgent)

    async def exercise():
        described = await agent.ext_method(
            "native/call",
            {"method": "profiles.describe", "params": {"name": "liquidaity-main"}},
        )
        learning = await agent.ext_method(
            "native/call",
            {
                "method": "learning.frames",
                "profile": "liquidaity-main",
                "params": {"cols": 60, "rows": 18, "frames": 2},
            },
        )
        learn = await agent.ext_method(
            "native/call",
            {
                "method": "command.dispatch",
                "profile": "liquidaity-main",
                "params": {"name": "learn", "arg": "this repository"},
            },
        )
        return described, learning, learn

    described, learning, learn = asyncio.run(exercise())
    assert described["native_method"] == "profiles.describe"
    assert learning["profile"] == "liquidaity-main"
    assert learn["native_params"] == {"name": "learn", "arg": "this repository"}
    assert manager_calls == [("profiles.describe", {"name": "liquidaity-main"})]
    assert profile_calls == [
        ("liquidaity-main", "learning.frames", {"cols": 60, "rows": 18, "frames": 2}),
        ("liquidaity-main", "command.dispatch", {"name": "learn", "arg": "this repository"}),
    ]
    for method in ("tools.show", "plugins.list"):
        result = asyncio.run(agent.ext_method("native/call", {
            "method": method, "params": {}, "profile": "liquidaity-main",
        }))
        assert result["native_method"] == method
        assert result["profile"] == "liquidaity-main"
        assert profile_calls[-1] == ("liquidaity-main", method, {})


def test_native_kanban_stop_controls_use_hermes_reclaim_lifecycle(monkeypatch):
    bridge = _bridge(monkeypatch)
    from hermes_cli import kanban_db as kb

    calls = []
    conn = object()
    monkeypatch.setattr(kb, "connect_closing", lambda: nullcontext(conn))
    monkeypatch.setattr(
        kb,
        "reclaim_task",
        lambda actual_conn, task_id, reason=None: calls.append(
            ("reclaim", actual_conn, task_id, reason)
        ) or True,
    )
    monkeypatch.setattr(
        kb,
        "get_run",
        lambda actual_conn, run_id: calls.append(("get_run", actual_conn, run_id))
        or SimpleNamespace(task_id="t_running", ended_at=None),
    )
    monkeypatch.setattr(
        bridge,
        "_task_snapshot",
        lambda task_id: {"task": {"id": task_id, "status": "todo"}},
    )
    agent = bridge.LiquidAItyHermesACPAgent.__new__(bridge.LiquidAItyHermesACPAgent)

    async def exercise():
        reclaimed = await agent.ext_method(
            "kanban/reclaim", {"taskId": "t_running", "reason": "operator reclaim"}
        )
        terminated = await agent.ext_method(
            "kanban/terminate", {"runId": 41, "reason": "operator terminate"}
        )
        return reclaimed, terminated

    reclaimed, terminated = asyncio.run(exercise())
    assert reclaimed["task"]["id"] == "t_running"
    assert terminated["task"]["id"] == "t_running"
    assert calls == [
        ("reclaim", conn, "t_running", "operator reclaim"),
        ("get_run", conn, 41),
        ("reclaim", conn, "t_running", "operator terminate"),
    ]


def test_native_manager_extension_rejects_non_native_or_non_learn_commands(monkeypatch):
    bridge = _bridge(monkeypatch)
    agent = bridge.LiquidAItyHermesACPAgent.__new__(bridge.LiquidAItyHermesACPAgent)

    async def unsupported_method():
        await agent.ext_method("native/call", {"method": "profile/apply", "params": {}})

    async def unsupported_command():
        await agent.ext_method(
            "native/call",
            {
                "method": "command.dispatch",
                "profile": "liquidaity-main",
                "params": {"name": "queue", "arg": "not exposed"},
            },
        )

    for operation, error in (
        (unsupported_method, "hermes_native_method_unsupported:profile/apply"),
        (unsupported_command, "hermes_native_command_unsupported"),
    ):
        try:
            asyncio.run(operation())
        except ValueError as exc:
            assert str(exc) == error
        else:
            raise AssertionError("unsupported native call unexpectedly succeeded")


def test_bridge_has_no_card_profile_projection_or_manager_reimplementation(monkeypatch):
    bridge = _bridge(monkeypatch)
    source = inspect.getsource(bridge.LiquidAItyHermesACPAgent.ext_method)
    module_source = inspect.getsource(bridge)

    assert 'method == "native/call"' in source
    assert 'method == "profile/read"' not in source
    assert 'method == "native/apply"' not in source
    assert "def _read_native_profile" not in module_source
    assert "def _safe_learning" not in module_source
    assert "profiles.configure" in module_source


def test_real_native_profile_reads_are_read_only(monkeypatch, tmp_path):
    root = tmp_path / "hermes-root"
    profile = root / "profiles" / "liquidaity-roundtrip"
    (profile / "skills" / "research").mkdir(parents=True)
    (profile / "skills" / "research" / "SKILL.md").write_text(
        "---\nname: research\ndescription: Temporary round-trip skill\n---\n",
        encoding="utf-8",
    )
    (profile / "profile.yaml").write_text("description: Before\ndescription_auto: false\n", encoding="utf-8")
    (profile / "SOUL.md").write_text("Before instructions", encoding="utf-8")
    config = """\
model:
  provider: openai-codex
  default: gpt-before
tools:
  enabled_toolsets:
    - web
mcp_servers:
  demo:
    command: python
    args: ["-c", "print('unused')"]
    disabled: true
"""
    (profile / "config.yaml").write_text(config, encoding="utf-8")
    root.mkdir(parents=True, exist_ok=True)
    (root / "config.yaml").write_text(config, encoding="utf-8")

    monkeypatch.setenv("HERMES_HOME", str(root))
    bridge = _bridge(monkeypatch)
    agent = bridge.LiquidAItyHermesACPAgent.__new__(bridge.LiquidAItyHermesACPAgent)
    before = {
        path: path.read_bytes()
        for path in (
            profile / "SOUL.md",
            profile / "profile.yaml",
            profile / "config.yaml",
            profile / "skills" / "research" / "SKILL.md",
        )
    }
    acp_stdout = sys.stdout

    async def read_native():
        described = await agent.ext_method(
            "native/call",
            {"method": "profiles.describe", "params": {"name": "liquidaity-roundtrip"}},
        )
        mcp = await agent.ext_method(
            "native/call",
            {"method": "mcp.servers.list", "params": {"profile": "liquidaity-roundtrip"}},
        )
        learning = await agent.ext_method(
            "native/call",
            {
                "method": "learning.frames",
                "profile": "liquidaity-roundtrip",
                "params": {"cols": 60, "rows": 18, "frames": 2},
            },
        )
        return described, mcp, learning

    described, mcp, learning = asyncio.run(read_native())
    assert described["description"] == "Before"
    assert described["soul"] == "Before instructions"
    assert mcp["servers"][0]["name"] == "demo"
    assert isinstance(learning["buckets"], list)
    assert sys.stdout is acp_stdout
    for path, content in before.items():
        assert path.read_bytes() == content
