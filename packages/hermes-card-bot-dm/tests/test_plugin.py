from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


PLUGIN_DIR = Path(__file__).resolve().parents[1]


def _load_plugin():
    path = PLUGIN_DIR / "__init__.py"
    spec = importlib.util.spec_from_file_location("card_bot_dm_plugin", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def plugin():
    return _load_plugin()


@pytest.fixture(autouse=True)
def _clear_managed_environment(monkeypatch):
    for name in (
        "CARD_BOT_DM_MANAGED",
        "CARD_BOT_DM_HOST_URL",
        "HERMES_DASHBOARD_SESSION_TOKEN",
    ):
        monkeypatch.delenv(name, raising=False)


def _managed_env(monkeypatch):
    monkeypatch.setenv("CARD_BOT_DM_MANAGED", "1")
    monkeypatch.setenv("CARD_BOT_DM_HOST_URL", "http://127.0.0.1:4000/hermes-bot-dm")
    monkeypatch.setenv("HERMES_DASHBOARD_SESSION_TOKEN", "gateway-secret")


def _call(plugin, args, next_call, *, task_id="task-1"):
    return plugin.tool_execution(
        tool_name="message_agent",
        args=args,
        next_call=next_call,
        task_id=task_id,
    )


def test_registers_only_tool_execution(plugin):
    calls = []

    class Context:
        def register_middleware(self, kind, callback):
            calls.append((kind, callback))

    plugin.register(Context())
    assert calls == [("tool_execution", plugin.tool_execution)]


def test_unmanaged_calls_stock_tool_exactly_once(plugin):
    for tool_name, args in (
        ("read_file", {"path": "README.md"}),
        ("message_agent", {"target": "builder", "message": "hello"}),
    ):
        calls = []

        def next_call(value):
            calls.append(value)
            return "native-result"

        assert plugin.tool_execution(
            tool_name=tool_name,
            args=args,
            next_call=next_call,
            task_id="task-1",
        ) == "native-result"
        assert calls == [args]


@pytest.mark.parametrize(
    ("args", "reason"),
    [
        (None, "invalid_arguments"),
        ({"target": 2, "message": "hello"}, "invalid_target"),
        ({"target": "  @  ", "message": "hello"}, "invalid_target"),
        ({"target": "builder", "message": 2}, "invalid_message"),
        ({"target": "builder", "message": "  "}, "invalid_message"),
        ({"target": "builder", "message": "x" * 16_001}, "message_too_long"),
    ],
)
def test_invalid_managed_arguments_never_fall_through(plugin, monkeypatch, args, reason):
    _managed_env(monkeypatch)
    calls = []
    result = json.loads(_call(plugin, args, calls.append))
    assert result["reason"] == reason
    assert calls == []


@pytest.mark.parametrize(
    ("missing", "reason"),
    [
        ("HERMES_DASHBOARD_SESSION_TOKEN", "missing_gateway_credential"),
        ("CARD_BOT_DM_HOST_URL", "missing_host_url"),
    ],
)
def test_missing_managed_configuration_fails_closed(plugin, monkeypatch, missing, reason):
    _managed_env(monkeypatch)
    monkeypatch.delenv(missing)
    calls = []
    result = json.loads(_call(plugin, {"target": "builder", "message": "hello"}, calls.append))
    assert result["reason"] == reason
    assert calls == []


def test_missing_native_runtime_identity_fails_closed(plugin, monkeypatch):
    _managed_env(monkeypatch)
    calls = []
    result = json.loads(_call(
        plugin,
        {"target": "builder", "message": "hello"},
        calls.append,
        task_id="",
    ))
    assert result["reason"] == "missing_runtime_identity"
    assert calls == []


def test_managed_call_resolves_once_then_calls_stock_tool_once(plugin, monkeypatch):
    _managed_env(monkeypatch)
    monkeypatch.setattr(plugin.secrets, "token_hex", lambda _size: "a" * 32)
    monkeypatch.setattr(plugin.time, "time", lambda: 1_000)
    captured = []

    def post_once(host_url, envelope):
        captured.append((host_url, envelope))
        return 200, {"ok": True, "targetProfile": "builder"}

    monkeypatch.setattr(plugin, "_post_once", post_once)
    native_calls = []
    result = _call(
        plugin,
        {"target": " @builder ", "message": "private mission"},
        lambda value: native_calls.append(value) or "native-ack",
    )

    assert result == "native-ack"
    assert native_calls == [{"target": "builder", "message": "private mission"}]
    assert len(captured) == 1
    host_url, envelope = captured[0]
    assert host_url == "http://127.0.0.1:4000/hermes-bot-dm"
    assert set(envelope) == {"keyId", "payload", "signature"}
    assert "gateway-secret" not in json.dumps(envelope)
    payload = json.loads(envelope["payload"])
    assert payload == {
        "version": 1,
        "expiresAt": 1_300,
        "nonce": "a" * 32,
        "sourceStoredSessionId": "task-1",
        "target": "builder",
        "message": "private mission",
    }
    assert "turnId" not in payload and "toolCallId" not in payload
    assert envelope["keyId"] == hashlib.sha256(b"gateway-secret").hexdigest()
    assert envelope["signature"] == hmac.new(
        b"gateway-secret",
        envelope["payload"].encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


@pytest.mark.parametrize(
    ("status", "response"),
    [
        (404, {"error": "hermes_bot_dm_saved_card_not_found"}),
        (200, {"ok": True}),
        (200, {"ok": True, "targetProfile": "  "}),
    ],
)
def test_managed_card_resolution_failure_never_calls_stock_tool(
    plugin, monkeypatch, status, response
):
    _managed_env(monkeypatch)
    monkeypatch.setattr(plugin, "_post_once", lambda *_args: (status, response))
    native_calls = []
    result = json.loads(_call(
        plugin,
        {"target": "builder", "message": "hello"},
        native_calls.append,
    ))
    assert result["reason"] == "saved_card_resolution_failed"
    assert native_calls == []


def test_managed_host_failure_never_falls_through(plugin, monkeypatch):
    _managed_env(monkeypatch)
    monkeypatch.setattr(plugin, "_post_once", lambda *_args: (_ for _ in ()).throw(OSError()))
    fallback = []
    result = json.loads(_call(
        plugin,
        {"target": "builder", "message": "hello"},
        fallback.append,
    ))
    assert result["reason"] == "saved_card_resolution_failed"
    assert fallback == []


class _HostHandler(BaseHTTPRequestHandler):
    calls = []

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        type(self).calls.append(json.loads(self.rfile.read(length)))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({
            "ok": True, "targetProfile": "builder"
        }).encode("utf-8"))

    def log_message(self, _format, *_args):
        pass


def test_direct_host_transport_posts_once_and_does_not_retry(plugin):
    _HostHandler.calls = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _HostHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        status, response = plugin._post_once(
            f"http://127.0.0.1:{server.server_port}/dm",
            {"keyId": "a" * 64, "payload": "{}", "signature": "b" * 64},
        )
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()
    assert status == 200
    assert response == {"ok": True, "targetProfile": "builder"}
    assert _HostHandler.calls == [
        {"keyId": "a" * 64, "payload": "{}", "signature": "b" * 64}
    ]


def test_direct_host_transport_rejects_non_loopback_before_post(plugin, monkeypatch):
    calls = []
    monkeypatch.setattr(plugin.urllib.request, "build_opener", calls.append)
    with pytest.raises(ValueError, match="loopback"):
        plugin._post_once(
            "https://example.com/hermes-bot-dm",
            {"keyId": "a", "payload": "{}", "signature": "b"},
        )
    assert calls == []
