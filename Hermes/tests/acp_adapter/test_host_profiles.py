"""Focused no-provider proof for the contained ACP host extension."""

from __future__ import annotations

import copy
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from acp_adapter.host_profiles import (
    HostSessionConfigError,
    allocate_host_child_execution,
    apply_host_session_config,
    current_host_tool_call_meta,
    finish_host_child_execution,
    host_execution_scope,
    parse_host_session_config,
)
from acp_adapter.server import HermesACPAgent
from acp_adapter.session import SessionManager


def _definition(name: str) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": name,
            "parameters": {"type": "object", "properties": {}},
        },
    }


def _metadata() -> dict:
    return {
        "hermes": {
            "sessionConfig": {
                "enabledToolsets": ["memory", "mcp-main"],
                "enabledTools": ["delegate_task"],
                "executionContextId": "root-context",
                "hostSessionKey": "project:conversation:card",
                "systemPrompt": "Saved Card system prompt",
                "toolCallMeta": {"liquidaity/execution": "root-context"},
            }
        }
    }


def test_parser_accepts_only_namespaced_bounded_noncredential_configuration() -> None:
    assert parse_host_session_config({}) is None
    parsed = parse_host_session_config(_metadata())
    assert parsed is not None
    assert parsed["enabledToolsets"] == ["memory", "mcp-main"]
    assert parsed["enabledTools"] == ["delegate_task"]
    assert parsed["hostSessionKey"] == "project:conversation:card"
    assert parsed["systemPrompt"] == "Saved Card system prompt"
    assert parsed["toolCallMeta"] == {"liquidaity/execution": "root-context"}

    generic = _metadata()
    generic["hermes"]["sessionConfig"]["toolCallMeta"] = {
        "example.host/execution": "root-context"
    }
    assert parse_host_session_config(generic)["toolCallMeta"] == {
        "example.host/execution": "root-context"
    }

    multiple = _metadata()
    multiple["hermes"]["sessionConfig"]["toolCallMeta"]["example.host/execution"] = (
        "root-context"
    )
    with pytest.raises(
        HostSessionConfigError,
        match="hermes_host_config_tool_call_meta_too_many",
    ):
        parse_host_session_config(multiple)

    forged = _metadata()
    forged["hermes"]["sessionConfig"]["apiKey"] = "secret"
    with pytest.raises(
        HostSessionConfigError,
        match="hermes_host_session_config_unknown_field:apiKey",
    ):
        parse_host_session_config(forged)


def test_saved_card_surface_is_the_exact_native_and_mcp_surface(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    definitions = {
        "memory": _definition("memory"),
        "mcp-main-tool": _definition("mcp-main-tool"),
        "delegate_task": _definition("delegate_task"),
    }

    def get_tool_definitions(*, enabled_toolsets, disabled_toolsets, quiet_mode):
        assert isinstance(disabled_toolsets, list)
        assert quiet_mode is True
        selected = []
        if "memory" in enabled_toolsets:
            selected.append(copy.deepcopy(definitions["memory"]))
        if "mcp-main" in enabled_toolsets:
            selected.append(copy.deepcopy(definitions["mcp-main-tool"]))
        return selected

    registry = SimpleNamespace(
        get_definitions=lambda names, quiet=True: [
            copy.deepcopy(definitions[name]) for name in names if name in definitions
        ]
    )
    monkeypatch.setitem(
        sys.modules,
        "model_tools",
        SimpleNamespace(get_tool_definitions=get_tool_definitions),
    )
    monkeypatch.setitem(sys.modules, "tools.registry", SimpleNamespace(registry=registry))
    monkeypatch.setitem(
        sys.modules,
        "agent.memory_manager",
        SimpleNamespace(inject_memory_provider_tools=lambda _agent: None),
    )

    agent = SimpleNamespace(disabled_toolsets=[], invalidations=0)
    agent._invalidate_system_prompt = lambda: setattr(
        agent, "invalidations", agent.invalidations + 1
    )
    apply_host_session_config(agent, parse_host_session_config(_metadata()))

    assert agent.valid_tool_names == {"memory", "mcp-main-tool", "delegate_task"}
    assert agent.ephemeral_system_prompt == "Saved Card system prompt"
    assert agent.invalidations == 1

    blocked = SimpleNamespace(disabled_toolsets=["memory"])
    with pytest.raises(
        HostSessionConfigError,
        match="hermes_host_config_tool_blocked:memory",
    ):
        apply_host_session_config(blocked, {
            "enabledToolsets": [],
            "enabledTools": ["memory"],
        })


def test_generic_child_execution_uses_only_host_issued_context_metadata() -> None:
    calls = []

    def requester(method, params):
        calls.append((method, params))
        if method == "session/create_execution_context":
            return {
                "executionContextId": "child-context",
                "runId": "child-run",
                "toolCallMeta": {"liquidaity/execution": "child-context"},
            }
        return {"closed": True}

    parent = SimpleNamespace(
        _host_execution_context_id="root-context",
        _host_execution_session_id="acp-session",
        _host_execution_requester=requester,
    )
    child = SimpleNamespace(_subagent_id="sa-1")
    assert allocate_host_child_execution(parent, child) is True
    assert calls[0] == (
        "session/create_execution_context",
        {
            "sessionId": "acp-session",
            "parentExecutionContextId": "root-context",
            "nativeChildId": "sa-1",
        },
    )
    with host_execution_scope(child):
        assert current_host_tool_call_meta() == {
            "liquidaity/execution": "child-context"
        }
    assert current_host_tool_call_meta() is None
    finish_host_child_execution(child, "completed")
    assert calls[1] == (
        "session/finish_execution_context",
        {"executionContextId": "child-context", "state": "completed"},
    )
    assert "credential" not in repr(calls).lower()


def test_unconfigured_upstream_agents_do_not_activate_the_host_extension() -> None:
    assert allocate_host_child_execution(MagicMock(), MagicMock()) is False


class _NoopSessionDb:
    def get_session(self, *_args, **_kwargs):
        return None

    def create_session(self, *_args, **_kwargs):
        return None

    def update_session(self, *_args, **_kwargs):
        return None


@pytest.mark.asyncio
async def test_configure_host_extension_refreshes_one_idle_native_session() -> None:
    agent = SimpleNamespace(model="model", tools=[], enabled_toolsets=[], disabled_toolsets=[])
    manager = SessionManager(agent_factory=lambda: agent, db=_NoopSessionDb())
    state = manager.create_session(cwd=".")
    acp_agent = HermesACPAgent(session_manager=manager)
    captured: dict[str, object] = {}

    async def register(current, servers):
        captured["state"] = current
        captured["servers"] = servers

    def configure(current, config):
        assert current.is_running is False
        current.host_config = config
        captured["config"] = config
        return current

    acp_agent._register_session_mcp_servers = register
    manager.configure_host_session = configure
    result = await acp_agent.ext_method("session/configure_host", {
        "sessionId": state.session_id,
        "mcpServers": [{
            "type": "http",
            "name": "official",
            "url": "http://127.0.0.1:8765/mcp",
            "headers": [{"name": "Authorization", "value": "Bearer opaque"}],
        }],
        "_meta": _metadata(),
    })

    assert result == {
        "configured": True,
        "sessionId": state.session_id,
        "toolCount": 0,
    }
    assert state.is_running is False
    assert captured["state"] is state
    assert captured["servers"][0].name == "official"
    assert captured["config"]["executionContextId"] == "root-context"


@pytest.mark.asyncio
async def test_configure_host_extension_fails_closed_during_an_active_turn() -> None:
    agent = SimpleNamespace(model="model", tools=[], enabled_toolsets=[], disabled_toolsets=[])
    manager = SessionManager(agent_factory=lambda: agent, db=_NoopSessionDb())
    state = manager.create_session(cwd=".")
    state.is_running = True
    acp_agent = HermesACPAgent(session_manager=manager)

    with pytest.raises(RuntimeError, match="hermes_host_config_turn_in_progress"):
        await acp_agent.ext_method("session/configure_host", {
            "sessionId": state.session_id,
            "mcpServers": [],
            "_meta": _metadata(),
        })
