from __future__ import annotations

import asyncio
import importlib
import inspect
from pathlib import Path

def test_native_kanban_extensions_create_rejoin_and_read_back(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / ".hermes"))
    monkeypatch.setenv("HERMES_KANBAN_BOARD", "default")
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parent))
    bridge = importlib.import_module("hermes_acp_bridge")
    agent = bridge.LiquidAItyHermesACPAgent.__new__(
        bridge.LiquidAItyHermesACPAgent
    )
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
            {
                "title": params["title"],
                "body": params["body"],
                "createdBy": params["createdBy"],
            },
        )
        snapshot = await agent.ext_method(
            "kanban/show", {"taskId": first["id"]}
        )
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


def test_native_profile_and_mcp_extensions_use_managers_and_redact_transport_values(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parent))
    bridge = importlib.import_module("hermes_acp_bridge")
    calls = []
    profile_calls = []

    def native_call(method, params):
        calls.append((method, params))
        if method == "profiles.describe":
            return {
                "name": "liquidaity-main",
                "description": "Planner",
                "soul": "Instructions",
                "model": {"provider": "openai-codex", "default": "gpt-test"},
                "skills": [{"name": "research", "enabled": True}],
                "toolsets": [{"name": "web", "enabled": True}],
                "toolsets_pinned": True,
                "mcp_servers": [{"name": "liquidaity", "enabled": True}],
            }
        if method == "mcp.servers.list":
            return {
                "servers": [{
                    "name": "liquidaity",
                    "transport": "http",
                    "url": "https://private.example/mcp",
                    "headers": {"Authorization": "Bearer secret"},
                    "env": ["SECRET_NAME"],
                    "auth": "header",
                    "enabled": True,
                    "tools": {"include": ["main.context"]},
                }]
            }
        if method == "mcp.servers.test":
            return {
                "ok": False,
                "error": "Authorization: Bearer super-secret access_token=also-secret",
                "tools": [],
                "oauth_needed": False,
            }
        raise AssertionError(method)

    def native_profile_call(profile, method, params):
        profile_calls.append((profile, method, params))
        if method == "learning.frames":
            return {
                "count": 2,
                "summary": "One memory and one skill",
                "buckets": [{
                    "label": "Today",
                    "date": "2026-08-23",
                    "nodes": [{
                        "id": "skill:research",
                        "label": "research",
                        "fullLabel": "Research skill",
                        "meta": "used 2 times",
                    }],
                }],
            }
        raise AssertionError(method)

    monkeypatch.setattr(bridge, "_native_manager_call", native_call)
    monkeypatch.setattr(bridge, "_native_profile_scope_call", native_profile_call)
    agent = bridge.LiquidAItyHermesACPAgent.__new__(bridge.LiquidAItyHermesACPAgent)

    async def exercise():
        read = await agent.ext_method("profile/read", {"name": "liquidaity-main"})
        tested = await agent.ext_method(
            "mcp/test", {"profile": "liquidaity-main", "name": "liquidaity"}
        )
        return read, tested

    read, tested = asyncio.run(exercise())
    server = read["profile"]["mcpServers"][0]
    assert server == {
        "name": "liquidaity",
        "transport": "http",
        "enabled": True,
        "auth": "header",
        "credentialStatus": "configured",
        "toolFilter": ["main.context"],
    }
    assert tested["ok"] is False
    assert read["profile"]["learning"]["buckets"][0]["nodes"][0]["id"] == "skill:research"
    assert "super-secret" not in tested["error"]
    assert "also-secret" not in tested["error"]
    assert calls == [
        ("profiles.describe", {"name": "liquidaity-main"}),
        ("mcp.servers.list", {"profile": "liquidaity-main"}),
        ("mcp.servers.test", {"profile": "liquidaity-main", "name": "liquidaity"}),
    ]
    assert profile_calls == [
        ("liquidaity-main", "learning.frames", {"cols": 60, "rows": 18, "frames": 2}),
    ]


def test_native_profile_extension_has_no_card_to_profile_write_method(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parent))
    bridge = importlib.import_module("hermes_acp_bridge")
    source = inspect.getsource(bridge.LiquidAItyHermesACPAgent.ext_method)

    assert 'method == "profile/apply"' not in source
    assert 'method == "native/apply"' in source
    assert '"profiles.configure"' in source


def test_native_profile_readback_through_real_managers_is_read_only(monkeypatch, tmp_path):
    root = tmp_path / "hermes-root"
    profile = root / "profiles" / "liquidaity-roundtrip"
    (profile / "skills" / "research").mkdir(parents=True)
    (profile / "skills" / "research" / "SKILL.md").write_text(
        "---\nname: research\ndescription: Temporary round-trip skill\n---\n",
        encoding="utf-8",
    )
    (profile / "profile.yaml").write_text(
        "description: Before\ndescription_auto: false\n",
        encoding="utf-8",
    )
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
    args: [\"-c\", \"print('unused')\"]
    disabled: true
"""
    (profile / "config.yaml").write_text(config, encoding="utf-8")
    root.mkdir(parents=True, exist_ok=True)
    (root / "config.yaml").write_text(config, encoding="utf-8")

    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parent))
    bridge = importlib.import_module("hermes_acp_bridge")
    agent = bridge.LiquidAItyHermesACPAgent.__new__(bridge.LiquidAItyHermesACPAgent)

    soul_before = (profile / "SOUL.md").read_bytes()
    profile_meta_before = (profile / "profile.yaml").read_bytes()
    config_before = (profile / "config.yaml").read_bytes()
    skill_before = (profile / "skills" / "research" / "SKILL.md").read_bytes()

    async def read_profile():
        return await agent.ext_method(
            "profile/read", {"name": "liquidaity-roundtrip"}
        )

    readback = asyncio.run(read_profile())
    assert readback["profile"]["description"] == "Before"
    assert readback["profile"]["soul"] == "Before instructions"
    assert readback["profile"]["mcpServers"] == [{
        "name": "demo",
        "transport": "stdio",
        "enabled": False,
        "auth": None,
        "credentialStatus": "not_required",
        "toolFilter": [],
    }]
    assert (profile / "SOUL.md").read_bytes() == soul_before
    assert (profile / "profile.yaml").read_bytes() == profile_meta_before
    assert (profile / "config.yaml").read_bytes() == config_before
    assert (profile / "skills" / "research" / "SKILL.md").read_bytes() == skill_before
