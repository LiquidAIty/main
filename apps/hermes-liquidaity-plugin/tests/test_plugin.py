from __future__ import annotations

import io
import json
import urllib.error
from types import SimpleNamespace

import pytest

import liquidaity_hermes_plugin as plugin


def _context():
    return SimpleNamespace(
        task_id="t_root",
        run_id="17",
        board="Triage",
        assignee="coder",
        profile="coder",
        workspace="C:/workspace",
        claim_lock="claim-token",
    )


class _Response:
    def __init__(self, payload: bytes):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit: int) -> bytes:
        return self._payload


class _Opener:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.request = None
        self.timeout = None

    def open(self, request, timeout):
        self.request = request
        self.timeout = timeout
        if self.error:
            raise self.error
        return self.response


def test_correlated_worker_receives_ephemeral_bearer_and_native_mcp_template(monkeypatch):
    bearer = "b" * 64
    opener = _Opener(_Response(json.dumps({
        "ok": True, "bearer": bearer, "mcpUrl": "http://127.0.0.1:8765/mcp",
    }).encode()))
    monkeypatch.setattr(plugin.urllib.request, "build_opener", lambda *_args: opener)

    environment = plugin._worker_environment(_context())
    assert set(environment) == {"LIQUIDAITY_CARD_BEARER", "HERMES_MCP_SERVERS"}
    assert environment["LIQUIDAITY_CARD_BEARER"] == bearer
    assert bearer not in environment["HERMES_MCP_SERVERS"]
    assert json.loads(environment["HERMES_MCP_SERVERS"]) == {
        "liquidaity-card": {
            "url": "http://127.0.0.1:8765/mcp",
            "headers": {"Authorization": "Bearer ${LIQUIDAITY_CARD_BEARER}"},
            "lazy": False,
        },
    }
    assert json.loads(opener.request.data) == {
        "taskId": "t_root",
        "nativeRunId": "17",
        "board": "Triage",
        "assignee": "coder",
        "profile": "coder",
        "workspace": "C:/workspace",
        "claimLock": "claim-token",
    }
    assert opener.timeout == plugin._TIMEOUT_SECONDS


def test_uncorrelated_stock_task_keeps_original_lane(monkeypatch):
    error = urllib.error.HTTPError(
        plugin._DEFAULT_ENDPOINT, 404, "not found", {}, io.BytesIO()
    )
    monkeypatch.setattr(
        plugin.urllib.request,
        "build_opener",
        lambda *_args: _Opener(error=error),
    )

    assert plugin._worker_environment(_context()) is None


def test_real_native_child_configuration_consumes_only_its_bearer(monkeypatch, tmp_path):
    from hermes_cli import config, plugins
    from tools import mcp_tool

    bearer = "child-only-" + "b" * 64
    opener = _Opener(_Response(json.dumps({
        "ok": True, "bearer": bearer, "mcpUrl": "http://127.0.0.1:8765/mcp",
    }).encode()))
    monkeypatch.setattr(plugin.urllib.request, "build_opener", lambda *_args: opener)
    environment = plugin._worker_environment(_context())
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    for key, value in environment.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(config, "load_config", lambda: {})
    monkeypatch.setattr(plugins, "discover_plugins", lambda: None)
    monkeypatch.setattr(plugins, "get_plugin_manager", lambda: SimpleNamespace(
        get_portable_mcp_servers=lambda: {},
    ))

    servers = mcp_tool._load_mcp_config()
    assert list(servers) == ["liquidaity-card"]
    assert servers["liquidaity-card"]["headers"] == {"Authorization": f"Bearer {bearer}"}
    assert not list(tmp_path.glob("*.yaml"))
    assert bearer not in environment["HERMES_MCP_SERVERS"]
    monkeypatch.delenv("LIQUIDAITY_CARD_BEARER")
    with pytest.raises(ValueError, match="MCP environment value missing"):
        mcp_tool._load_mcp_config()


@pytest.mark.parametrize("url", [None, "https://example.test/mcp", "http://localhost/wrong",
                                  "http://user:password@localhost/mcp"])
def test_worker_rejects_noncanonical_mcp_destination(monkeypatch, url):
    opener = _Opener(_Response(json.dumps({
        "ok": True, "bearer": "b" * 64, "mcpUrl": url,
    }).encode()))
    monkeypatch.setattr(plugin.urllib.request, "build_opener", lambda *_args: opener)
    with pytest.raises(RuntimeError, match="liquidaity_card_mcp_url_invalid"):
        plugin._worker_environment(_context())


@pytest.mark.parametrize(
    "payload",
    [
        b"not-json",
        b"null",
        b"[]",
        b"true",
        b"42",
        b'"text"',
        json.dumps({"ok": True, "bearer": "too-short"}).encode(),
        json.dumps({"ok": False, "bearer": "b" * 64}).encode(),
    ],
)
def test_invalid_bearer_response_fails_closed(monkeypatch, payload):
    monkeypatch.setattr(
        plugin.urllib.request,
        "build_opener",
        lambda *_args: _Opener(_Response(payload)),
    )

    with pytest.raises(
        RuntimeError, match="liquidaity_card_bearer_lookup_response_invalid"
    ):
        plugin._worker_environment(_context())


def test_register_uses_stock_plugin_api():
    callbacks = []
    ctx = SimpleNamespace(
        register_kanban_worker_environment_provider=callbacks.append
    )

    plugin.register(ctx)

    assert callbacks == [plugin._worker_environment]


def test_main_bridge_emits_only_structured_native_hook_events(monkeypatch):
    bridge = plugin._MainCliBridge(SimpleNamespace(), "http://127.0.0.1:4000", "token")
    bridge._active = {
        "requestId": "request-1",
        "runId": "run-1",
        "driverSource": "internal_chat",
        "message": "hello",
    }
    events = []
    monkeypatch.setattr(
        bridge,
        "_request",
        lambda path, payload=None: events.append((path, payload)) or {"ok": True},
    )

    bridge.on_stream_start(session_id="session-1", turn_id="turn-1")
    bridge.on_stream_delta(kind="text", delta="public delta")
    bridge.on_stream_delta(kind="reasoning", delta="private reasoning")
    bridge.on_turn_complete(
        assistant_response="public final",
        session_id="session-1",
        turn_id="turn-1",
    )

    assert [event[1]["kind"] for event in events] == [
        "started", "text", "completed"
    ]
    assert events[1][1]["delta"] == "public delta"
    assert events[2][1]["finalText"] == "public final"
    assert bridge._active is None


def test_main_bridge_rejects_remote_turn_when_native_cli_is_busy(monkeypatch):
    class Context:
        def __init__(self):
            self.messages = []

        def inject_message(
            self, message, *, interrupt_running, external_memory_mode
        ):
            self.messages.append(
                (message, interrupt_running, external_memory_mode)
            )
            return False

        def cli_conversation_snapshot(self):
            return {"session_id": "session-1", "messages": []}

    context = Context()
    bridge = plugin._MainCliBridge(context, "http://127.0.0.1:4000", "token")
    calls = []
    candidate = {
        "requestId": "request-1",
        "runId": "run-1",
        "driverSource": "external_plugin",
        "contextAuthorityMode": "plugin_context_only",
        "message": "hello",
    }

    def request(path, payload=None):
        calls.append((path, payload))
        if path == "/next":
            bridge._stop.set()
            return candidate
        return {"ok": True}

    monkeypatch.setattr(bridge, "_request", request)
    bridge._poll()

    assert context.messages == [("hello", False, "bypass_automatic")]
    assert calls[-1][1]["kind"] == "rejected"
    assert calls[-1][1]["error"] == "main_driver_turn_already_running"
    assert bridge._active is None


def test_main_bridge_marks_unfinished_native_stream_cancelled(monkeypatch):
    bridge = plugin._MainCliBridge(SimpleNamespace(), "http://127.0.0.1:4000", "token")
    bridge._active = {
        "requestId": "request-1",
        "runId": "run-1",
        "driverSource": "internal_chat",
        "message": "hello",
    }
    events = []
    monkeypatch.setattr(
        bridge,
        "_request",
        lambda path, payload=None: events.append((path, payload)) or {"ok": True},
    )

    bridge.on_stream_end(finished=False)

    assert events[-1][1]["kind"] == "failed"
    assert events[-1][1]["error"] == "main_cli_turn_cancelled"
    assert bridge._active is None


def test_main_bridge_projects_live_cli_history_without_tool_messages(monkeypatch):
    context = SimpleNamespace(cli_conversation_snapshot=lambda: {
        "session_id": "session-1",
        "messages": [
            {"role": "user", "content": "question"},
            {"role": "tool", "content": "private tool output"},
            {"role": "assistant", "content": [
                {"type": "text", "text": "answer"}
            ]},
        ],
    })
    bridge = plugin._MainCliBridge(context, "http://127.0.0.1:4000", "token")
    calls = []
    monkeypatch.setattr(
        bridge,
        "_request",
        lambda path, payload=None: calls.append((path, payload)) or {"ok": True},
    )

    bridge._sync_history()
    bridge._sync_history()

    assert calls == [("/history", {
        "sessionId": "session-1",
        "messages": [
            {"role": "user", "text": "question"},
            {"role": "assistant", "text": "answer"},
        ],
    })]


@pytest.mark.parametrize("status", [401, 403, 409, 503])
def test_rejected_lookup_never_returns_an_environment(monkeypatch, status):
    error = urllib.error.HTTPError(
        plugin._DEFAULT_ENDPOINT, status, "private-response", {}, io.BytesIO()
    )
    monkeypatch.setattr(
        plugin.urllib.request, "build_opener", lambda *_args: _Opener(error=error)
    )
    with pytest.raises(RuntimeError) as caught:
        plugin._worker_environment(_context())
    assert str(caught.value) == f"liquidaity_card_bearer_lookup_http_{status}"
    assert "private-response" not in str(caught.value)


def test_oversized_response_never_returns_an_environment(monkeypatch):
    monkeypatch.setattr(
        plugin.urllib.request,
        "build_opener",
        lambda *_args: _Opener(_Response(b"x" * (plugin._MAX_RESPONSE_BYTES + 1))),
    )
    with pytest.raises(RuntimeError, match="lookup_response_too_large"):
        plugin._worker_environment(_context())


def test_installed_entrypoint_load_repeat_and_unload(tmp_path, monkeypatch):
    from hermes_cli.plugins import PluginManager, discover_entrypoint_manifests

    manifests = [
        entry for entry in discover_entrypoint_manifests()
        if entry.name == "liquidaity-card-mcp"
    ]
    assert len(manifests) == 1
    manifest = manifests[0]
    assert manifest.path == "liquidaity_hermes_plugin"
    manager = PluginManager(scope_key=str(tmp_path))
    # Exercise the real installed package and native lifecycle, excluding other
    # plugins from this provider-free test's scope.
    monkeypatch.setattr(
        manager, "_discover_and_load_inner", lambda: manager._load_plugin(manifest)
    )
    try:
        manager.discover_and_load()
        manager.discover_and_load()
        loaded = manager._plugins[manifest.key]
        assert loaded.enabled is True
        assert loaded.error is None
        assert len(manager._kanban_worker_environment_providers) == 1
        assert manager.unload(manifest.key) is True
        assert manager._kanban_worker_environment_providers == []
        manager.discover_and_load(force=True)
        assert len(manager._kanban_worker_environment_providers) == 1
    finally:
        manager.unload()
    assert manager._kanban_worker_environment_providers == []
