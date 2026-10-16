"""Server-side client for the WorldSignals agent command channel."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import time
from typing import Any
from urllib.parse import urlsplit
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from app.python_models.signal_contracts import (
    SignalPackage,
    build_signal_query,
    package_signal_result,
)


class WorldSignalsError(RuntimeError):
    pass


_MAX_REQUEST_BYTES = 256 * 1024
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
_MAX_SSE_BYTES = 1024 * 1024
_COMMAND_ID = re.compile(r"^[a-z][a-z0-9_]{0,127}$")


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:
        return None


_URL_OPENER = build_opener(_RejectRedirects())


def _canonical_command(value: Any) -> str:
    if not isinstance(value, str):
        raise WorldSignalsError("worldsignals_command_invalid")
    command = value.strip().lower()
    if _COMMAND_ID.fullmatch(command) is None:
        raise WorldSignalsError("worldsignals_command_invalid")
    return command


def _credential_key(value: Any) -> bool:
    normalized = "".join(character for character in str(value).lower() if character.isalnum())
    return any(marker in normalized for marker in (
        "apikey", "accesstoken", "refreshtoken", "authorization",
        "password", "clientsecret", "privatekey",
    )) or normalized.endswith(("secret", "token"))


def _assert_secret_free_arguments(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if _credential_key(key):
                raise WorldSignalsError("worldsignals_argument_secret_forbidden")
            _assert_secret_free_arguments(item)
    elif isinstance(value, list):
        for item in value:
            _assert_secret_free_arguments(item)


def _validated_base_url(value: str, secret: str) -> str:
    raw = str(value or "").strip()
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError as error:
        raise WorldSignalsError("worldsignals_backend_url_invalid") from error
    loopback = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if (
        parsed.scheme not in {"http", "https"}
        or (parsed.scheme == "http" and not loopback)
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or port is None
    ):
        raise WorldSignalsError("worldsignals_backend_url_invalid")
    if not loopback and len(secret) < 32:
        raise WorldSignalsError("worldsignals_hmac_secret_required")
    return raw.rstrip("/")


# Capability boundary — enforced here, at the one chokepoint both the MCP host
# and the tool registry route through, NOT in prompt wording. WorldSignals is a
# mainstream live-world intelligence product by default: markets, weather,
# transport, energy, infrastructure, news, entities, imagery, watches. The
# upstream app also ships recon/SIGINT/mesh-governance commands; those stay
# implemented upstream but are NOT in the default automatic grant. They are
# refused unless an operator explicitly enables the extended profile via
# WORLDSIGNALS_EXTENDED_PROFILE=1. This makes the default product genuinely
# non-cyber — it is a real boundary, not concealment.
WORLDSIGNALS_RESTRICTED_COMMANDS: frozenset[str] = frozenset({
    # Network recon / device discovery (Shodan-centric)
    "osint_sweep",
    "osint_lookup",
    "osint_tools",
    "entity_expand",
    # Signals intelligence
    "get_sigint_totals",
    # InfoNet / mesh governance, Dead Drop messaging, reputation
    "list_gates",
    "read_gate_messages",
    "post_gate_message",
    "cast_vote",
    "send_dm",
    "poll_dms",
    "join_infonet_swarm",
    "ensure_infonet_ready",
    "infonet_status",
})


def _extended_profile_enabled() -> bool:
    return str(os.environ.get("WORLDSIGNALS_EXTENDED_PROFILE", "")).strip().lower() in {"1", "true", "yes"}


def _guard_command(command: str) -> str:
    command = _canonical_command(command)
    if command in WORLDSIGNALS_RESTRICTED_COMMANDS and not _extended_profile_enabled():
        raise WorldSignalsError(
            f"worldsignals_command_requires_extended_profile: '{command}' is a recon/SIGINT/"
            "mesh command outside the default mainstream WorldSignals profile. Enable it "
            "deliberately via WORLDSIGNALS_EXTENDED_PROFILE=1; it is not part of the automatic grant."
        )
    return command


class WorldSignalsClient:
    def __init__(self, base_url: str | None = None, secret: str | None = None) -> None:
        self.secret = secret if secret is not None else self._configured_secret()
        self.base_url = _validated_base_url(
            base_url or os.environ.get("WORLDSIGNALS_BACKEND_URL") or "http://127.0.0.1:8000",
            self.secret,
        )

    @staticmethod
    def _configured_secret() -> str:
        return str(
            os.environ.get("WORLDSIGNALS_HMAC_SECRET")
            or os.environ.get("OPENCLAW_HMAC_SECRET")
            or ""
        ).strip()

    def _headers(self, method: str, path: str, body: bytes) -> dict[str, str]:
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if not self.secret:
            return headers
        timestamp = str(int(time.time()))
        nonce = secrets.token_hex(16)
        digest = hashlib.sha256(body).hexdigest()
        message = f"{method.upper()}|{path}|{timestamp}|{nonce}|{digest}"
        signature = hmac.new(self.secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()
        headers.update({
            "X-SB-Timestamp": timestamp,
            "X-SB-Nonce": nonce,
            "X-SB-Signature": signature,
        })
        return headers

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        _assert_secret_free_arguments(payload)
        try:
            body = b"" if payload is None else json.dumps(
                payload, separators=(",", ":"), allow_nan=False,
            ).encode("utf-8")
        except (TypeError, ValueError) as error:
            raise WorldSignalsError("worldsignals_request_invalid") from error
        if len(body) > _MAX_REQUEST_BYTES:
            raise WorldSignalsError("worldsignals_request_too_large")
        request = Request(
            f"{self.base_url}{path}",
            data=body if method.upper() != "GET" else None,
            headers=self._headers(method, path, body),
            method=method.upper(),
        )
        try:
            with _URL_OPENER.open(request, timeout=30) as response:
                raw = response.read(_MAX_RESPONSE_BYTES + 1)
                if len(raw) > _MAX_RESPONSE_BYTES:
                    raise WorldSignalsError("worldsignals_response_too_large")
                decoded = json.loads(raw.decode("utf-8"))
                if not isinstance(decoded, dict):
                    raise WorldSignalsError("worldsignals_invalid_response")
                return decoded
        except HTTPError as err:
            detail = err.read().decode("utf-8", errors="replace")[:500]
            raise WorldSignalsError(f"worldsignals_http_{err.code}: {detail}") from err
        except (URLError, TimeoutError) as err:
            raise WorldSignalsError(f"worldsignals_unreachable: {err}") from err
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as err:
            raise WorldSignalsError("worldsignals_invalid_response") from err

    def capabilities(self) -> dict[str, Any]:
        return self.request("GET", "/api/ai/capabilities")

    def tools(self) -> dict[str, Any]:
        return self.request("GET", "/api/ai/tools")

    def command_operation_classes(self, commands: list[str]) -> list[str]:
        """Resolve command read/write classes from the live canonical manifest."""
        _version, entries = _validated_tool_manifest(self.tools())
        by_name = {
            str(entry.get("name") or ""): str(entry.get("type") or "").lower()
            for entry in entries or []
            if isinstance(entry, dict)
        }
        classes: list[str] = []
        for raw_command in commands:
            command = _canonical_command(raw_command)
            operation_class = by_name.get(command)
            if operation_class not in {"read", "write"}:
                raise WorldSignalsError(
                    f"worldsignals_command_operation_class_unavailable:{command}"
                )
            classes.append(operation_class)
        return classes

    def command(self, command: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        command = _guard_command(command)
        return self.request("POST", "/api/ai/channel/command", {"cmd": command, "args": arguments or {}})

    def batch(self, commands: list[dict[str, Any]]) -> dict[str, Any]:
        normalized: list[dict[str, Any]] = []
        for entry in commands:
            if not isinstance(entry, dict):
                raise WorldSignalsError("worldsignals_batch_invalid")
            normalized.append({
                **entry,
                "cmd": _guard_command(entry.get("cmd")),
            })
        return self.request("POST", "/api/ai/channel/batch", {"commands": normalized})

    def poll(self) -> dict[str, Any]:
        return self.request("POST", "/api/ai/channel/poll", {})

    def stream_events(self, max_events: int = 1, timeout_seconds: int = 15) -> dict[str, Any]:
        path = "/api/ai/channel/sse"
        request = Request(f"{self.base_url}{path}", headers=self._headers("GET", path, b""), method="GET")
        events: list[dict[str, Any]] = []
        try:
            deadline = time.monotonic() + max(1, min(timeout_seconds, 30))
            total_bytes = 0
            with _URL_OPENER.open(request, timeout=max(1, min(timeout_seconds, 30))) as response:
                event_type = "message"
                data: list[str] = []
                while len(events) < max(1, min(max_events, 20)):
                    if time.monotonic() >= deadline:
                        raise WorldSignalsError("worldsignals_sse_deadline")
                    raw_line = response.readline()
                    if not raw_line:
                        if data:
                            raw = "\n".join(data)
                            try:
                                payload = json.loads(raw)
                            except json.JSONDecodeError:
                                payload = raw
                            events.append({"type": event_type, "data": payload})
                        break
                    total_bytes += len(raw_line)
                    if total_bytes > _MAX_SSE_BYTES:
                        raise WorldSignalsError("worldsignals_sse_too_large")
                    line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                    if line.startswith("event:"):
                        event_type = line[6:].strip()
                    elif line.startswith("data:"):
                        data.append(line[5:].strip())
                    elif not line and data:
                        raw = "\n".join(data)
                        try:
                            payload: Any = json.loads(raw)
                        except json.JSONDecodeError:
                            payload = raw
                        events.append({"type": event_type, "data": payload})
                        event_type, data = "message", []
                return {"ok": True, "events": events}
        except (HTTPError, URLError, TimeoutError) as err:
            raise WorldSignalsError(f"worldsignals_sse_failed: {err}") from err


# The raw upstream manifest is ~74,300 chars (~18.5k tokens) per call: 27.9k of
# capabilities + 46.4k of tool schemas. Almost none of it can change a decision.
# The model never performs transport — worldsignals_command() does — so auth,
# sse/websocket/rest endpoint blocks and per-tool `returns` samples are pure
# context weight. Project the manifest down to what actually selects a command.
_CAPABILITY_DECISION_KEYS = ("ok", "version", "routing")
_TOOLS_DECISION_KEYS = ("ok", "version", "access_tier")
_TOOL_DESCRIPTION_MAX = 240


def _validated_tool_manifest(value: Any) -> tuple[str, list[dict[str, Any]]]:
    if not isinstance(value, dict) or value.get("ok") is not True:
        raise WorldSignalsError("worldsignals_manifest_invalid")
    version = str(value.get("version") or "").strip()
    entries = value.get("tools")
    available = value.get("available_commands")
    if (
        not version
        or not isinstance(entries, list)
        or not isinstance(available, list)
        or any(
            not isinstance(name, str) or _COMMAND_ID.fullmatch(name) is None
            for name in available
        )
        or len(available) != len(set(available))
    ):
        raise WorldSignalsError("worldsignals_manifest_invalid")
    available_names = set(available)
    accepted: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise WorldSignalsError("worldsignals_manifest_invalid")
        name = str(entry.get("name") or "").strip().lower()
        operation_type = str(entry.get("type") or "").strip().lower()
        parameters = entry.get("parameters")
        if (
            _COMMAND_ID.fullmatch(name) is None
            or name in seen
            or operation_type not in {"read", "write"}
            or (parameters is not None and not isinstance(parameters, dict))
        ):
            raise WorldSignalsError("worldsignals_manifest_invalid")
        seen.add(name)
        if name in available_names:
            accepted.append({**entry, "name": name, "type": operation_type})
    if not available_names.issubset(seen):
        raise WorldSignalsError("worldsignals_manifest_invalid")
    return version, accepted


def _project_tool(entry: dict[str, Any]) -> dict[str, Any]:
    description = str(entry.get("description") or "").strip()
    if len(description) > _TOOL_DESCRIPTION_MAX:
        description = f"{description[: _TOOL_DESCRIPTION_MAX - 1]}…"
    projected: dict[str, Any] = {
        "name": entry.get("name"),
        "type": entry.get("type"),
        "description": description,
    }
    # `parameters` is kept: the model needs it to call correctly. `returns` is
    # dropped — the real result teaches that better than a sample ever could.
    if entry.get("parameters"):
        projected["parameters"] = entry["parameters"]
    subtypes = entry.get("subtypes")
    if isinstance(subtypes, dict):
        projected["subtypes"] = sorted(str(name) for name in subtypes)[:20]
    return projected


def _normalized_text(value: Any) -> str:
    if isinstance(value, list):
        return " ".join(str(item) for item in value)
    if isinstance(value, dict):
        return " ".join(str(key) for key in value)
    return str(value or "")


def _tool_domain(entry: dict[str, Any]) -> str:
    return _normalized_text(
        entry.get("domain")
        or entry.get("category")
        or entry.get("namespace")
        or entry.get("group")
        or entry.get("subtypes")
    ).strip()


def worldsignals_capabilities(
    domain: str | None = None,
    command: str | None = None,
    keyword: str | None = None,
    operation_class: str | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    """Return a BOUNDED view of the live WorldSignals capabilities + command manifest.

    Commands the profile guard would refuse are omitted rather than advertised:
    listing a tool that `_guard_command` rejects costs context to read and then
    burns a whole turn on a refusal the manifest could have prevented. The guard
    itself remains the enforcement point — this only stops offering what it will
    not allow, so the manifest tells the truth about the active profile.
    """
    client = WorldSignalsClient()
    raw_capabilities = client.capabilities()
    raw_tools = client.tools()

    if not isinstance(raw_capabilities, dict) or raw_capabilities.get("ok") is not True:
        raise WorldSignalsError("worldsignals_capabilities_invalid")
    capability_version = str(raw_capabilities.get("version") or "").strip()
    tool_version, manifest_entries = _validated_tool_manifest(raw_tools)
    if not capability_version or capability_version != tool_version:
        raise WorldSignalsError("worldsignals_manifest_version_mismatch")

    capabilities = {k: raw_capabilities[k] for k in _CAPABILITY_DECISION_KEYS if k in raw_capabilities}
    tools: dict[str, Any] = {k: raw_tools[k] for k in _TOOLS_DECISION_KEYS if k in raw_tools}
    omitted_entries = [
        entry
        for entry in manifest_entries
        if (
            str(entry.get("name") or "") in WORLDSIGNALS_RESTRICTED_COMMANDS
            and not _extended_profile_enabled()
        )
    ]
    allowed_entries = [
        entry
        for entry in manifest_entries
        if entry not in omitted_entries
    ]
    class_counts = {"read": 0, "write": 0, "other": 0}
    for entry in allowed_entries:
        operation_type = str(entry.get("type") or "").strip().lower()
        class_counts[operation_type if operation_type in {"read", "write"} else "other"] += 1

    domain_filter = str(domain or "").strip().casefold()
    command_filter = str(command or "").strip().casefold()
    keyword_filter = str(keyword or "").strip().casefold()
    class_filter = str(operation_class or "").strip().casefold()

    def selected(entry: dict[str, Any]) -> bool:
        name = str(entry.get("name") or "").strip()
        entry_domain = _tool_domain(entry)
        operation_type = str(entry.get("type") or "").strip().lower()
        if command_filter and name.casefold() != command_filter:
            return False
        if domain_filter:
            domain_searchable = " ".join(
                (entry_domain, name, str(entry.get("description") or ""))
            ).casefold()
            if domain_filter not in domain_searchable:
                return False
        if class_filter and operation_type != class_filter:
            return False
        if keyword_filter:
            searchable = " ".join(
                (
                    name,
                    str(entry.get("description") or ""),
                    entry_domain,
                    _normalized_text(entry.get("tags")),
                )
            ).casefold()
            if keyword_filter not in searchable:
                return False
        return True

    matched = [entry for entry in allowed_entries if selected(entry)]
    bounded_limit = max(1, min(int(limit), 50))
    tools["tools"] = [_project_tool(entry) for entry in matched[:bounded_limit]]
    tools["inventory"] = {"total": len(allowed_entries), **class_counts}
    tools["match_count"] = len(matched)
    tools["returned_count"] = min(len(matched), bounded_limit)
    tools["truncated"] = len(matched) > bounded_limit
    tools["filters"] = {
        key: value
        for key, value in {
            "domain": str(domain or "").strip(),
            "command": str(command or "").strip(),
            "keyword": str(keyword or "").strip(),
            "operation_class": class_filter,
        }.items()
        if value
    }
    tools["available_commands"] = [
        str(entry.get("name") or "")
        for entry in matched[:bounded_limit]
        if str(entry.get("name") or "").strip()
    ]
    tools["profile"] = "extended" if _extended_profile_enabled() else "mainstream"
    tools["omitted_restricted_commands"] = len(omitted_entries)
    tools["omissions"] = [
        {
            "name": str(entry.get("name") or ""),
            "reason": "requires_explicit_extended_profile",
        }
        for entry in omitted_entries
        if str(entry.get("name") or "").strip()
    ]
    return {"capabilities": capabilities, "tools": tools}


def worldsignals_command(command: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """Run one real command exposed by the live WorldSignals command manifest."""
    return WorldSignalsClient().command(command, arguments)


def worldsignals_batch(commands: list[dict[str, Any]]) -> dict[str, Any]:
    """Run up to twenty real WorldSignals commands through its existing batch channel."""
    return WorldSignalsClient().batch(commands)


def worldsignals_poll() -> dict[str, Any]:
    """Poll completed command results and tasks from the live WorldSignals channel."""
    return WorldSignalsClient().poll()


def worldsignals_stream_events(max_events: int = 1, timeout_seconds: int = 15) -> dict[str, Any]:
    """Read a bounded set of real-time events from the WorldSignals SSE channel."""
    return WorldSignalsClient().stream_events(max_events, timeout_seconds)


def collect_worldsignals_signal_package(
    *,
    command: str,
    arguments: dict[str, Any] | None,
    project_id: str,
    deck_id: str,
    requesting_card_id: str,
    requesting_run_id: str,
    reason: str,
    producer_card_id: str,
    producer_run_id: str,
    domains: list[str] | None = None,
    source_refs: list[str] | None = None,
    max_age_seconds: int | None = None,
    limit: int = 25,
    client: WorldSignalsClient | None = None,
    retrieved_at: str | None = None,
) -> SignalPackage:
    """Collect one real read-only WorldSignals result as a typed signal package.

    This is an internal Card-runtime seam, not a public tool: the trusted caller
    must supply authenticated Card/Run identity. Before dispatch it reads the
    live WorldSignals manifest and refuses commands not explicitly classified read.
    """

    source_client = client or WorldSignalsClient()
    query = build_signal_query(
        project_id=project_id,
        deck_id=deck_id,
        requesting_card_id=requesting_card_id,
        requesting_run_id=requesting_run_id,
        reason=reason,
        source_system="worldsignals",
        command=command,
        arguments=arguments,
        domains=domains,
        source_refs=source_refs,
        max_age_seconds=max_age_seconds,
        limit=limit,
    )
    operation_class = source_client.command_operation_classes([query.command])[0]
    if operation_class != "read":
        raise WorldSignalsError(f"worldsignals_signal_query_requires_read_command:{query.command}")
    result = source_client.command(query.command, query.arguments)
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise WorldSignalsError("worldsignals_signal_command_failed")
    return package_signal_result(
        query=query,
        producer_card_id=producer_card_id,
        producer_run_id=producer_run_id,
        result=result,
        retrieved_at=retrieved_at,
    )
