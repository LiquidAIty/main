"""Thin, fail-closed middleware for Card-authorized native Hermes Bot DMs."""

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
from typing import Any, Callable
from urllib.parse import urlparse


PLUGIN_KEY = "card-bot-dm"
MESSAGE_TOOL = "message_agent"
MESSAGE_MAX_CHARS = 16_000
REQUEST_TTL_SECONDS = 300
MAX_RESPONSE_BYTES = 128 * 1024


def _json(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _failure(reason: str, message: str) -> str:
    return _json({"status": "error", "reason": reason, "error": message})


def _normalized_args(args: Any) -> tuple[str, str] | str:
    if not isinstance(args, dict):
        return _failure("invalid_arguments", "message_agent arguments must be an object")
    raw_target = args.get("target")
    if not isinstance(raw_target, str):
        return _failure("invalid_target", "target must be a string")
    target = raw_target.strip()
    if target.startswith("@"):
        target = target[1:].strip()
    if not target:
        return _failure("invalid_target", "target is required")
    message = args.get("message")
    if not isinstance(message, str):
        return _failure("invalid_message", "message must be a string")
    if not message.strip():
        return _failure("invalid_message", "message is required")
    if len(message) > MESSAGE_MAX_CHARS:
        return _failure(
            "message_too_long",
            f"message exceeds the {MESSAGE_MAX_CHARS} character limit",
        )
    return target, message


def _is_loopback_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"}:
            return False
        if parsed.username or parsed.password or parsed.fragment:
            return False
        host = parsed.hostname
        if not host:
            return False
        if host.lower() == "localhost":
            return True
        return ipaddress.ip_address(host).is_loopback
    except (TypeError, ValueError):
        return False


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "redirect refused", headers, fp)


def _post_once(host_url: str, envelope: dict[str, str]) -> tuple[int, dict[str, Any]]:
    if not _is_loopback_url(host_url):
        raise ValueError("host URL must be loopback")
    body = _json(envelope).encode("utf-8")
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
            raise ValueError("host response exceeds the output limit")
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("host response must be an object")
        return int(response.status), value


def _managed_message_agent(args: Any, *, task_id: str) -> str:
    if os.getenv("CARD_BOT_DM_MANAGED") != "1":
        return _failure(
            "managed_mode_required",
            "managed Bot DM routing is not enabled for this profile",
        )
    token = os.getenv("HERMES_DASHBOARD_SESSION_TOKEN", "")
    host_url = os.getenv("CARD_BOT_DM_HOST_URL", "").strip()
    if not token:
        return _failure("missing_gateway_credential", "Gateway credential is unavailable")
    if not host_url:
        return _failure("missing_host_url", "Bot DM host URL is unavailable")
    if not task_id:
        return _failure("missing_runtime_identity", "native runtime identity is required")
    normalized = _normalized_args(args)
    if isinstance(normalized, str):
        return normalized
    target, message = normalized
    payload = _json(
        {
            "version": 1,
            "expiresAt": int(time.time()) + REQUEST_TTL_SECONDS,
            "nonce": secrets.token_hex(16),
            "sourceStoredSessionId": task_id,
            "target": target,
            "message": message,
        }
    )
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
        return _failure("managed_delivery_failed", "Managed Bot DM submission failed")
    if status == 501 and response.get("error") == "hermes_bot_dm_native_completion_identity_unavailable":
        return _failure(
            "native_completion_identity_unavailable",
            "Hermes Gateway accepted the Bot submission but exposes no exact completion identity",
        )
    return _failure("managed_delivery_failed", "Managed Bot DM host rejected the submission")


def tool_execution(
    *,
    tool_name: str,
    args: Any,
    next_call: Callable[[Any], Any],
    task_id: str = "",
    **_context: Any,
) -> Any:
    """Forward unmanaged tools once; exclusively authorize managed message_agent."""
    if tool_name != MESSAGE_TOOL or os.getenv("CARD_BOT_DM_MANAGED") != "1":
        return next_call(args)
    return _managed_message_agent(args, task_id=str(task_id or ""))


def register(ctx: Any) -> None:
    ctx.register_middleware("tool_execution", tool_execution)
