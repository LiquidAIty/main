"""Native Hermes tools backed by the authenticated saved Card runtime."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import re
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
VISIBLE_CARD_TARGETS_SECTION = "card-tools.visible-card-targets"
VISIBLE_CARD_TARGETS_MAX_CHARS = 4_000
PROJECT_ROSTER_TOOL = "project_roster.resolve"
_VISIBLE_CARD_TITLE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$", re.ASCII)
_WORKER_AUTH_ENV = (
    "HERMES_KANBAN_TASK",
    "HERMES_KANBAN_RUN_ID",
    "HERMES_KANBAN_CLAIM_LOCK",
    "HERMES_PROFILE",
)


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


def _signed_envelope(secret: str, payload: str) -> dict[str, str]:
    secret_bytes = secret.encode("utf-8")
    return {
        "keyId": hashlib.sha256(secret_bytes).hexdigest(),
        "payload": payload,
        "signature": hmac.new(
            secret_bytes,
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest(),
    }


def _worker_envelope(
    hermes_name: str,
    args: dict[str, Any],
) -> tuple[dict[str, str] | None, str | None]:
    """Build the detached native worker envelope, or report its exact env failure.

    A dispatcher claim is an all-or-nothing capability.  Never fall back to the
    persistent Gateway credential when only part of the native worker identity is
    present, and never put that Gateway credential or a Bot Chat session id in the
    worker payload.
    """
    values = {name: os.getenv(name, "").strip() for name in _WORKER_AUTH_ENV}
    present = {name for name, value in values.items() if value}
    if not present:
        return None, None
    if len(present) != len(_WORKER_AUTH_ENV):
        return None, "card_tool_worker_identity_incomplete"
    try:
        source_run_id = int(values["HERMES_KANBAN_RUN_ID"])
    except ValueError:
        return None, "card_tool_worker_identity_invalid"
    if source_run_id <= 0:
        return None, "card_tool_worker_identity_invalid"
    payload = _json({
        "version": 2,
        "expiresAt": int(time.time()) + REQUEST_TTL_SECONDS,
        "nonce": secrets.token_hex(16),
        "sourceTaskId": values["HERMES_KANBAN_TASK"],
        "sourceTaskRunId": source_run_id,
        "sourceProfile": values["HERMES_PROFILE"],
        "tool": hermes_name,
        "arguments": args,
    })
    return _signed_envelope(values["HERMES_KANBAN_CLAIM_LOCK"], payload), None


def _invoke(hermes_name: str, args: Any, *, task_id: str) -> str:
    if os.getenv("CARD_TOOLS_MANAGED") != "1":
        return _failure("managed_card_runtime_required")
    if not isinstance(args, dict):
        return _failure("card_tool_arguments_invalid")
    host_url = os.getenv("CARD_TOOLS_HOST_URL", "").strip()
    if not host_url:
        return _failure("card_tool_host_url_missing")
    worker_envelope, worker_error = _worker_envelope(hermes_name, args)
    if worker_error:
        return _failure(worker_error)
    if worker_envelope is not None:
        envelope = worker_envelope
    else:
        token = os.getenv("HERMES_DASHBOARD_SESSION_TOKEN", "")
        if not token:
            return _failure("card_tool_gateway_credential_missing")
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
        envelope = _signed_envelope(token, payload)
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


def _request_project_roster_payload(
    source_stored_session_id: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    """Resolve the current Project roster through the signed Card-session seam.

    The backend owns Project/deck/Card topology.  The plugin supplies only the exact
    Hermes stored-session identity and never reads or unions profile-global config.
    """
    if os.getenv("CARD_TOOLS_MANAGED") != "1" or not source_stored_session_id:
        raise ValueError("managed project session required")
    host_url = os.getenv("CARD_TOOLS_HOST_URL", "").strip()
    token = os.getenv("HERMES_DASHBOARD_SESSION_TOKEN", "")
    if not host_url or not token:
        raise ValueError("managed project session credential missing")
    payload = _json({
        "version": 1,
        "expiresAt": int(time.time()) + REQUEST_TTL_SECONDS,
        "nonce": secrets.token_hex(16),
        "sourceStoredSessionId": source_stored_session_id,
        "tool": PROJECT_ROSTER_TOOL,
        "arguments": arguments,
    })
    status, response = _post_once(host_url, _signed_envelope(token, payload))
    output = response.get("output")
    if status != 200 or response.get("ok") is not True or not isinstance(output, str):
        raise ValueError("project roster unavailable")
    decoded = json.loads(output)
    if not isinstance(decoded, dict):
        raise ValueError("project roster response invalid")
    return decoded


def _validated_project_roster(decoded: dict[str, Any]) -> list[tuple[str, str]]:
    raw_targets = decoded["targets"]
    if not isinstance(raw_targets, list):
        raise ValueError("project roster response invalid")
    targets: list[tuple[str, str]] = []
    seen_titles: set[str] = set()
    seen_profiles: set[str] = set()
    for raw in raw_targets:
        if not isinstance(raw, dict) or set(raw) != {"profile", "title"}:
            raise ValueError("project roster response invalid")
        title, profile = raw.get("title"), raw.get("profile")
        if (
            not isinstance(title, str) or not _VISIBLE_CARD_TITLE_RE.fullmatch(title)
            or not isinstance(profile, str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", profile, re.ASCII)
            or title.casefold() in seen_titles
            or profile in seen_profiles
        ):
            raise ValueError("project roster response invalid")
        seen_titles.add(title.casefold())
        seen_profiles.add(profile)
        targets.append((title, profile))
    return targets


def _request_project_roster(source_stored_session_id: str) -> list[tuple[str, str]]:
    decoded = _request_project_roster_payload(source_stored_session_id, {})
    if set(decoded) != {"targets"}:
        raise ValueError("project roster response invalid")
    return _validated_project_roster(decoded)


def _request_project_target(
    source_stored_session_id: str,
    visible_target: str,
) -> tuple[list[tuple[str, str]], str, str]:
    decoded = _request_project_roster_payload(
        source_stored_session_id, {"target": visible_target},
    )
    if set(decoded) != {"resolved", "targets"} or not isinstance(decoded["resolved"], dict):
        raise ValueError("project roster response invalid")
    targets = _validated_project_roster(decoded)
    resolved = decoded["resolved"]
    if set(resolved) != {"profile", "storedSessionId"}:
        raise ValueError("project roster response invalid")
    profile, stored_session_id = resolved.get("profile"), resolved.get("storedSessionId")
    if (
        not isinstance(profile, str)
        or profile not in {target_profile for _title, target_profile in targets}
        or not isinstance(stored_session_id, str)
        or not stored_session_id
        or len(stored_session_id) > 512
    ):
        raise ValueError("project roster response invalid")
    return targets, profile, stored_session_id


def _visible_card_targets(source_stored_session_id: str | None) -> list[tuple[str, str]]:
    """Return exact ``(visible title, stable profile)`` pairs for one Project session."""
    if not source_stored_session_id:
        return []
    try:
        return _request_project_roster(source_stored_session_id)
    except Exception:
        return []


def _resolve_message_agent_target(
    *,
    target: Any = None,
    session_id: str = "",
    **_context: Any,
) -> dict[str, Any]:
    """Resolve one visible Card title through one authenticated Project session."""
    if not isinstance(target, str) or not session_id:
        raise ValueError("project roster request invalid")
    visible_target = target.strip()
    if visible_target.startswith("@"):
        visible_target = visible_target[1:]
    if not visible_target:
        raise ValueError("project roster request invalid")
    targets, stable_profile, stored_session_id = _request_project_target(
        session_id, visible_target,
    )
    return {
        "profile": stable_profile,
        "roster": [profile for _title, profile in targets],
        "stored_session_id": stored_session_id,
    }


def _visible_card_targets_prompt(source_stored_session_id: str | None) -> str:
    """Render only exact public Card addresses; stable runtime identities stay private."""
    targets = _visible_card_targets(source_stored_session_id)
    if not targets:
        return ""
    prompt = (
        "Use `message_agent` with one of these exact visible saved-Card addresses:\n"
        + "\n".join(f"- `@{title}`" for title, _stable_profile in targets)
    )
    return prompt if len(prompt) <= VISIBLE_CARD_TARGETS_MAX_CHARS else ""


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
    ctx.register_hook(
        "resolve_message_agent_target",
        _resolve_message_agent_target,
    )
    ctx.register_system_prompt_section(
        VISIBLE_CARD_TARGETS_SECTION,
        lambda session_info: _visible_card_targets_prompt(
            str(session_info.get("session_id") or ""),
        ),
        max_chars=VISIBLE_CARD_TARGETS_MAX_CHARS,
    )
