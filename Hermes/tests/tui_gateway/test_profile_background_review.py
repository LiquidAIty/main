"""Native profile configuration for asynchronous self-learning review."""

from __future__ import annotations

import pytest

import tui_gateway.server as srv


@pytest.fixture
def home(tmp_path, monkeypatch):
    hermes_home = tmp_path / ".hermes"
    hermes_home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    return hermes_home


def test_profile_configure_round_trips_native_background_review(home):
    configured = srv._methods["profiles.configure"]("configure", {
        "name": "default",
        "background_review": {
            "enabled": True,
            "provider": "openai-codex",
            "model": "gpt-5.6-luna",
            "max_input_tokens": 120_000,
        },
    })

    assert configured["result"] == {
        "ok": True,
        "applied": {"background_review": True},
    }
    described = srv._methods["profiles.describe"](
        "describe", {"name": "default"}
    )["result"]
    assert described["background_review"] == {
        "enabled": True,
        "provider": "openai-codex",
        "model": "gpt-5.6-luna",
        "max_input_tokens": 120_000,
    }


def test_profile_configure_rejects_explicit_review_provider_without_model(home):
    configured = srv._methods["profiles.configure"]("configure", {
        "name": "default",
        "background_review": {
            "enabled": True,
            "provider": "openai-codex",
            "model": "",
        },
    })

    assert configured["result"] == {
        "ok": False,
        "applied": {"background_review": False},
    }
