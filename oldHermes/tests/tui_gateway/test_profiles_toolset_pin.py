"""Native profile toolset writes must control the CLI execution surface."""

from __future__ import annotations

import pytest
import yaml

import tui_gateway.server as srv
from hermes_cli.tools_config import _get_platform_tools


@pytest.fixture
def home(tmp_path, monkeypatch):
    hermes_home = tmp_path / ".hermes"
    hermes_home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    return hermes_home


def _configure(enabled):
    return srv._methods["profiles.configure"](
        "configure", {"name": "default", "enabled_toolsets": enabled},
    )["result"]


def _config(home):
    return yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8")) or {}


def test_profile_toolset_selection_updates_editor_and_cli_execution(home):
    result = _configure(["memory"])

    assert result["ok"] is True
    assert result["applied"]["toolsets"] is True
    config = _config(home)
    assert config["tools"]["enabled_toolsets"] == ["memory"]
    assert config["platform_toolsets"]["cli"] == ["memory"]
    assert _get_platform_tools(config, "cli", include_default_mcp_servers=False) == {"memory"}


def test_explicit_empty_toolset_selection_disables_cli_defaults(home):
    _configure(["memory"])
    result = _configure([])

    assert result["ok"] is True
    assert result["applied"]["toolsets"] is True
    config = _config(home)
    assert "enabled_toolsets" not in config.get("tools", {})
    assert config["platform_toolsets"]["cli"] == []
    assert _get_platform_tools(config, "cli", include_default_mcp_servers=False) == set()
