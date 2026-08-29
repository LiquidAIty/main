"""Native profile configuration for asynchronous self-learning review."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

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


def test_profile_configure_round_trips_native_subagent_model(home):
    configured = srv._methods["profiles.configure"]("configure", {
        "name": "default",
        "subagent_model": {
            "provider": "openai-codex",
            "model": "gpt-5.6-luna",
        },
    })

    assert configured["result"] == {
        "ok": True,
        "applied": {"subagent_model": True},
    }
    described = srv._methods["profiles.describe"](
        "describe", {"name": "default"}
    )["result"]
    assert described["subagent_model"] == {
        "provider": "openai-codex",
        "model": "gpt-5.6-luna",
    }


def test_profile_configure_reports_profile_local_holographic_status(home):
    configured = srv._methods["profiles.configure"]("configure", {
        "name": "default",
        "memory_provider": "holographic",
    })

    assert configured["result"] == {
        "ok": True,
        "applied": {"memory_provider": True},
    }
    described = srv._methods["profiles.describe"](
        "describe", {"name": "default"}
    )["result"]
    memory = described["memory"]
    assert {
        key: memory[key]
        for key in (
            "selected", "installed", "available", "target",
            "credential_status", "credential_source", "setup_action",
            "curated_memory_enabled", "user_profile_enabled", "database",
        )
    } == {
        "selected": "holographic",
        "installed": True,
        "available": True,
        "target": "profile_sqlite",
        "credential_status": "not_required",
        "credential_source": "not_required",
        "setup_action": None,
        "curated_memory_enabled": True,
        "user_profile_enabled": True,
        "database": {
            "kind": "sqlite",
            "path": str(home / "memory_store.db"),
            "exists": False,
            "fact_count": 0,
        },
    }
    assert "holographic" in memory["installed_providers"]
    assert memory["history_database_path"] == str(home / "state.db")


def test_main_inspector_honcho_probe_is_explicit_and_secret_free(home, monkeypatch):
    configured = srv._methods["profiles.configure"]("configure", {
        "name": "default",
        "memory_provider": "honcho",
    })
    assert configured["result"]["applied"] == {"memory_provider": True}

    from plugins.memory.honcho.client import HonchoClientConfig

    bound_path = Path(home / "honcho.json")
    fake_config = SimpleNamespace(
        enabled=True,
        api_key=None,
        base_url="http://127.0.0.1:8002",
        timeout=0.5,
        host="hermes_default",
        bound_config_path=lambda: bound_path,
    )
    monkeypatch.setattr(
        HonchoClientConfig,
        "from_global_config",
        classmethod(lambda cls, host=None: fake_config),
    )
    calls = []
    monkeypatch.setattr(
        "httpx.get",
        lambda url, **kwargs: calls.append((url, kwargs))
        or SimpleNamespace(status_code=200),
    )

    ordinary = srv._methods["profiles.describe"](
        "ordinary", {"name": "default"}
    )["result"]
    assert ordinary["honcho"] is None
    assert calls == []

    inspected = srv._methods["profiles.describe"](
        "inspected", {"name": "default", "probe_honcho": True}
    )["result"]
    assert inspected["honcho"] == {
        "selected": True,
        "configuration_status": "configured",
        "connection_status": "connected",
        "availability_reason": None,
        "target": "honcho_self_hosted",
        "credential_status": "configured",
        "credential_source": "self_hosted_base_url",
        "setup_action": "hermes --profile default memory setup honcho",
        "status_action": "hermes --profile default honcho status",
    }
    assert calls == [("http://127.0.0.1:8002/health", {
        "timeout": 0.5,
        "follow_redirects": False,
    })]
