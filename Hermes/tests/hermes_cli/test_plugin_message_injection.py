"""Tests for plugin message injection across CLI and gateway hosts."""

from queue import SimpleQueue
from threading import RLock
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import yaml

from hermes_cli.plugins import PluginContext, PluginManager, PluginManifest


def _context(name: str = "notify-plugin") -> tuple[PluginContext, PluginManager]:
    manager = PluginManager()
    manifest = PluginManifest(name=name, key=name, source="user")
    return PluginContext(manifest, manager), manager


def _write_plugin_config(tmp_path, monkeypatch, entry: dict) -> None:
    hermes_home = tmp_path / "hermes"
    hermes_home.mkdir()
    (hermes_home / "config.yaml").write_text(
        yaml.safe_dump({"plugins": {"entries": {"notify-plugin": entry}}})
    )
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))


def test_cli_idle_injection_keeps_existing_queue_behaviour():
    context, manager = _context()
    cli = SimpleNamespace(
        _agent_running=False,
        _pending_input=SimpleQueue(),
        _interrupt_queue=SimpleQueue(),
    )
    manager._cli_ref = cli

    assert context.inject_message("new input") is True
    assert cli._pending_input.get_nowait() == "new input"
    assert cli._interrupt_queue.empty()


def test_cli_running_injection_keeps_existing_interrupt_behaviour():
    context, manager = _context()
    cli = SimpleNamespace(
        _agent_running=True,
        _pending_input=SimpleQueue(),
        _interrupt_queue=SimpleQueue(),
    )
    manager._cli_ref = cli

    assert context.inject_message("status", "system") is True
    assert cli._interrupt_queue.get_nowait() == "[system] status"
    assert cli._pending_input.empty()


def test_cli_fail_closed_injection_rejects_running_or_queued_turn():
    context, manager = _context()
    cli = SimpleNamespace(
        _agent_running=True,
        _pending_input=SimpleQueue(),
        _interrupt_queue=SimpleQueue(),
    )
    manager._cli_ref = cli

    assert context.inject_message("external turn", interrupt_running=False) is False
    assert cli._pending_input.empty()
    assert cli._interrupt_queue.empty()

    cli._agent_running = False
    cli._pending_input.put("native turn")
    assert context.inject_message("external turn", interrupt_running=False) is False
    assert cli._pending_input.get_nowait() == "native turn"


def test_cli_conversation_snapshot_is_idle_read_only_and_detached():
    context, manager = _context()
    history = [{"role": "user", "content": "hello"}]
    cli = SimpleNamespace(
        _agent_running=False,
        session_id="session-1",
        conversation_history=history,
    )
    manager._cli_ref = cli

    snapshot = context.cli_conversation_snapshot()
    assert snapshot == {"session_id": "session-1", "messages": history}
    snapshot["messages"][0]["content"] = "changed"
    assert history[0]["content"] == "hello"

    cli._agent_running = True
    assert context.cli_conversation_snapshot() is None
    manager._cli_ref = None
    assert context.cli_conversation_snapshot() is None


def test_cli_host_execution_binding_targets_only_the_live_cli_agent():
    from agent.subagent_lifecycle import bind_subagent_parent

    context, manager = _context()
    agent = SimpleNamespace()
    manager._cli_ref = SimpleNamespace(
        agent=agent,
        _agent_running=False,
        session_id="session-1",
    )
    requester = MagicMock()

    assert context.bind_cli_host_execution("context-1", requester, "session-1") is True
    with bind_subagent_parent(agent):
        assert context.bind_cli_host_execution(
            "context-1", requester, "session-1"
        ) is True

    assert agent._host_execution_context_id == "context-1"
    assert agent._host_execution_requester is requester
    assert agent._host_execution_session_id == "session-1"
    assert context.clear_cli_host_execution("other-context") is False
    assert context.clear_cli_host_execution("context-1") is True
    assert agent._host_execution_context_id == ""
    assert agent._host_execution_requester is None


def test_fresh_cli_stages_one_immutable_host_binding_and_preserves_draft():
    context, manager = _context()
    cli = SimpleNamespace(
        agent=None,
        _agent_running=False,
        _pending_input=SimpleQueue(),
        _interrupt_queue=SimpleQueue(),
        session_id="session-1",
        local_draft="unsent terminal draft",
    )
    manager._cli_ref = cli
    requester = MagicMock()

    assert context.bind_cli_host_execution(
        "context-1",
        requester,
        "session-1",
        request_id="request-1",
        external_memory_mode="bypass_automatic",
    ) is True
    assert context.bind_cli_host_execution(
        "context-2",
        requester,
        "session-1",
        request_id="request-2",
        external_memory_mode="bypass_automatic",
    ) is False
    assert context.inject_message(
        "remote mission",
        interrupt_running=False,
        external_memory_mode="bypass_automatic",
        host_execution_request_id="request-1",
    ) is True
    assert cli._pending_input.get_nowait() == "remote mission"
    assert cli.local_draft == "unsent terminal draft"
    requester.assert_not_called()

    agent = SimpleNamespace()
    cli.agent = agent
    assert manager.materialize_cli_host_execution(
        cli,
        agent,
        session_id="session-1",
    ) is True
    assert agent._host_execution_context_id == "context-1"
    assert agent._host_execution_request_id == "request-1"
    assert agent._host_execution_session_id == "session-1"
    assert agent._next_turn_external_memory_mode == "bypass_automatic"
    assert manager._pending_cli_host_execution is None
    requester.assert_not_called()


def test_fresh_cli_rejects_wrong_request_and_clears_session_mismatch():
    context, manager = _context()
    cli = SimpleNamespace(
        agent=None,
        _agent_running=False,
        _pending_input=SimpleQueue(),
        _interrupt_queue=SimpleQueue(),
        session_id="session-1",
    )
    manager._cli_ref = cli
    requester = MagicMock()
    assert context.bind_cli_host_execution(
        "context-1", requester, "session-1", request_id="request-1"
    ) is True
    assert context.inject_message(
        "wrong owner",
        interrupt_running=False,
        host_execution_request_id="request-2",
    ) is False
    assert cli._pending_input.empty()

    cli.session_id = "session-2"
    cli.agent = SimpleNamespace()
    assert manager.materialize_cli_host_execution(
        cli,
        cli.agent,
        session_id="session-2",
    ) is False
    assert manager._pending_cli_host_execution is None
    assert not hasattr(cli.agent, "_host_execution_context_id")
    requester.assert_not_called()


def test_busy_cli_rejects_new_host_binding_without_disturbing_active_agent():
    context, manager = _context()
    agent = SimpleNamespace()
    cli = SimpleNamespace(
        agent=agent,
        _agent_running=True,
        _pending_input=SimpleQueue(),
        _interrupt_queue=SimpleQueue(),
        session_id="session-1",
    )
    manager._cli_ref = cli
    requester = MagicMock()

    assert context.bind_cli_host_execution(
        "context-busy", requester, "session-1", request_id="request-busy"
    ) is False
    assert not hasattr(agent, "_host_execution_context_id")
    assert manager._pending_cli_host_execution is None
    requester.assert_not_called()


def test_route_rejection_clears_direct_binding_and_emits_one_visible_failure():
    context, manager = _context()
    agent = SimpleNamespace()
    cli = SimpleNamespace(
        agent=agent,
        _agent_running=False,
        _pending_input=SimpleQueue(),
        _interrupt_queue=SimpleQueue(),
        session_id="session-1",
    )
    manager._cli_ref = cli
    requester = MagicMock()
    events = []
    manager._hooks["on_stream_end"] = [lambda **payload: events.append(payload)]
    assert context.bind_cli_host_execution(
        "context-route", requester, "session-1", request_id="request-route"
    ) is True

    assert cli.agent._host_execution_context_id == "context-route"
    assert manager.reject_cli_host_execution(cli) is True
    manager.invoke_hook(
        "on_stream_end",
        session_id="session-1",
        turn_id="",
        finished=False,
        error="cli_host_execution_route_changed",
    )
    assert cli.agent._host_execution_context_id == ""
    assert len(events) == 1
    assert events[0]["error"] == "cli_host_execution_route_changed"
    requester.assert_not_called()


def test_pending_cli_host_binding_clears_on_cancel_and_manager_teardown():
    context, manager = _context()
    cli = SimpleNamespace(
        agent=None,
        _agent_running=False,
        _pending_input=SimpleQueue(),
        _interrupt_queue=SimpleQueue(),
        session_id="session-1",
    )
    manager._cli_ref = cli
    requester = MagicMock()

    assert context.bind_cli_host_execution(
        "context-1", requester, "session-1", request_id="request-1"
    ) is True
    assert context.clear_cli_host_execution("context-1") is True
    assert manager._pending_cli_host_execution is None

    assert context.bind_cli_host_execution(
        "context-2", requester, "session-1", request_id="request-2"
    ) is True
    manager.unload()
    assert manager._pending_cli_host_execution is None
    requester.assert_not_called()


def test_real_cli_initialization_failure_rejects_and_clears_staged_binding(
    tmp_path,
    monkeypatch,
):
    import cli as cli_mod
    import hermes_cli.plugins as plugins_mod

    hermes_home = tmp_path / ".hermes"
    hermes_home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    plugins_mod._reset_plugin_managers_for_tests()
    manager = plugins_mod.get_plugin_manager()
    cli = cli_mod.HermesCLI(
        model="provider-free-model",
        provider="openrouter",
        api_key="provider-free-key",
        base_url="http://127.0.0.1:9/v1",
    )
    manager._cli_ref = cli
    context = PluginContext(
        PluginManifest(name="integration-plugin", key="integration-plugin", source="user"),
        manager,
    )
    events = []
    manager._hooks["on_stream_end"] = [lambda **payload: events.append(payload)]
    requester = MagicMock()
    assert context.bind_cli_host_execution(
        "context-init-failure",
        requester,
        cli.session_id,
        request_id="request-init-failure",
    ) is True
    monkeypatch.setattr(cli, "_ensure_runtime_credentials", lambda: False)

    assert cli._init_agent() is False
    assert cli.agent is None
    assert manager._pending_cli_host_execution is None
    assert len(events) == 1
    assert events[0]["finished"] is False
    assert events[0]["error"] == "cli_agent_credentials_unavailable"
    requester.assert_not_called()


def test_real_cli_agent_materializes_staged_binding_before_provider_boundary(
    tmp_path,
    monkeypatch,
):
    """Boot the real CLI/PluginContext/AIAgent path without inference."""

    import cli as cli_mod
    import hermes_cli.mcp_startup as mcp_startup
    import hermes_cli.plugins as plugins_mod
    import run_agent

    hermes_home = tmp_path / ".hermes"
    hermes_home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    monkeypatch.setattr(
        mcp_startup,
        "ensure_mcp_discovery_before_agent_build",
        lambda **_kwargs: None,
    )
    plugins_mod._reset_plugin_managers_for_tests()
    manager = plugins_mod.get_plugin_manager()
    cli = cli_mod.HermesCLI(
        model="provider-free-model",
        provider="openrouter",
        api_key="provider-free-key",
        base_url="http://127.0.0.1:9/v1",
    )
    manager._cli_ref = cli
    context = PluginContext(
        PluginManifest(name="integration-plugin", key="integration-plugin", source="user"),
        manager,
    )
    requester = MagicMock()
    assert context.bind_cli_host_execution(
        "context-integration",
        requester,
        cli.session_id,
        request_id="request-integration",
    ) is True
    assert context.inject_message(
        "provider-free mission",
        interrupt_running=False,
        host_execution_request_id="request-integration",
    ) is True
    message = cli._pending_input.get_nowait()
    observed = []

    def provider_boundary(agent, **_kwargs):
        observed.append({
            "agent": agent,
            "context": agent._host_execution_context_id,
            "request": agent._host_execution_request_id,
            "session": agent._host_execution_session_id,
        })
        return {
            "final_response": "provider-free result",
            "messages": [],
            "api_calls": 0,
            "completed": True,
        }

    monkeypatch.setattr(run_agent.AIAgent, "run_conversation", provider_boundary)
    monkeypatch.setattr(cli, "_ensure_runtime_credentials", lambda: True)
    runtime = {
        "api_key": "provider-free-key",
        "base_url": "http://127.0.0.1:9/v1",
        "provider": "openrouter",
        "requested_provider": "openrouter",
        "api_mode": "chat_completions",
        "command": None,
        "args": [],
        "credential_pool": None,
    }
    monkeypatch.setattr(cli, "_resolve_turn_agent_config", lambda _message: {
        "signature": None,
        "model": "provider-free-model",
        "runtime": runtime,
        "request_overrides": None,
    })
    cli._agent_running = True

    assert cli.chat(message) == "provider-free result"
    assert len(observed) == 1
    assert type(observed[0]["agent"]).__name__ == "AIAgent"
    assert observed[0]["context"] == "context-integration"
    assert observed[0]["request"] == "request-integration"
    assert observed[0]["session"] == cli.session_id
    assert manager._pending_cli_host_execution is None
    requester.assert_not_called()


def test_cli_native_team_result_uses_live_session_owner_and_is_idempotent():
    context, manager = _context()
    history = [{"role": "user", "content": "mission"}]
    persisted = []
    agent = SimpleNamespace(
        _session_persist_lock=RLock(),
        _persist_session=lambda messages, prior: persisted.append(
            (list(messages), list(prior))
        ),
    )
    session_db = SimpleNamespace(
        resolve_resume_session_id=lambda session_id: (
            "session-current" if session_id == "session-original" else session_id
        )
    )
    manager._cli_ref = SimpleNamespace(
        _agent_running=False,
        _pending_input=SimpleQueue(),
        _interrupt_queue=SimpleQueue(),
        agent=agent,
        session_id="session-current",
        conversation_history=history,
        _session_db=session_db,
    )

    assert context.append_cli_native_team_result(
        "session-original",
        task_id="t_team",
        result="reviewed result",
        terminal_state="completed",
    ) is True
    assert context.append_cli_native_team_result(
        "session-original",
        task_id="t_team",
        result="reviewed result",
        terminal_state="completed",
    ) is False
    assert len(persisted) == 1
    assert persisted[0][1] == [{"role": "user", "content": "mission"}]
    assert history[-1]["display_metadata"] == {
        "nativeTaskId": "t_team",
        "terminalState": "completed",
    }


def test_cli_native_team_result_retries_busy_and_rejects_foreign_session():
    context, manager = _context()
    manager._cli_ref = SimpleNamespace(
        _agent_running=True,
        _pending_input=SimpleQueue(),
        _interrupt_queue=SimpleQueue(),
    )
    with pytest.raises(RuntimeError, match="hermes_team_session_turn_in_progress"):
        context.append_cli_native_team_result(
            "session-1", task_id="t_team", result="result",
            terminal_state="completed",
        )

    manager._cli_ref = SimpleNamespace(
        _agent_running=False,
        _pending_input=SimpleQueue(),
        _interrupt_queue=SimpleQueue(),
        agent=SimpleNamespace(_persist_session=MagicMock()),
        session_id="session-current",
        conversation_history=[],
        _session_db=SimpleNamespace(resolve_resume_session_id=lambda value: value),
    )
    with pytest.raises(RuntimeError, match="hermes_team_session_identity_mismatch"):
        context.append_cli_native_team_result(
            "session-foreign", task_id="t_team", result="result",
            terminal_state="completed",
        )


def test_gateway_injection_requires_session_key(tmp_path, monkeypatch):
    _write_plugin_config(
        tmp_path,
        monkeypatch,
        {"allow_gateway_injection": True},
    )
    context, manager = _context()
    injector = MagicMock(return_value=True)
    manager.set_gateway_message_injector(object(), injector)

    assert context.inject_message("wake up") is False
    injector.assert_not_called()


def test_gateway_injection_requires_explicit_permission(tmp_path, monkeypatch):
    _write_plugin_config(tmp_path, monkeypatch, {})
    context, manager = _context()
    injector = MagicMock(return_value=True)
    manager.set_gateway_message_injector(object(), injector)

    assert (
        context.inject_message(
            "wake up",
            session_key="agent:main:telegram:dm:42",
        )
        is False
    )
    injector.assert_not_called()


def test_gateway_injection_does_not_treat_string_as_permission(tmp_path, monkeypatch):
    _write_plugin_config(
        tmp_path,
        monkeypatch,
        {"allow_gateway_injection": "false"},
    )
    context, manager = _context()
    injector = MagicMock(return_value=True)
    manager.set_gateway_message_injector(object(), injector)

    assert (
        context.inject_message(
            "wake up",
            session_key="agent:main:telegram:dm:42",
        )
        is False
    )
    injector.assert_not_called()


def test_gateway_injection_fails_closed_when_config_cannot_be_read():
    context, manager = _context()
    injector = MagicMock(return_value=True)
    manager.set_gateway_message_injector(object(), injector)

    with patch(
        "hermes_cli.plugins.load_config_readonly",
        side_effect=OSError("config unavailable"),
    ):
        assert (
            context.inject_message(
                "wake up",
                session_key="agent:main:telegram:dm:42",
            )
            is False
        )

    injector.assert_not_called()


def test_gateway_injection_requires_live_host(tmp_path, monkeypatch):
    _write_plugin_config(
        tmp_path,
        monkeypatch,
        {"allow_gateway_injection": True},
    )
    context, manager = _context()

    assert manager.has_gateway_message_injector is False
    assert (
        context.inject_message(
            "wake up",
            session_key="agent:main:telegram:dm:42",
        )
        is False
    )


def test_gateway_injection_passes_host_owned_plugin_identity(tmp_path, monkeypatch):
    _write_plugin_config(
        tmp_path,
        monkeypatch,
        {"allow_gateway_injection": True},
    )
    context, manager = _context()
    injector = MagicMock(return_value=True)
    manager.set_gateway_message_injector(object(), injector)

    result = context.inject_message(
        "wake up",
        role="system",
        session_key="agent:main:telegram:dm:42",
    )

    assert result is True
    injector.assert_called_once_with(
        session_key="agent:main:telegram:dm:42",
        content="[system] wake up",
        plugin_id="notify-plugin",
    )


def test_gateway_injection_returns_host_rejection(tmp_path, monkeypatch):
    _write_plugin_config(
        tmp_path,
        monkeypatch,
        {"allow_gateway_injection": True},
    )
    context, manager = _context()
    manager.set_gateway_message_injector(
        object(),
        MagicMock(return_value=False),
    )

    assert (
        context.inject_message(
            "wake up",
            session_key="agent:main:telegram:dm:42",
        )
        is False
    )


def test_gateway_injection_fails_closed_on_host_exception(tmp_path, monkeypatch):
    _write_plugin_config(
        tmp_path,
        monkeypatch,
        {"allow_gateway_injection": True},
    )
    context, manager = _context()
    injector = MagicMock(side_effect=RuntimeError("gateway unavailable"))
    manager.set_gateway_message_injector(object(), injector)

    assert (
        context.inject_message(
            "wake up",
            session_key="agent:main:telegram:dm:42",
        )
        is False
    )
