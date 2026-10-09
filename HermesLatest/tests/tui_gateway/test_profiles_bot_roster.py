"""Session-scoped Hermes Bot roster and reusable profile contracts."""

from __future__ import annotations

import pytest
import yaml

import tui_gateway.server as srv


@pytest.fixture
def home(tmp_path, monkeypatch):
    root = tmp_path / ".hermes"
    root.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(root))
    for name in ("alpha", "beta"):
        profile = root / "profiles" / name
        profile.mkdir(parents=True)
        (profile / "config.yaml").write_text("model: {}\n", encoding="utf-8")
    return root


def _describe():
    return srv._methods["profiles.describe"](
        "describe", {"name": "default"},
    )["result"]


def _session_roster(home, params):
    return srv._session_bot_roster(params, home)


def test_absent_session_bot_roster_is_distinct_from_explicit_empty(home):
    assert _session_roster(home, {}) is None
    assert _session_roster(home, {"bot_mode_roster": []}) == []


def test_session_bot_roster_deduplicates_without_writing_the_profile(home):
    assert _session_roster(home, {
        "bot_mode_roster": ["Beta", "alpha", "beta"],
    }) == ["beta", "alpha"]
    assert not (home / "config.yaml").exists()


@pytest.mark.parametrize("roster", [["default"], ["missing"], ["alpha", 7]])
def test_bot_roster_rejects_self_unknown_and_malformed_entries(home, roster):
    with pytest.raises(ValueError):
        _session_roster(home, {"bot_mode_roster": roster})
    assert not (home / "config.yaml").exists()


def test_profile_capability_fingerprint_includes_the_exact_session_roster(home):
    empty = srv._methods["profiles.describe"](
        "describe-empty", {"name": "default", "bot_mode_roster": []},
    )["result"]["capability_fingerprint"]
    alpha = srv._methods["profiles.describe"](
        "describe-alpha", {"name": "default", "bot_mode_roster": ["alpha"]},
    )["result"]["capability_fingerprint"]

    assert len(empty) == len(alpha) == 12
    assert empty != alpha


def test_card_profile_execution_fields_preserve_unknown_config(home):
    (home / "config.yaml").write_text(
        "model:\n  provider: openai-codex\n  default: gpt-parent\n"
        "  openai_runtime: codex_app_server\nmemory:\n  provider: honcho\n",
        encoding="utf-8",
    )
    response = srv._methods["profiles.configure"]("configure", {
        "name": "default",
        "delegation": {
            "provider": "openai-codex",
            "model": "gpt-child",
            "max_spawn_depth": 1,
            "orchestrator_enabled": False,
            "enabled": False,
        },
        "task_mode": "team",
    })

    assert response["result"]["ok"] is True
    assert response["result"]["applied"] == {
        "delegation": True,
        "task_mode": True,
    }
    config = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert config["memory"] == {"provider": "honcho"}
    assert config["model"] == {
        "provider": "openai-codex",
        "default": "gpt-parent",
        "openai_runtime": "codex_app_server",
    }
    assert config["delegation"]["provider"] == "openai-codex"
    assert config["delegation"]["model"] == "gpt-child"
    assert config["delegation"].get("max_spawn_depth", 1) == 1
    assert config["delegation"]["orchestrator_enabled"] is False
    assert "delegation" in config["agent"]["disabled_toolsets"]
    assert config["kanban"]["task_mode"] == "team"
    described = _describe()
    assert described["model"]["openai_runtime"] == "codex_app_server"
    assert described["delegation"] == {
        "provider": "openai-codex",
        "model": "gpt-child",
        "max_spawn_depth": 1,
        "orchestrator_enabled": False,
        "enabled": False,
    }
    assert described["task_mode"] == "team"
