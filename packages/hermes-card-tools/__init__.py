"""Native Hermes tools backed by the authenticated saved Card runtime."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse


PLUGIN_KEY = "card-tools"
TOOLSET = "card-tools"
REQUEST_TTL_SECONDS = 300
MAX_REQUEST_BYTES = 512 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _failure(code: str) -> str:
    return _json({"ok": False, "error": code})


def _is_loopback_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        if parsed.scheme != "http" or parsed.username or parsed.password or parsed.fragment:
            return False
        host = parsed.hostname
        if not host:
            return False
        return host.lower() == "localhost" or ipaddress.ip_address(host).is_loopback
    except (TypeError, ValueError):
        return False


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "redirect refused", headers, fp)


def _post_once(host_url: str, envelope: dict[str, str]) -> tuple[int, dict[str, Any]]:
    if not _is_loopback_url(host_url):
        raise ValueError("host URL must be loopback HTTP")
    body = _json(envelope).encode("utf-8")
    if len(body) > MAX_REQUEST_BYTES:
        raise ValueError("tool request exceeds the input limit")
    request = urllib.request.Request(
        host_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    opener = urllib.request.build_opener(_NoRedirect())
    try:
        response = opener.open(request)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("tool response exceeds the output limit")
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("tool response must be an object")
        return int(response.status), value


def _load_tools(config_path: Path | None = None) -> list[dict[str, Any]]:
    path = config_path or Path(__file__).with_name("tools.json")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or set(value) != {"tools"} or not isinstance(value["tools"], list):
        raise ValueError("card_tools_configuration_invalid")
    tools: list[dict[str, Any]] = []
    names: set[str] = set()
    for raw in value["tools"]:
        if not isinstance(raw, dict) or set(raw) != {
            "canonicalName", "hermesName", "description", "inputSchema",
        }:
            raise ValueError("card_tools_configuration_invalid")
        canonical_name = raw["canonicalName"]
        hermes_name = raw["hermesName"]
        description = raw["description"]
        schema = raw["inputSchema"]
        if (
            not isinstance(canonical_name, str) or not canonical_name
            or not isinstance(hermes_name, str) or not hermes_name
            or not isinstance(description, str)
            or not isinstance(schema, dict)
            or hermes_name in names
        ):
            raise ValueError("card_tools_configuration_invalid")
        names.add(hermes_name)
        tools.append({
            "canonicalName": canonical_name,
            "hermesName": hermes_name,
            "description": description,
            "inputSchema": schema,
        })
    return tools


def _invoke(hermes_name: str, args: Any, *, task_id: str) -> str:
    if os.getenv("CARD_TOOLS_MANAGED") != "1":
        return _failure("managed_card_runtime_required")
    if not isinstance(args, dict):
        return _failure("card_tool_arguments_invalid")
    token = os.getenv("HERMES_DASHBOARD_SESSION_TOKEN", "")
    host_url = os.getenv("CARD_TOOLS_HOST_URL", "").strip()
    if not token:
        return _failure("card_tool_gateway_credential_missing")
    if not host_url:
        return _failure("card_tool_host_url_missing")
    if not task_id:
        return _failure("card_tool_runtime_identity_missing")
    payload = _json({
        "version": 1,
        "expiresAt": int(time.time()) + REQUEST_TTL_SECONDS,
        "nonce": secrets.token_hex(16),
        "sourceStoredSessionId": task_id,
        "tool": hermes_name,
        "arguments": args,
    })
    token_bytes = token.encode("utf-8")
    envelope = {
        "keyId": hashlib.sha256(token_bytes).hexdigest(),
        "payload": payload,
        "signature": hmac.new(
            token_bytes,
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest(),
    }
    try:
        status, response = _post_once(host_url, envelope)
    except Exception:
        return _failure("card_tool_host_unavailable")
    output = response.get("output")
    if status != 200 or response.get("ok") is not True or not isinstance(output, str):
        return _failure(str(response.get("error") or "card_tool_execution_failed"))
    return output


def _handler(hermes_name: str) -> Callable[..., str]:
    def invoke(args: Any, **context: Any) -> str:
        return _invoke(
            hermes_name,
            args,
            task_id=str(context.get("task_id") or ""),
        )

    return invoke


def register(ctx: Any) -> None:
    for tool in _load_tools():
        ctx.register_tool(
            name=tool["hermesName"],
            toolset=TOOLSET,
            schema={
                "name": tool["hermesName"],
                "description": tool["description"],
                "parameters": tool["inputSchema"],
            },
            handler=_handler(tool["hermesName"]),
            description=tool["description"],
        )
