from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
from pathlib import Path

import pytest


PLUGIN_DIR = Path(__file__).resolve().parents[1]


def _load_plugin():
    path = PLUGIN_DIR / "__init__.py"
    spec = importlib.util.spec_from_file_location("card_tools_plugin", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def plugin():
    return _load_plugin()


@pytest.fixture(autouse=True)
def _clear_environment(monkeypatch):
    for name in (
        "CARD_TOOLS_MANAGED",
        "CARD_TOOLS_HOST_URL",
        "HERMES_DASHBOARD_SESSION_TOKEN",
    ):
        monkeypatch.delenv(name, raising=False)


def test_registers_exact_materialized_tools(plugin, monkeypatch):
    tools = [{
        "canonicalName": "card.create",
        "hermesName": "card__card_create",
        "description": "Create a saved Card.",
        "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}}},
    }]
    monkeypatch.setattr(plugin, "_load_tools", lambda: tools)
    calls = []

    class Context:
        def register_tool(self, **kwargs):
            calls.append(kwargs)

    plugin.register(Context())
    assert len(calls) == 1
    assert {key: value for key, value in calls[0].items() if key != "handler"} == {
        "name": "card__card_create",
        "toolset": "card-tools",
        "schema": tools[0]["inputSchema"],
        "description": "Create a saved Card.",
    }


def test_handler_posts_one_signed_request_and_returns_native_output(plugin, monkeypatch):
    monkeypatch.setenv("CARD_TOOLS_MANAGED", "1")
    monkeypatch.setenv("CARD_TOOLS_HOST_URL", "http://127.0.0.1:4000/api/hermes-card-tools")
    monkeypatch.setenv("HERMES_DASHBOARD_SESSION_TOKEN", "gateway-secret")
    monkeypatch.setattr(plugin.secrets, "token_hex", lambda _size: "a" * 32)
    monkeypatch.setattr(plugin.time, "time", lambda: 1_000)
    calls = []

    def post_once(url, envelope):
        calls.append((url, envelope))
        return 200, {"ok": True, "output": '{"ok":true,"cardId":"new"}'}

    monkeypatch.setattr(plugin, "_post_once", post_once)
    result = plugin._handler("card__card_create")(
        {"title": "New Card"},
        task_id="stored-main",
    )
    assert result == '{"ok":true,"cardId":"new"}'
    assert len(calls) == 1
    url, envelope = calls[0]
    assert url == "http://127.0.0.1:4000/api/hermes-card-tools"
    payload = json.loads(envelope["payload"])
    assert payload == {
        "version": 1,
        "expiresAt": 1_300,
        "nonce": "a" * 32,
        "sourceStoredSessionId": "stored-main",
        "tool": "card__card_create",
        "arguments": {"title": "New Card"},
    }
    assert envelope["keyId"] == hashlib.sha256(b"gateway-secret").hexdigest()
    assert envelope["signature"] == hmac.new(
        b"gateway-secret", envelope["payload"].encode("utf-8"), hashlib.sha256,
    ).hexdigest()


def test_handler_fails_closed_without_managed_runtime(plugin):
    result = json.loads(plugin._handler("card__card_create")({}, task_id="stored-main"))
    assert result == {"ok": False, "error": "managed_card_runtime_required"}


def test_configuration_rejects_duplicate_names(plugin, tmp_path):
    config = tmp_path / "tools.json"
    tool = {
        "canonicalName": "card.create",
        "hermesName": "card__card_create",
        "description": "Create",
        "inputSchema": {"type": "object"},
    }
    config.write_text(json.dumps({"tools": [tool, tool]}), encoding="utf-8")
    with pytest.raises(ValueError, match="configuration_invalid"):
        plugin._load_tools(config)


def test_non_loopback_transport_is_rejected(plugin):
    with pytest.raises(ValueError, match="loopback"):
        plugin._post_once(
            "https://example.com/tool",
            {"keyId": "a", "payload": "{}", "signature": "b"},
        )
