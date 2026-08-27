"""Provider-free proof for generic process-local MCP configuration."""

import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from hermes_cli import config, mcp_startup, plugins
from tools import mcp_tool


def environment():
    return {
        "CHILD_SECRET": "child-test-value",
        "HERMES_MCP_SERVERS": json.dumps({"host-tools": {
            "url": "http://127.0.0.1:8765/mcp",
            "headers": {"Authorization": "Bearer ${CHILD_SECRET}"},
        }}),
    }


@pytest.fixture
def native_config(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    for key, value in environment().items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(config, "load_config", lambda: {})
    monkeypatch.setattr(plugins, "discover_plugins", lambda: None)
    monkeypatch.setattr(plugins, "get_plugin_manager", lambda: SimpleNamespace(
        get_portable_mcp_servers=lambda: {},
    ))


def test_process_configuration_uses_explicit_child_environment_without_mutation():
    env = environment()
    before = dict(env)
    resolved = mcp_tool.process_mcp_servers(env)
    assert resolved["host-tools"]["headers"]["Authorization"] == "Bearer child-test-value"
    assert env == before
    assert mcp_tool.process_mcp_servers({}) == {}
    assert mcp_tool._interpolate_env_vars("${UNKNOWN_STOCK_SETTING}") == "${UNKNOWN_STOCK_SETTING}"


@pytest.mark.parametrize("raw", ["", "null", "[]", "{}", "bad-json", '{"x": {}}'])
def test_malformed_process_configuration_is_not_silently_ignored(raw):
    with pytest.raises(ValueError, match="process_mcp_configuration_invalid"):
        mcp_tool.process_mcp_servers({"HERMES_MCP_SERVERS": raw})


def test_missing_interpolation_fails_without_exposing_values():
    env = environment()
    del env["CHILD_SECRET"]
    with pytest.raises(ValueError, match="MCP environment value missing: CHILD_SECRET"):
        mcp_tool.process_mcp_servers(env)


def test_native_loader_merges_once_and_rejects_duplicate_destination(native_config, monkeypatch):
    servers = mcp_tool._load_mcp_config()
    assert list(servers) == ["host-tools"]
    monkeypatch.setattr(config, "load_config", lambda: {"mcp_servers": {
        "other-name": {"url": "http://127.0.0.1:8765/mcp"},
    }})
    with pytest.raises(ValueError, match="process_mcp_configuration_unavailable"):
        mcp_tool._load_mcp_config()


def test_required_connection_is_checked_before_native_agent_build(native_config, monkeypatch):
    assert mcp_startup._has_configured_mcp_servers() is True
    monkeypatch.setattr(mcp_startup, "start_background_mcp_discovery", lambda **_: None)
    monkeypatch.setattr(mcp_startup, "wait_for_mcp_discovery", lambda **_: None)
    monkeypatch.setattr(mcp_tool, "get_mcp_status", lambda: [])
    with pytest.raises(RuntimeError, match="process_mcp_required_connection_unavailable"):
        mcp_startup.ensure_mcp_discovery_before_agent_build(logger=Mock(), single_query=True)
    monkeypatch.setattr(mcp_tool, "get_mcp_status", lambda: [{"name": "host-tools", "connected": True}])
    mcp_startup.ensure_mcp_discovery_before_agent_build(logger=Mock(), single_query=True)


def test_stock_discovery_remains_best_effort(monkeypatch):
    monkeypatch.delenv("HERMES_MCP_SERVERS", raising=False)
    monkeypatch.setattr(mcp_startup, "start_background_mcp_discovery", Mock(side_effect=RuntimeError("offline")))
    mcp_startup.ensure_mcp_discovery_before_agent_build(logger=Mock())
