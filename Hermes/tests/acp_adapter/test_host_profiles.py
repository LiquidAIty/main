"""Focused no-provider proof for the contained ACP host extension."""

from __future__ import annotations

import copy
import hashlib
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from acp_adapter.host_profiles import (
    HostSessionConfigError,
    activate_host_script_fallback,
    allocate_host_child_execution,
    apply_host_session_config,
    current_host_script_config,
    current_host_tool_call_meta,
    finish_host_child_execution,
    host_execution_scope,
    parse_host_session_config,
)
from agent.background_review import (
    _BackgroundReviewRun,
    finish_background_review_host_execution,
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
                "toolCallMeta": {"host/execution-context": "root-context"},
            }
        }
    }


def _host_script() -> dict:
    source = '''CARD_SCRIPT = {"mode": "tool_recipe"}\nfrom hermes_tools import output\noutput.emit({"result": {}})\n'''
    return {
        "version": 3,
        "source": source,
        "sourceHash": hashlib.sha256(source.encode()).hexdigest(),
        "compiledHash": "b" * 64,
        "mode": "tool_recipe",
        "inputSchema": {
            "type": "object", "properties": {"focus": {"type": "string"}},
        },
        "outputSchema": {"type": "object", "properties": {}},
        "toolAliases": {"think.context": "mcp__liquidaity-card__think_context"},
        "fallbackToolAliases": {"think.context": "mcp__liquidaity-card__think_context"},
        "toolStates": {"think.context": 1},
        "timeoutSeconds": 12,
        "maxToolCalls": 3,
        "maxOutputBytes": 4096,
    }


def test_parser_accepts_only_namespaced_bounded_noncredential_configuration() -> None:
    assert parse_host_session_config({}) is None
    parsed = parse_host_session_config(_metadata())
    assert parsed is not None
    assert parsed["enabledToolsets"] == ["memory", "mcp-main"]
    assert parsed["enabledTools"] == ["delegate_task"]
    assert parsed["hostSessionKey"] == "project:conversation:card"
    assert parsed["systemPrompt"] == "Saved Card system prompt"
    assert parsed["toolCallMeta"] == {"host/execution-context": "root-context"}

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


def test_parser_binds_host_script_hash_and_execution_scope() -> None:
    metadata = _metadata()
    metadata["hermes"]["sessionConfig"]["hostScript"] = _host_script()
    parsed = parse_host_session_config(metadata)
    assert parsed["hostScript"]["toolAliases"] == {
        "think.context": "mcp__liquidaity-card__think_context"
    }
    assert parsed["hostScript"]["version"] == 3
    agent = SimpleNamespace(_host_tool_call_meta={}, _host_session_config=parsed)
    assert current_host_script_config() is None
    with host_execution_scope(agent):
        assert current_host_script_config()["sourceHash"] == _host_script()["sourceHash"]
    assert current_host_script_config() is None

    tampered = _metadata()
    tampered_script = _host_script()
    tampered_script["source"] += "# changed"
    tampered["hermes"]["sessionConfig"]["hostScript"] = tampered_script
    with pytest.raises(
        HostSessionConfigError,
        match="hermes_host_config_host_script_hash_mismatch",
    ):
        parse_host_session_config(tampered)


def test_saved_script_is_one_typed_model_tool_and_not_a_lifecycle_controller(monkeypatch) -> None:
    metadata = _metadata()
    metadata["hermes"]["sessionConfig"]["hostScript"] = _host_script()
    definitions = {
        "delegate_task": _definition("delegate_task"),
        "execute_host_script": _definition("execute_host_script"),
    }
    monkeypatch.setitem(
        sys.modules,
        "model_tools",
        SimpleNamespace(get_tool_definitions=lambda **_kwargs: []),
    )
    monkeypatch.setitem(
        sys.modules,
        "tools.registry",
        SimpleNamespace(registry=SimpleNamespace(
            get_definitions=lambda names, quiet=True: [
                copy.deepcopy(definitions[name]) for name in names
            ],
        )),
    )
    monkeypatch.setitem(
        sys.modules,
        "agent.memory_manager",
        SimpleNamespace(inject_memory_provider_tools=lambda _agent: None),
    )
    agent = SimpleNamespace(disabled_toolsets=[])
    apply_host_session_config(agent, parse_host_session_config(metadata))
    by_name = {item["function"]["name"]: item for item in agent.tools}
    assert by_name["execute_host_script"]["function"]["parameters"] == _host_script()["inputSchema"]
    assert by_name["delegate_task"]["function"]["parameters"] == {
        "type": "object", "properties": {},
    }


def test_team_policy_is_bounded_and_off_can_remove_only_team_delegation(monkeypatch) -> None:
    metadata = _metadata()
    metadata["hermes"]["sessionConfig"]["delegationRoles"] = ["leaf"]
    metadata["hermes"]["sessionConfig"]["team"] = {
        "mode": "auto", "maxWorkers": 3, "retryLimit": 2,
        "worker": {"provider": "openai-codex", "model": "gpt-5.6-luna"},
        "lead": {"provider": "openai-codex", "model": "gpt-5.6-terra"},
    }
    parsed = parse_host_session_config(metadata)
    assert parsed["team"]["maxWorkers"] == 3
    assert parsed["team"]["lead"]["model"] == "gpt-5.6-terra"

    native = _definition("delegate_task")
    native["function"]["parameters"]["properties"] = {
        "goal": {"type": "string"},
        "role": {"type": "string", "enum": ["leaf", "orchestrator", "team"]},
    }
    monkeypatch.setitem(sys.modules, "model_tools", SimpleNamespace(
        get_tool_definitions=lambda **_kwargs: [],
    ))
    monkeypatch.setitem(sys.modules, "tools.registry", SimpleNamespace(
        registry=SimpleNamespace(get_definitions=lambda names, quiet=True: [
            copy.deepcopy(native) for name in names if name == "delegate_task"
        ]),
    ))
    agent = SimpleNamespace(disabled_toolsets=[])
    apply_host_session_config(agent, parsed)
    assert agent.tools[0]["function"]["parameters"]["properties"]["role"]["enum"] == ["leaf"]

    off = _metadata()
    off["hermes"]["sessionConfig"]["delegationRoles"] = []
    apply_host_session_config(agent, parse_host_session_config(off))
    assert all(item["function"]["name"] != "delegate_task" for item in agent.tools)


def test_host_delegation_roles_narrow_only_the_session_schema(monkeypatch) -> None:
    metadata = _metadata()
    metadata["hermes"]["sessionConfig"]["delegationRoles"] = ["team", "leaf"]
    native = _definition("delegate_task")
    native["function"]["parameters"]["properties"] = {
        "goal": {"type": "string"},
        "role": {
            "type": "string",
            "enum": ["leaf", "orchestrator", "team"],
            "default": "leaf",
        },
        "tasks": {"type": "array"},
    }
    monkeypatch.setitem(
        sys.modules,
        "model_tools",
        SimpleNamespace(get_tool_definitions=lambda **_kwargs: []),
    )
    monkeypatch.setitem(
        sys.modules,
        "tools.registry",
        SimpleNamespace(registry=SimpleNamespace(
            get_definitions=lambda names, quiet=True: [copy.deepcopy(native)],
        )),
    )
    agent = SimpleNamespace(disabled_toolsets=[])
    apply_host_session_config(agent, parse_host_session_config(metadata))

    projected = agent.tools[0]["function"]["parameters"]["properties"]
    assert projected["role"]["enum"] == ["team", "leaf"]
    assert projected["role"]["default"] == "team"
    assert "tasks" in projected
    assert native["function"]["parameters"]["properties"]["role"]["enum"] == [
        "leaf", "orchestrator", "team",
    ]

    invalid = _metadata()
    invalid["hermes"]["sessionConfig"]["delegationRoles"] = ["manager"]
    with pytest.raises(
        HostSessionConfigError,
        match="hermes_host_config_delegation_role_invalid:manager",
    ):
        parse_host_session_config(invalid)


def test_failed_host_script_reveals_only_its_pre_registered_saved_aliases(monkeypatch) -> None:
    metadata = _metadata()
    metadata["hermes"]["sessionConfig"]["enabledTools"] = []
    metadata["hermes"]["sessionConfig"]["hostScript"] = _host_script()
    definitions = {
        "mcp__liquidaity-card__think_context": _definition(
            "mcp__liquidaity-card__think_context"
        ),
    }
    monkeypatch.setitem(
        sys.modules,
        "tools.registry",
        SimpleNamespace(registry=SimpleNamespace(
            get_definitions=lambda names, quiet=True: [
                copy.deepcopy(definitions[name]) for name in names
            ],
        )),
    )
    invalidate = MagicMock()
    agent = SimpleNamespace(
        tools=[],
        valid_tool_names=set(),
        _host_tool_call_meta={},
        _host_session_config=parse_host_session_config(metadata),
        _invalidate_system_prompt=invalidate,
    )

    with host_execution_scope(agent):
        assert activate_host_script_fallback() == ["think.context"]

    assert agent.valid_tool_names == {"mcp__liquidaity-card__think_context"}
    assert [item["function"]["name"] for item in agent.tools] == [
        "mcp__liquidaity-card__think_context"
    ]
    invalidate.assert_called_once_with()


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
                "toolCallMeta": {"host/execution-context": "child-context"},
            }
        return {"closed": True}

    parent = SimpleNamespace(
        _host_execution_context_id="root-context",
        _host_execution_session_id="acp-session",
        _host_execution_requester=requester,
    )
    child = SimpleNamespace(
        _subagent_id="sa-1", provider="openai-codex", model="gpt-5.6-luna"
    )
    assert allocate_host_child_execution(parent, child) is True
    assert calls[0] == (
        "session/create_execution_context",
        {
            "sessionId": "acp-session",
            "parentExecutionContextId": "root-context",
            "nativeChildId": "sa-1",
            "provider": "openai-codex",
            "model": "gpt-5.6-luna",
        },
    )
    with host_execution_scope(child):
        assert current_host_tool_call_meta() == {
            "host/execution-context": "child-context"
        }
    assert current_host_tool_call_meta() is None
    finish_host_child_execution(child, "completed")
    assert calls[1] == (
        "session/finish_execution_context",
        {
            "executionContextId": "child-context",
            "state": "completed",
            "configuration": {
                "provider": "openai-codex",
                "model": "gpt-5.6-luna",
                "fallbackOccurred": False,
                "fallbackReason": "",
            },
        },
    )
    assert "credential" not in repr(calls).lower()


def test_background_review_closes_its_host_child_once_with_bounded_usage() -> None:
    calls = []

    def requester(method, params):
        calls.append((method, params))
        if method == "session/create_execution_context":
            return {
                "executionContextId": "review-context",
                "runId": "review-run",
                "toolCallMeta": {"host/execution-context": "review-context"},
            }
        return {"closed": True}

    parent = SimpleNamespace(
        _host_execution_context_id="root-context",
        _host_execution_session_id="acp-session",
        _host_execution_requester=requester,
    )
    review_run = _BackgroundReviewRun()
    review_run._subagent_id = "background-review"
    review_run.provider = "openai-codex"
    review_run.model = "gpt-5.6-luna"

    assert allocate_host_child_execution(parent, review_run) is True
    finish_background_review_host_execution(
        review_run,
        "completed",
        usage={
            "input_tokens": 321,
            "output_tokens": 45,
            "estimated_cost_usd": 0.0123,
            "provider": "openai-codex",
            "model": "gpt-5.6-luna",
        },
    )
    finish_background_review_host_execution(review_run, "failed")

    assert calls == [
        (
            "session/create_execution_context",
            {
                "sessionId": "acp-session",
                "parentExecutionContextId": "root-context",
                "nativeChildId": "background-review",
                "provider": "openai-codex",
                "model": "gpt-5.6-luna",
            },
        ),
        (
            "session/finish_execution_context",
            {
                "executionContextId": "review-context",
                "state": "completed",
                "usage": {
                    "providerInputTokens": 321,
                    "providerOutputTokens": 45,
                    "totalCostUsd": 0.0123,
                },
                "configuration": {
                    "provider": "openai-codex",
                    "model": "gpt-5.6-luna",
                    "fallbackOccurred": False,
                    "fallbackReason": "",
                },
            },
        ),
    ]


def test_unconfigured_upstream_agents_do_not_activate_the_host_extension() -> None:
    assert allocate_host_child_execution(MagicMock(), MagicMock()) is False


class _NoopSessionDb:
    def get_session(self, *_args, **_kwargs):
        return None

    def create_session(self, *_args, **_kwargs):
        return None

    def update_session(self, *_args, **_kwargs):
        return None


class _HistorySessionDb:
    def __init__(self) -> None:
        self.messages = [
            {"role": "user", "content": "Earlier question."},
            {"role": "assistant", "content": "Earlier answer."},
        ]
        self.read_calls: list[tuple[tuple, dict]] = []

    def get_session(self, session_id):
        return {"id": session_id, "source": "acp"}

    def get_messages_as_conversation(self, *args, **kwargs):
        self.read_calls.append((args, kwargs))
        return self.messages


def test_read_session_history_does_not_restore_an_executable_agent() -> None:
    db = _HistorySessionDb()

    def forbidden_agent_factory(**_kwargs):
        raise AssertionError("history read must not construct an AIAgent")

    manager = SessionManager(agent_factory=forbidden_agent_factory, db=db)
    history = manager.read_session_history("persisted-session")

    assert history == db.messages
    assert history is not db.messages
    assert db.read_calls == [(('persisted-session',), {})]


@pytest.mark.asyncio
async def test_read_history_extension_has_no_execution_configuration_fields() -> None:
    manager = SessionManager(agent_factory=lambda: MagicMock(), db=_NoopSessionDb())
    manager.read_session_history = MagicMock(return_value=[
        {"role": "user", "content": "Earlier question."},
    ])
    acp_agent = HermesACPAgent(session_manager=manager)
    acp_agent._replay_history = AsyncMock()
    acp_agent._register_session_mcp_servers = AsyncMock()
    manager.configure_host_session = MagicMock()

    result = await acp_agent.ext_method("session/read_history", {
        "sessionId": "persisted-session",
    })

    assert result == {
        "replayed": True,
        "sessionId": "persisted-session",
        "messageCount": 1,
    }
    acp_agent._replay_history.assert_awaited_once_with(
        "persisted-session",
        [{"role": "user", "content": "Earlier question."}],
    )
    acp_agent._register_session_mcp_servers.assert_not_awaited()
    manager.configure_host_session.assert_not_called()

    with pytest.raises(
        ValueError,
        match="hermes_history_extension_unknown_field:mcpServers",
    ):
        await acp_agent.ext_method("session/read_history", {
            "sessionId": "persisted-session",
            "mcpServers": [],
        })


@pytest.mark.asyncio
async def test_delete_history_extension_uses_only_native_session_identity() -> None:
    manager = SessionManager(agent_factory=lambda: MagicMock(), db=_NoopSessionDb())
    manager.remove_session = MagicMock(return_value=True)
    acp_agent = HermesACPAgent(session_manager=manager)

    result = await acp_agent.ext_method("session/delete_history", {
        "sessionId": "persisted-session",
    })

    assert result == {
        "deleted": True,
        "sessionId": "persisted-session",
    }
    manager.remove_session.assert_called_once_with("persisted-session")

    with pytest.raises(
        ValueError,
        match="hermes_history_delete_unknown_field:mcpServers",
    ):
        await acp_agent.ext_method("session/delete_history", {
            "sessionId": "persisted-session",
            "mcpServers": [],
        })


def test_remove_session_refuses_an_active_native_turn() -> None:
    agent = SimpleNamespace(model="model", tools=[], enabled_toolsets=[], disabled_toolsets=[])
    manager = SessionManager(agent_factory=lambda: agent, db=_NoopSessionDb())
    state = manager.create_session(cwd=".")
    state.is_running = True

    with pytest.raises(RuntimeError, match="hermes_session_turn_already_running"):
        manager.remove_session(state.session_id)


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


@pytest.mark.asyncio
async def test_trusted_host_model_selection_pins_native_codex_responses() -> None:
    original = SimpleNamespace(
        model="gpt-5.6-luna",
        provider="openai-codex",
        base_url="https://chatgpt.com/backend-api/codex",
        api_mode="codex_app_server",
        tools=[],
        enabled_toolsets=[],
        disabled_toolsets=[],
    )
    replacement = SimpleNamespace(
        model="gpt-5.6-luna",
        provider="openai-codex",
        base_url=original.base_url,
        api_mode="codex_responses",
        tools=[],
        enabled_toolsets=[],
        disabled_toolsets=[],
    )
    manager = SessionManager(agent_factory=lambda: original, db=_NoopSessionDb())
    state = manager.create_session(cwd=".", host_config=parse_host_session_config(_metadata()))
    manager._make_agent = MagicMock(return_value=replacement)
    manager.configure_host_session = MagicMock(return_value=state)
    manager.save_session = MagicMock()
    acp_agent = HermesACPAgent(session_manager=manager)
    acp_agent._resolve_model_selection = MagicMock(
        return_value=("openai-codex", "gpt-5.6-luna")
    )

    await acp_agent.set_session_model(
        "openai-codex:gpt-5.6-luna",
        state.session_id,
        apiMode="codex_responses",
        openaiRuntime="auto",
    )

    assert state.agent is replacement
    assert state.agent.api_mode == "codex_responses"
    manager._make_agent.assert_called_once_with(
        session_id=state.session_id,
        cwd=state.cwd,
        model="gpt-5.6-luna",
        requested_provider="openai-codex",
        base_url=original.base_url,
        api_mode="codex_responses",
        host_config=state.host_config,
    )
    manager.configure_host_session.assert_called_once_with(state, state.host_config)
    manager.save_session.assert_called_once_with(state.session_id)


@pytest.mark.asyncio
async def test_native_runtime_selection_rejects_app_server_conflict() -> None:
    agent = SimpleNamespace(
        model="gpt-5.6-luna",
        provider="openai-codex",
        tools=[],
        enabled_toolsets=[],
        disabled_toolsets=[],
    )
    manager = SessionManager(agent_factory=lambda: agent, db=_NoopSessionDb())
    state = manager.create_session(cwd=".")
    acp_agent = HermesACPAgent(session_manager=manager)

    with pytest.raises(ValueError, match="hermes_host_openai_runtime_conflict"):
        await acp_agent.set_session_model(
            "openai-codex:gpt-5.6-luna",
            state.session_id,
            apiMode="codex_app_server",
            openaiRuntime="auto",
        )
