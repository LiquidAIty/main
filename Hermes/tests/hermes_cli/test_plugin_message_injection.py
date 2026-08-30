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
    manager._cli_ref = SimpleNamespace(agent=agent, _agent_running=False)
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
