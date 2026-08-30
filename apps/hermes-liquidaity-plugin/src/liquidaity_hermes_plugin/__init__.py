"""Card-scoped LiquidAIty MCP authorization for native Kanban workers.

The backend remains the only bearer issuer and saved-Card grant authority.
This provider sends bounded native claim identity over loopback and returns one
ephemeral value for the child process environment. It stores and logs neither
the bearer nor the Card configuration.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from typing import Mapping


_DEFAULT_ENDPOINT = "http://127.0.0.1:4000/api/internal/hermes-kanban/worker-bearer"
_TIMEOUT_SECONDS = 3.0
_MAX_RESPONSE_BYTES = 64 * 1024
_MAIN_BRIDGE_POLL_SECONDS = 0.2
_SCRIPT_OUTPUT_PREFIX = "HERMES_CARD_SCRIPT_OUTPUT:"
_HOST_SCRIPT_SCHEMA = {
    "name": "execute_host_script",
    "description": "Run the immutable Python composition Script supplied by the trusted Card host.",
    "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": True,
    },
}


def _endpoint() -> str:
    return os.environ.get(
        "LIQUIDAITY_HERMES_WORKER_BEARER_URL", _DEFAULT_ENDPOINT
    ).strip()


def _worker_environment(context) -> Mapping[str, str] | None:
    payload = json.dumps(
        {
            "taskId": context.task_id,
            "nativeRunId": context.run_id,
            "board": context.board,
            "assignee": context.assignee,
            "profile": context.profile,
            "workspace": context.workspace,
            "claimLock": context.claim_lock,
        },
        separators=(",", ":"),
    ).encode("utf-8")
    request = urllib.request.Request(
        _endpoint(),
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=_TIMEOUT_SECONDS) as response:
            body = response.read(_MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            # An ordinary Hermes task with no LiquidAIty Card Run correlation
            # keeps the stock worker lane unchanged.
            return None
        raise RuntimeError(
            f"liquidaity_card_bearer_lookup_http_{error.code}"
        ) from error
    except (OSError, urllib.error.URLError) as error:
        raise RuntimeError("liquidaity_card_bearer_lookup_unavailable") from error

    if len(body) > _MAX_RESPONSE_BYTES:
        raise RuntimeError("liquidaity_card_bearer_lookup_response_too_large")
    try:
        decoded = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("liquidaity_card_bearer_lookup_response_invalid") from error
    bearer = decoded.get("bearer") if isinstance(decoded, dict) else None
    if (
        not isinstance(decoded, dict)
        or decoded.get("ok") is not True
        or not isinstance(bearer, str)
        or not 64 <= len(bearer) <= 8192
        or any(character.isspace() for character in bearer)
    ):
        raise RuntimeError("liquidaity_card_bearer_lookup_response_invalid")
    mcp_url = decoded.get("mcpUrl")
    try:
        address = urlsplit(mcp_url) if isinstance(mcp_url, str) else None
        if (
            address is None
            or address.scheme != "http"
            or address.hostname not in {"127.0.0.1", "localhost"}
            or address.path != "/mcp"
            or address.username or address.password or address.query or address.fragment
        ):
            raise ValueError()
    except ValueError:
        raise RuntimeError("liquidaity_card_mcp_url_invalid") from None
    # The native child resolves this template against its own environment.
    # Neither a profile file nor a second credential/connection owner is created.
    return {
        "LIQUIDAITY_CARD_BEARER": bearer,
        "HERMES_MCP_SERVERS": json.dumps({
            "liquidaity-card": {
                "url": mcp_url,
                "headers": {"Authorization": "Bearer ${LIQUIDAITY_CARD_BEARER}"},
                "lazy": False,
            },
        }, separators=(",", ":")),
    }


class _MainCliBridge:
    """Structured control/public-message side channel for this CLI process."""

    def __init__(self, ctx, endpoint: str, token: str):
        self._ctx = ctx
        self._endpoint = endpoint.rstrip("/")
        self._token = token
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._active: dict | None = None
        self._last_history_json: str | None = None
        self._last_history_sync_at = 0.0
        self._thread = threading.Thread(
            target=self._poll,
            daemon=True,
            name="liquidaity-main-cli-bridge",
        )

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=1.0)

    def _request(self, path: str, payload: dict | None = None) -> dict | None:
        data = None if payload is None else json.dumps(
            payload, separators=(",", ":")
        ).encode("utf-8")
        request = urllib.request.Request(
            self._endpoint + path,
            data=data,
            headers={
                "Authorization": f"Bearer {self._token}",
                **({"Content-Type": "application/json"} if data is not None else {}),
            },
            method="POST" if data is not None else "GET",
        )
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=_TIMEOUT_SECONDS) as response:
                body = response.read(_MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as error:
            if error.code == 204:
                return None
            raise RuntimeError(f"liquidaity_main_bridge_http_{error.code}") from error
        if len(body) > _MAX_RESPONSE_BYTES:
            raise RuntimeError("liquidaity_main_bridge_response_too_large")
        if not body:
            return None
        decoded = json.loads(body.decode("utf-8"))
        if not isinstance(decoded, dict):
            raise RuntimeError("liquidaity_main_bridge_response_invalid")
        return decoded

    def _event(self, kind: str, **payload) -> None:
        with self._lock:
            active = dict(self._active) if self._active is not None else None
        if active is None:
            return
        try:
            self._request("/events", {
                "requestId": active["requestId"],
                "runId": active["runId"],
                "contextAuthorityMode": (
                    "plugin_context_only"
                    if active["driverSource"] == "external_plugin"
                    else "main_native_honcho"
                ),
                "kind": kind,
                **payload,
            })
        except Exception:
            # The native turn continues even if its observer disconnects.
            pass

    def _clear(self) -> None:
        with self._lock:
            self._active = None

    @staticmethod
    def _message_text(content) -> str | None:
        if isinstance(content, str):
            return content
        if not isinstance(content, list):
            return None
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and isinstance(block.get("text"), str):
                parts.append(block["text"])
        return "".join(parts) if parts else None

    def _sync_history(self) -> None:
        snapshot = self._ctx.cli_conversation_snapshot()
        if not isinstance(snapshot, dict):
            return
        public_messages = []
        for message in snapshot.get("messages", []):
            if not isinstance(message, dict) or message.get("role") not in {
                "user", "assistant"
            }:
                continue
            text = self._message_text(message.get("content"))
            if text is not None:
                public_messages.append({"role": message["role"], "text": text})
        payload = {
            "sessionId": str(snapshot.get("session_id") or "") or None,
            "messages": public_messages,
        }
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        if encoded == self._last_history_json:
            return
        self._request("/history", payload)
        self._last_history_json = encoded

    def _poll(self) -> None:
        while not self._stop.is_set():
            try:
                with self._lock:
                    active = dict(self._active) if self._active is not None else None
                if active is not None:
                    self._stop.wait(_MAIN_BRIDGE_POLL_SECONDS)
                    continue
                now = time.monotonic()
                if now - self._last_history_sync_at >= 1.0:
                    self._sync_history()
                    self._last_history_sync_at = now
                candidate = self._request("/next")
                if not candidate:
                    self._stop.wait(_MAIN_BRIDGE_POLL_SECONDS)
                    continue
                required = (
                    "requestId", "runId", "driverSource", "message",
                    "contextAuthorityMode",
                )
                if any(not isinstance(candidate.get(key), str) or not candidate[key]
                       for key in required):
                    continue
                expected_context_mode = (
                    "plugin_context_only"
                    if candidate["driverSource"] == "external_plugin"
                    else "main_native_honcho"
                )
                if candidate["contextAuthorityMode"] != expected_context_mode:
                    continue
                with self._lock:
                    self._active = candidate
                accepted = self._ctx.inject_message(
                    candidate["message"],
                    interrupt_running=False,
                    external_memory_mode=(
                        "bypass_automatic"
                        if candidate["contextAuthorityMode"] == "plugin_context_only"
                        else "normal"
                    ),
                )
                if not accepted:
                    self._event("rejected", error="main_driver_turn_already_running")
                    self._clear()
                else:
                    self._event("accepted")
            except Exception:
                self._stop.wait(_MAIN_BRIDGE_POLL_SECONDS)

    def on_stream_start(self, **payload) -> None:
        self._event(
            "started",
            nativeSessionId=str(payload.get("session_id") or ""),
            nativeTurnId=str(payload.get("turn_id") or ""),
        )

    def on_stream_delta(self, **payload) -> None:
        if payload.get("kind") == "text" and isinstance(payload.get("delta"), str):
            self._event("text", delta=payload["delta"])

    def on_stream_end(self, **payload) -> None:
        error = payload.get("error")
        if error or payload.get("finished") is False:
            self._event(
                "failed",
                error=str(error or "main_cli_turn_cancelled"),
            )
            self._clear()

    def on_turn_complete(self, **payload) -> None:
        response = payload.get("assistant_response")
        self._event("completed", finalText=str(response or ""),
                    nativeSessionId=str(payload.get("session_id") or ""),
                    nativeTurnId=str(payload.get("turn_id") or ""))
        self._clear()


def _schema_type_matches(value, expected) -> bool:
    if isinstance(expected, list):
        return any(_schema_type_matches(value, item) for item in expected)
    return {
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "boolean": isinstance(value, bool),
        "null": value is None,
    }.get(expected, True)


def _validate_value(value: object, schema: dict, field: str) -> None:
    expected = schema.get("type")
    if expected is not None and not _schema_type_matches(value, expected):
        raise ValueError(f"liquidaity_card_script_{field}_type")
    if isinstance(value, dict) and (expected == "object" or "properties" in schema):
        _validate_object(value, schema, field)
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        for index, item in enumerate(value):
            _validate_value(item, schema["items"], f"{field}.{index}")


def _validate_object(value: object, schema: dict, field: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"liquidaity_card_script_{field}_must_be_object")
    properties = schema.get("properties") or {}
    required = schema.get("required") or []
    missing = [name for name in required if name not in value]
    if missing:
        raise ValueError(f"liquidaity_card_script_{field}_required:{missing[0]}")
    if schema.get("additionalProperties") is False:
        unknown = sorted(set(value) - set(properties))
        if unknown:
            raise ValueError(f"liquidaity_card_script_{field}_unknown:{unknown[0]}")
    for name, item in value.items():
        definition = properties.get(name)
        if isinstance(definition, dict):
            _validate_value(item, definition, f"{field}.{name}")


def _handle_execute_host_script(
    args: dict,
    *,
    task_id: str | None = None,
    session_id: str | None = None,
    **_kwargs,
) -> str:
    """Execute only the trusted session's immutable saved Card Script."""

    from acp_adapter.host_profiles import (
        activate_host_script_fallback,
        current_host_script_config,
    )
    from tools.code_execution_tool import execute_code

    config = current_host_script_config()
    if not isinstance(config, dict):
        return json.dumps({
            "ok": False,
            "error": "liquidaity_card_script_not_configured",
        }, separators=(",", ":"))
    def receipt(execution: dict | None = None) -> dict:
        execution = execution or {}
        return {
            "schemaVersion": "liquidaity.card-script.receipt.v1",
            "version": config["version"],
            "sourceHash": config["sourceHash"],
            "compiledHash": config["compiledHash"],
            "mode": config["mode"],
            "status": execution.get("status", "validation_error"),
            "exitCode": execution.get("exit_code"),
            "durationSeconds": execution.get("duration_seconds"),
            "toolCallsMade": execution.get("tool_calls_made", 0),
            "toolCalls": execution.get("tool_calls", []),
        }

    def failed(error: str, native_receipt: dict) -> str:
        try:
            fallback_tools = activate_host_script_fallback()
            fallback = {
                "activated": True,
                "presentationMode": "selected-mcp",
                "tools": fallback_tools,
            }
        except Exception as fallback_error:
            fallback = {
                "activated": False,
                "presentationMode": "script-failed",
                "error": str(fallback_error)[:2048],
            }
        return json.dumps({
            "ok": False,
            "error": error[:2048],
            "fallback": fallback,
            "receipt": native_receipt,
        }, ensure_ascii=False, separators=(",", ":"))

    try:
        _validate_object(args, config["inputSchema"], "input")
    except ValueError as error:
        return failed(str(error), receipt())
    raw = execute_code(
        config["source"],
        task_id=session_id or task_id,
        enabled_tools=list(config["toolAliases"].values()),
        host_script={
            "toolAliases": config["toolAliases"],
            "toolStates": config["toolStates"],
            "input": args,
            "timeoutSeconds": config["timeoutSeconds"],
            "maxToolCalls": config["maxToolCalls"],
        },
    )
    try:
        execution = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        execution = {"status": "error", "error": "native_execution_result_invalid"}
    native_receipt = receipt(execution)
    if execution.get("status") != "success":
        return failed(
            str(execution.get("error") or "card_script_execution_failed"),
            native_receipt,
        )
    output_text = str(execution.get("output") or "")
    emitted = [
        line[len(_SCRIPT_OUTPUT_PREFIX):]
        for line in output_text.splitlines()
        if line.startswith(_SCRIPT_OUTPUT_PREFIX)
    ]
    if len(emitted) != 1:
        return failed(
            "liquidaity_card_script_output_emit_once_required", native_receipt
        )
    if len(emitted[0].encode("utf-8")) > config["maxOutputBytes"]:
        return failed("liquidaity_card_script_output_too_large", native_receipt)
    try:
        output_value = json.loads(emitted[0])
        _validate_object(output_value, config["outputSchema"], "output")
    except (json.JSONDecodeError, ValueError) as error:
        return failed(str(error), native_receipt)
    return json.dumps({
        "ok": True,
        "output": output_value,
        "receipt": native_receipt,
    }, ensure_ascii=False, separators=(",", ":"))


def register(ctx) -> None:
    ctx.register_kanban_worker_environment_provider(_worker_environment)
    ctx.register_tool(
        name="execute_host_script",
        toolset="liquidaity-card-script",
        schema=_HOST_SCRIPT_SCHEMA,
        handler=_handle_execute_host_script,
        description=_HOST_SCRIPT_SCHEMA["description"],
        emoji="🐍",
    )
    endpoint = os.environ.get("LIQUIDAITY_MAIN_BRIDGE_URL", "").strip()
    token = os.environ.get("LIQUIDAITY_MAIN_BRIDGE_TOKEN", "").strip()
    if endpoint and token:
        bridge = _MainCliBridge(ctx, endpoint, token)
        ctx.register_hook("on_stream_start", bridge.on_stream_start)
        ctx.register_hook("on_stream_delta", bridge.on_stream_delta)
        ctx.register_hook("on_stream_end", bridge.on_stream_end)
        ctx.register_hook("post_llm_call", bridge.on_turn_complete)
        ctx.on_unload(bridge.stop)
        bridge.start()
