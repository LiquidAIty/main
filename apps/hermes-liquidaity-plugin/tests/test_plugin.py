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
    tools = []
    ctx = SimpleNamespace(
        register_kanban_worker_environment_provider=callbacks.append,
        register_tool=lambda **kwargs: tools.append(kwargs),
    )

    plugin.register(ctx)

    assert callbacks == [plugin._worker_environment]
    assert len(tools) == 1
    assert tools[0]["name"] == "execute_host_script"
    assert tools[0]["handler"] is plugin._handle_execute_host_script


def test_registers_existing_native_hooks_for_main_semantic_projection(
    monkeypatch,
):
    hooks = {}
    unload = []
    monkeypatch.setenv("LIQUIDAITY_MAIN_BRIDGE_URL", "http://127.0.0.1:4000")
    monkeypatch.setenv("LIQUIDAITY_MAIN_BRIDGE_TOKEN", "token")
    monkeypatch.setattr(plugin._MainCliBridge, "start", lambda self: None)
    ctx = SimpleNamespace(
        register_kanban_worker_environment_provider=lambda _callback: None,
        register_tool=lambda **_kwargs: None,
        register_hook=lambda name, callback: hooks.setdefault(name, callback),
        on_unload=unload.append,
    )

    plugin.register(ctx)

    assert set(hooks) == {
        "on_stream_start", "on_stream_delta", "on_stream_end",
        "post_llm_call", "pre_tool_call", "post_tool_call",
        "subagent_start", "subagent_stop", "pre_api_request",
        "post_api_request", "api_request_error",
    }
    assert len(unload) == 1


def test_host_script_handler_returns_typed_output_and_native_receipt(monkeypatch):
    import acp_adapter.host_profiles as host_profiles
    import tools.code_execution_tool as code_execution_tool

    config = {
        "version": 7,
        "source": "source",
        "sourceHash": "a" * 64,
        "compiledHash": "b" * 64,
        "mode": "tool_recipe",
        "inputSchema": {
            "type": "object",
            "properties": {"focus": {"type": "string"}},
            "required": ["focus"],
            "additionalProperties": False,
        },
        "outputSchema": {
            "type": "object",
            "properties": {
                "context": {"type": "object"},
                "agent": {
                    "type": "object",
                    "properties": {"run": {"type": "boolean"}},
                    "required": ["run"],
                },
            },
            "required": ["context", "agent"],
        },
        "toolAliases": {"constellation.context": "mcp__card__constellation_context"},
        "fallbackToolAliases": {"constellation.context": "mcp__card__constellation_context"},
        "toolStates": {"constellation.context": 1},
        "timeoutSeconds": 10,
        "maxToolCalls": 2,
        "maxOutputBytes": 4096,
    }
    monkeypatch.setattr(host_profiles, "current_host_script_config", lambda: config)
    calls = []

    def execute(code, **kwargs):
        calls.append((code, kwargs))
        return json.dumps({
            "status": "success",
            "output": 'HERMES_CARD_SCRIPT_OUTPUT:{"context":{"id":"n1"},"agent":{"run":false}}',
            "exit_code": 0,
            "duration_seconds": 0.1,
            "tool_calls_made": 1,
            "tool_calls": [{
                "canonicalId": "constellation.context",
                "nativeTool": "mcp__card__constellation_context",
                "durationSeconds": 0.05,
            }],
        })

    monkeypatch.setattr(code_execution_tool, "execute_code", execute)
    result = json.loads(plugin._handle_execute_host_script(
        {"focus": "launch"}, task_id="session-one"
    ))

    assert result["ok"] is True
    assert result["output"] == {
        "context": {"id": "n1"}, "agent": {"run": False},
    }
    assert result["receipt"]["sourceHash"] == "a" * 64
    assert result["receipt"]["version"] == 7
    assert result["receipt"]["toolCalls"][0]["canonicalId"] == "constellation.context"
    assert calls[0][0] == "source"
    assert calls[0][1]["host_script"]["toolAliases"] == config["toolAliases"]


def test_host_script_validation_failure_activates_exact_selected_mcp_fallback(monkeypatch):
    import acp_adapter.host_profiles as host_profiles

    config = {
        "version": 9,
        "source": "source",
        "sourceHash": "a" * 64,
        "compiledHash": "b" * 64,
        "mode": "tool_recipe",
        "inputSchema": {
            "type": "object",
            "properties": {"focus": {"type": "string"}},
            "required": ["focus"],
            "additionalProperties": False,
        },
        "outputSchema": {"type": "object", "properties": {}},
        "toolAliases": {"constellation.context": "mcp__card__constellation_context"},
        "fallbackToolAliases": {"constellation.context": "mcp__card__constellation_context"},
        "toolStates": {"constellation.context": 1},
        "timeoutSeconds": 10,
        "maxToolCalls": 2,
        "maxOutputBytes": 4096,
    }
    monkeypatch.setattr(host_profiles, "current_host_script_config", lambda: config)
    monkeypatch.setattr(
        host_profiles, "activate_host_script_fallback", lambda: ["constellation.context"]
    )

    result = json.loads(plugin._handle_execute_host_script({}, task_id="session-one"))

    assert result["ok"] is False
    assert result["fallback"] == {
        "activated": True,
        "presentationMode": "selected-mcp",
        "tools": ["constellation.context"],
    }
    assert result["receipt"]["version"] == 9
    assert result["receipt"]["status"] == "validation_error"


def test_host_script_failure_after_tool_call_is_terminal_without_fallback(monkeypatch):
    import acp_adapter.host_profiles as host_profiles
    import tools.code_execution_tool as code_execution_tool

    config = {
        "version": 10,
        "source": "source",
        "sourceHash": "a" * 64,
        "compiledHash": "b" * 64,
        "mode": "tool_recipe",
        "inputSchema": {
            "type": "object",
            "properties": {"focus": {"type": "string"}},
            "required": ["focus"],
            "additionalProperties": False,
        },
        "outputSchema": {"type": "object", "properties": {}},
        "toolAliases": {"constellation.context": "mcp__card__constellation_context"},
        "fallbackToolAliases": {"constellation.context": "mcp__card__constellation_context"},
        "toolStates": {"constellation.context": 1},
        "timeoutSeconds": 10,
        "maxToolCalls": 2,
        "maxOutputBytes": 4096,
    }
    monkeypatch.setattr(host_profiles, "current_host_script_config", lambda: config)
    fallback_calls = []
    monkeypatch.setattr(
        host_profiles,
        "activate_host_script_fallback",
        lambda: fallback_calls.append(True),
    )
    monkeypatch.setattr(
        code_execution_tool,
        "execute_code",
        lambda *_args, **_kwargs: json.dumps({
            "status": "error",
            "error": "script_failed_after_operation",
            "tool_calls_made": 1,
            "tool_calls": [{"canonicalId": "constellation.context"}],
        }),
    )

    result = json.loads(plugin._handle_execute_host_script(
        {"focus": "launch"}, task_id="session-one"
    ))

    assert result["ok"] is False
    assert result["error"] == "script_failed_after_operation"
    assert result["fallback"] == {
        "activated": False,
        "presentationMode": "script-failed-after-operation",
        "reason": "operation_started_no_replay",
    }
    assert result["receipt"]["toolCallsMade"] == 1
    assert fallback_calls == []


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
        "started", "projection", "projection", "projection",
        "projection", "projection", "completed"
    ]
    projections = [event[1]["projection"] for event in events
                   if event[1]["kind"] == "projection"]
    assert [event["category"] for event in projections] == [
        "execution.receipt", "conversation.answer", "execution.progress",
        "conversation.answer", "execution.receipt",
    ]
    assert projections[1]["text"] == "public delta"
    assert projections[3]["text"] == "public final"
    assert events[-1][1]["finalText"] == "public final"
    assert [event["sequence"] for event in projections] == [1, 2, 3, 4, 5]
    assert bridge._active is None


def test_main_bridge_projects_tool_child_receipt_and_error_identity(monkeypatch):
    bridge = plugin._MainCliBridge(
        SimpleNamespace(), "http://127.0.0.1:4000", "token"
    )
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
        lambda path, payload=None: events.append((path, payload))
        or {"ok": True},
    )

    bridge.on_pre_tool_call(
        tool_name="terminal", args={"command": "pwd"},
        tool_call_id="tool-1", session_id="session-1", turn_id="turn-1",
        task_id="task-1",
    )
    bridge.on_post_tool_call(
        tool_name="terminal", result="C:/workspace", status="ok",
        tool_call_id="tool-1", session_id="session-1", turn_id="turn-1",
        task_id="task-1", duration_ms=8,
    )
    bridge.on_subagent_start(
        parent_session_id="session-1", parent_turn_id="turn-1",
        child_session_id="child-1", child_role="researcher",
        child_goal="read only",
    )
    bridge.on_subagent_stop(
        parent_session_id="session-1", parent_turn_id="turn-1",
        child_session_id="child-1", child_role="researcher",
        child_status="completed", child_summary="done",
    )
    bridge.on_api_request_error(
        api_request_id="api-1", session_id="session-1", turn_id="turn-1",
        task_id="task-1", provider="openai-codex", model="gpt-5.6",
        retry_count=1, max_retries=2, retryable=True,
        error={"type": "rate_limit", "message": "retry"},
    )

    projections = [event[1]["projection"] for event in events]
    assert [event["category"] for event in projections] == [
        "execution.command", "execution.command", "execution.child",
        "execution.child", "execution.error",
    ]
    assert [event["id"] for event in projections[:2]] == [
        "tool-1:started", "tool-1:finished",
    ]
    assert projections[2]["nativeChildId"] == "child-1"
    assert projections[3]["state"] == "completed"
    assert projections[4]["state"] == "retrying"
    assert projections[4]["provider"] == "openai-codex"


def test_main_bridge_rejects_remote_turn_when_native_cli_is_busy(monkeypatch):
    class Context:
        def __init__(self):
            self.messages = []

        def inject_message(
            self, message, *, interrupt_running, external_memory_mode,
            host_execution_request_id
        ):
            self.messages.append(
                (
                    message,
                    interrupt_running,
                    external_memory_mode,
                    host_execution_request_id,
                )
            )
            return False

        def cli_conversation_snapshot(self):
            return {"session_id": "session-1", "messages": []}

        def bind_cli_host_execution(self, *_args, **_kwargs):
            return True

        def clear_cli_host_execution(self, *_args):
            return True

    context = Context()
    bridge = plugin._MainCliBridge(context, "http://127.0.0.1:4000", "token")
    calls = []
    candidate = {
        "requestId": "request-1",
        "runId": "run-1",
        "executionContextId": "context-1",
        "driverSource": "external_plugin",
        "contextAuthorityMode": "plugin_context_only",
        "message": "hello",
        "mcpServers": [],
        "sessionConfig": {},
    }

    def request(path, payload=None):
        calls.append((path, payload))
        if path == "/next":
            bridge._stop.set()
            return candidate
        return {"ok": True}

    monkeypatch.setattr(bridge, "_request", request)
    bridge._poll()

    assert context.messages == [(
        "hello", False, "bypass_automatic", "request-1",
    )]
    assert calls[-1][1]["kind"] == "rejected"
    assert calls[-1][1]["error"] == "main_driver_turn_already_running"
    assert bridge._active is None


def test_main_bridge_does_not_claim_first_remote_turn_before_cli_identity_exists(
    monkeypatch,
):
    class Context:
        def cli_conversation_snapshot(self):
            bridge._stop.set()
            return None

    bridge = plugin._MainCliBridge(
        Context(), "http://127.0.0.1:4000", "token"
    )
    calls = []
    monkeypatch.setattr(
        bridge,
        "_request",
        lambda path, payload=None: calls.append((path, payload)) or None,
    )

    bridge._poll()

    assert not any(path == "/next" for path, _payload in calls)


def test_main_bridge_marks_unfinished_native_stream_cancelled(monkeypatch):
    bridge = plugin._MainCliBridge(SimpleNamespace(), "http://127.0.0.1:4000", "token")
    bridge._active = {
        "requestId": "request-1",
        "runId": "run-1",
        "driverSource": "internal_chat",
        "message": "hello",
        "mcpServers": [],
        "sessionConfig": {},
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


def test_main_bridge_binds_host_lifecycle_before_the_model_call(monkeypatch):
    calls = []

    class Context:
        def bind_cli_host_execution(
            self, context_id, requester, session_id, **kwargs
        ):
            calls.append(
                ("bind-native", context_id, requester, session_id, kwargs)
            )
            return True

    bridge = plugin._MainCliBridge(Context(), "http://127.0.0.1:4000", "token")
    bridge._active = {
        "requestId": "request-1",
        "runId": "run-1",
        "executionContextId": "context-1",
        "driverSource": "internal_chat",
        "contextAuthorityMode": "main_native_honcho",
        "message": "hello",
        "mcpServers": [],
        "sessionConfig": {},
    }
    monkeypatch.setattr(
        bridge,
        "_request",
        lambda path, payload=None: calls.append((path, payload)) or {"ok": True},
    )

    bridge._bind_active_execution(session_id="session-1")

    assert calls[0] == ("/execution/bind", {
        "requestId": "request-1",
        "runId": "run-1",
        "executionContextId": "context-1",
        "sessionId": "session-1",
    })
    assert calls[1][0:2] == ("bind-native", "context-1")
    assert calls[1][3] == "session-1"
    assert calls[1][4] == {
        "request_id": "request-1",
        "external_memory_mode": "normal",
        "profile_targets": [],
        "session_config": {},
    }


def test_main_bridge_reserves_the_long_timeout_for_host_execution(monkeypatch):
    openers = []

    def build_opener(*_args):
        opener = _Opener(_Response(json.dumps({
            "ok": True,
            "result": {"runId": "child-run", "result": "done"},
        }).encode()))
        openers.append(opener)
        return opener

    monkeypatch.setattr(plugin.urllib.request, "build_opener", build_opener)
    bridge = plugin._MainCliBridge(SimpleNamespace(), "http://127.0.0.1:4000", "token")

    assert bridge._request("/next") == {
        "ok": True,
        "result": {"runId": "child-run", "result": "done"},
    }
    assert bridge._host_requester("session/delegate_profile", {}) == {
        "runId": "child-run",
        "result": "done",
    }
    assert [opener.timeout for opener in openers] == [
        plugin._TIMEOUT_SECONDS,
        plugin._EXECUTION_TIMEOUT_SECONDS,
    ]


def test_main_bridge_delivers_team_result_once_then_syncs_history(monkeypatch):
    delivered = []

    class Context:
        def append_cli_native_team_result(self, session_id, **kwargs):
            delivered.append((session_id, kwargs))
            return True

        def cli_conversation_snapshot(self):
            return {"session_id": "session-1", "messages": []}

    bridge = plugin._MainCliBridge(Context(), "http://127.0.0.1:4000", "token")
    calls = []
    delivery = {
        "deliveryId": "delivery-1",
        "sessionId": "session-1",
        "taskId": "t_team",
        "result": "reviewed result",
        "state": "completed",
    }

    def request(path, payload=None):
        calls.append((path, payload))
        if path == "/team-results/next":
            return delivery
        return {"ok": True}

    monkeypatch.setattr(bridge, "_request", request)
    bridge._deliver_team_result()

    assert delivered == [("session-1", {
        "task_id": "t_team",
        "result": "reviewed result",
        "terminal_state": "completed",
    })]
    assert ("/team-results/ack", {
        "deliveryId": "delivery-1",
        "delivered": True,
    }) in calls
    assert any(path == "/history" for path, _payload in calls)


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
