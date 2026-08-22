from __future__ import annotations

import importlib
from pathlib import Path

import pytest


@pytest.mark.asyncio
async def test_native_kanban_extensions_create_rejoin_and_read_back(monkeypatch, tmp_path):
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
