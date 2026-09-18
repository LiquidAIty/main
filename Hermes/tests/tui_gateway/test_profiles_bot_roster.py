"""Profile-scoped native Bot roster configuration contract."""

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


def _configure(roster):
    return srv._methods["profiles.configure"](
        "configure", {"name": "default", "bot_mode_roster": roster},
    )


def _describe():
    return srv._methods["profiles.describe"](
        "describe", {"name": "default"},
    )["result"]


def test_bot_roster_write_deduplicates_in_order_and_reads_back(home):
    response = _configure(["Beta", "alpha", "beta"])

    assert response["result"]["ok"] is True
    assert response["result"]["applied"]["bot_mode_roster"] is True
    assert _describe()["bot_mode_roster"] == ["beta", "alpha"]
    config = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert config["bot_mode"]["roster"] == ["beta", "alpha"]


@pytest.mark.parametrize("roster", [["default"], ["missing"], ["alpha", 7]])
def test_bot_roster_rejects_self_unknown_and_malformed_entries(home, roster):
    response = _configure(roster)

    assert response["error"]["code"] == 5064
    assert _describe()["bot_mode_roster"] == []


def test_empty_bot_roster_is_an_explicit_success(home):
    response = _configure([])

    assert response["result"]["ok"] is True
    assert response["result"]["applied"]["bot_mode_roster"] is True
    assert _describe()["bot_mode_roster"] == []
