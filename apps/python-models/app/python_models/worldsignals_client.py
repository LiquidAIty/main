"""Server-side client for the WorldSignals agent command channel."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class WorldSignalsError(RuntimeError):
    pass


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


def _guard_command(command: str) -> None:
    if command in WORLDSIGNALS_RESTRICTED_COMMANDS and not _extended_profile_enabled():
        raise WorldSignalsError(
            f"worldsignals_command_requires_extended_profile: '{command}' is a recon/SIGINT/"
            "mesh command outside the default mainstream WorldSignals profile. Enable it "
            "deliberately via WORLDSIGNALS_EXTENDED_PROFILE=1; it is not part of the automatic grant."
        )


class WorldSignalsClient:
    def __init__(self, base_url: str | None = None, secret: str | None = None) -> None:
        self.base_url = (base_url or os.environ.get("WORLDSIGNALS_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
        self.secret = secret if secret is not None else self._configured_secret()

    @staticmethod
    def _configured_secret() -> str:
        configured = os.environ.get("WORLDSIGNALS_HMAC_SECRET") or os.environ.get("OPENCLAW_HMAC_SECRET")
        if configured:
            return configured
        local_env = Path(__file__).resolve().parents[4] / "worldsignal" / "Shadowbroker-main" / ".env"
        try:
            for line in local_env.read_text(encoding="utf-8").splitlines():
                if line.startswith("OPENCLAW_HMAC_SECRET="):
                    return line.split("=", 1)[1].strip()
        except OSError:
            pass
        return ""

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
        body = b"" if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",
            data=body if method.upper() != "GET" else None,
            headers=self._headers(method, path, body),
            method=method.upper(),
        )
        try:
            with urlopen(request, timeout=30) as response:  # noqa: S310 — configured WorldSignals endpoint
                decoded = json.loads(response.read().decode("utf-8"))
                if not isinstance(decoded, dict):
                    raise WorldSignalsError("worldsignals_invalid_response")
                return decoded
        except HTTPError as err:
            detail = err.read().decode("utf-8", errors="replace")[:500]
            raise WorldSignalsError(f"worldsignals_http_{err.code}: {detail}") from err
        except (URLError, TimeoutError) as err:
            raise WorldSignalsError(f"worldsignals_unreachable: {err}") from err

    def capabilities(self) -> dict[str, Any]:
        return self.request("GET", "/api/ai/capabilities")

    def tools(self) -> dict[str, Any]:
        return self.request("GET", "/api/ai/tools")

    def command(self, command: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        _guard_command(command)
        return self.request("POST", "/api/ai/channel/command", {"cmd": command, "args": arguments or {}})

    def batch(self, commands: list[dict[str, Any]]) -> dict[str, Any]:
        for entry in commands:
            _guard_command(str((entry or {}).get("cmd", "")))
        return self.request("POST", "/api/ai/channel/batch", {"commands": commands})

    def poll(self) -> dict[str, Any]:
        return self.request("POST", "/api/ai/channel/poll", {})

    def stream_events(self, max_events: int = 1, timeout_seconds: int = 15) -> dict[str, Any]:
        path = "/api/ai/channel/sse"
        request = Request(f"{self.base_url}{path}", headers=self._headers("GET", path, b""), method="GET")
        events: list[dict[str, Any]] = []
        try:
            with urlopen(request, timeout=max(1, min(timeout_seconds, 30))) as response:  # noqa: S310
                event_type = "message"
                data: list[str] = []
                while len(events) < max(1, min(max_events, 20)):
                    line = response.readline().decode("utf-8", errors="replace").rstrip("\r\n")
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
    return projected


def worldsignals_capabilities() -> dict[str, Any]:
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

    capabilities = {k: raw_capabilities[k] for k in _CAPABILITY_DECISION_KEYS if k in raw_capabilities}
    tools: dict[str, Any] = {k: raw_tools[k] for k in _TOOLS_DECISION_KEYS if k in raw_tools}

    entries = raw_tools.get("tools")
    allowed = [
        _project_tool(entry)
        for entry in (entries if isinstance(entries, list) else [])
        if isinstance(entry, dict)
        and not (
            str(entry.get("name") or "") in WORLDSIGNALS_RESTRICTED_COMMANDS
            and not _extended_profile_enabled()
        )
    ]
    tools["tools"] = allowed
    available = raw_tools.get("available_commands")
    if isinstance(available, list):
        tools["available_commands"] = [
            name
            for name in available
            if not (str(name) in WORLDSIGNALS_RESTRICTED_COMMANDS and not _extended_profile_enabled())
        ]
    tools["profile"] = "extended" if _extended_profile_enabled() else "mainstream"
    tools["omitted_restricted_commands"] = 0 if _extended_profile_enabled() else len(
        WORLDSIGNALS_RESTRICTED_COMMANDS
    )
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
