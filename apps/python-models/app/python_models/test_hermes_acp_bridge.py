from __future__ import annotations

import asyncio
import importlib
from pathlib import Path

import pytest

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
        "model": "gpt-5.6-luna",
        "provider": "openai-codex",
        "skills": [],
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
    assert snapshot["task"]["model_override"] == "gpt-5.6-luna"
    assert snapshot["task"]["provider_override"] == "openai-codex"
    assert snapshot["children"] == []
    assert snapshot["runs"] == []
    assert [event["kind"] for event in snapshot["events"]] == ["created"]


def test_native_profile_and_mcp_extensions_use_managers_and_redact_transport_values(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parent))
    bridge = importlib.import_module("hermes_acp_bridge")
    calls = []

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
        if method == "profiles.configure":
            return {"ok": True, "applied": {"description": True}}
        if method == "mcp.servers.test":
            return {
                "ok": False,
                "error": "Authorization: Bearer super-secret access_token=also-secret",
                "tools": [],
                "oauth_needed": False,
            }
        raise AssertionError(method)

    monkeypatch.setattr(bridge, "_native_manager_call", native_call)
    agent = bridge.LiquidAItyHermesACPAgent.__new__(bridge.LiquidAItyHermesACPAgent)

    async def exercise():
        read = await agent.ext_method("profile/read", {"name": "liquidaity-main"})
        applied = await agent.ext_method(
            "profile/apply", {"name": "liquidaity-main", "description": "Planner"}
        )
        tested = await agent.ext_method(
            "mcp/test", {"profile": "liquidaity-main", "name": "liquidaity"}
        )
        return read, applied, tested

    read, applied, tested = asyncio.run(exercise())
    server = read["profile"]["mcpServers"][0]
    assert server == {
        "name": "liquidaity",
        "transport": "http",
        "enabled": True,
        "auth": "header",
        "credentialStatus": "configured",
        "toolFilter": ["main.context"],
    }
    assert applied == {"ok": True, "applied": {"description": True}}
    assert tested["ok"] is False
    assert "super-secret" not in tested["error"]
    assert "also-secret" not in tested["error"]
    assert calls == [
        ("profiles.describe", {"name": "liquidaity-main"}),
        ("mcp.servers.list", {"profile": "liquidaity-main"}),
        ("profiles.configure", {"name": "liquidaity-main", "description": "Planner"}),
        ("mcp.servers.test", {"profile": "liquidaity-main", "name": "liquidaity"}),
    ]


def test_native_profile_extension_rejects_unknown_and_secret_fields(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parent))
    bridge = importlib.import_module("hermes_acp_bridge")
    agent = bridge.LiquidAItyHermesACPAgent.__new__(bridge.LiquidAItyHermesACPAgent)

    with pytest.raises(ValueError, match="hermes_profile_apply_unknown_field:apiKey"):
        asyncio.run(agent.ext_method(
            "profile/apply",
            {"name": "liquidaity-main", "apiKey": "must-not-pass"},
        ))


def test_native_profile_extensions_round_trip_through_real_managers(monkeypatch, tmp_path):
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

    async def exercise():
        before = await agent.ext_method(
            "profile/read", {"name": "liquidaity-roundtrip"}
        )
        applied = await agent.ext_method(
            "profile/apply",
            {
                "name": "liquidaity-roundtrip",
                "description": "After",
                "soul": "After instructions",
                "provider": "openai-codex",
                "model": "gpt-after",
                "disabledSkills": ["research"],
                "enabledToolsets": ["web"],
                "enabledMcpServers": ["demo"],
            },
        )
        after = await agent.ext_method(
            "profile/read", {"name": "liquidaity-roundtrip"}
        )
        return before, applied, after

    before, applied, after = asyncio.run(exercise())
    assert before["profile"]["description"] == "Before"
    assert before["profile"]["soul"] == "Before instructions"
    assert before["profile"]["mcpServers"] == [{
        "name": "demo",
        "transport": "stdio",
        "enabled": False,
        "auth": None,
        "credentialStatus": "not_required",
        "toolFilter": [],
    }]
    assert applied == {
        "ok": True,
        "applied": {
            "soul": True,
            "description": True,
            "model": True,
            "skills": True,
            "toolsets": True,
            "mcp_servers": True,
        },
    }
    assert after["profile"]["description"] == "After"
    assert after["profile"]["soul"] == "After instructions"
    assert after["profile"]["model"] == {
        "provider": "openai-codex",
        "default": "gpt-after",
    }
    assert {item["name"]: item["enabled"] for item in after["profile"]["skills"]} == {
        "research": False,
    }
    assert next(
        item for item in after["profile"]["toolsets"] if item["name"] == "web"
    )["enabled"] is True
    assert after["profile"]["mcpServers"][0]["enabled"] is True
