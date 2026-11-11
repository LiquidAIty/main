"""Main request-context and WorldView application operations."""
# Entity: WorldView
# Relationship: Publishes bounded source reads and view-only actions for the saved WorldView Card, alongside Main's existing Project capability control.

from __future__ import annotations

import asyncio
import json
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any
import httpx
from app.application_tool_error import ApplicationToolError
from app.backend_operation_transport import validated_backend_origin
from app.python_models.operation_definition import OperationDefinition
from mcp.types import TextContent
from jsonschema import validate, ValidationError

_SATELLITE_GROUPS = ("stations", "visual", "gps-ops", "glo-ops", "galileo", "geo", "starlink", "active")
_ACTION_FIELDS = {
    "latitude": {"type": "number", "minimum": -90, "maximum": 90},
    "longitude": {"type": "number", "minimum": -180, "maximum": 180},
    "query": {"type": "string", "minLength": 1, "maxLength": 200},
    "rangeM": {"type": "number", "minimum": 100, "maximum": 20000000},
    "viewMode": {"type": "string", "enum": ["overview", "close"]},
    "noradIds": {"type": "array", "maxItems": 50, "uniqueItems": True,
                 "items": {"type": "integer", "minimum": 1, "maximum": 9007199254740991}},
    "direction": {"type": "string", "enum": ["in", "out"]},
    "amount": {"type": "string", "enum": ["little", "medium", "lot"]},
    "scope": {"type": "string", "enum": ["selected", "auto", "in_view"]},
    "limit": {"type": "integer", "minimum": 1, "maximum": 12},
}
_ACTION_ARGUMENTS = {
    "get_current_view_state": ([], []), "zoom_to_globe": ([], []),
    "get_entity_context": (["scope", "limit"], ["scope"]),
    "adjust_camera_zoom": (["direction", "amount"], ["direction"]),
    "fly_to_location": (["latitude", "longitude", "query", "rangeM", "viewMode"], []),
    "focus_satellites": (["noradIds"], ["noradIds"]),
}


async def worldview_action(*, projectId: str, deckId: str, _callerCardId: str,
                           action: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """One bounded request to the already-mounted Project globe, never agent delivery."""
    from app import mcp_auth
    from app.backend_operation_transport import request_backend_json

    principal = mcp_auth.internal_mcp_principal() or {}
    if principal.get("projectId") != projectId or not principal.get("ownerUserId"):
        raise ApplicationToolError("worldview_project_scope_required")
    if action not in _ACTION_ARGUMENTS:
        raise ApplicationToolError("worldview_action_unsupported")
    args = {} if arguments is None else arguments
    fields, required = _ACTION_ARGUMENTS[action]
    try:
        validate(args, {"type": "object", "properties": {key: _ACTION_FIELDS[key] for key in fields},
                        "required": required, "additionalProperties": False})
        if any(isinstance(value, float) and not math.isfinite(value) for value in args.values()):
            raise ValueError()
        if action == "fly_to_location":
            coordinates = "latitude" in args and "longitude" in args
            if ("latitude" in args) != ("longitude" in args) or coordinates == ("query" in args):
                raise ValueError()
    except (ValidationError, ValueError):
        raise ApplicationToolError("worldview_action_arguments_invalid") from None
    return await asyncio.to_thread(request_backend_json, "POST", "/api/mcp/worldview/action", {
        "projectId": projectId, "deckId": deckId, "cardId": _callerCardId,
        "ownerUserId": principal["ownerUserId"], "action": action, "arguments": args,
    }, require_internal_secret=True)


def _satellite_records(text: str) -> tuple[list[dict[str, Any]], int]:
    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    records, rejected = [], 0
    for index, line in enumerate(lines):
        if not line.startswith("1 "):
            continue
        try:
            second = lines[index + 1]
            if not second.startswith("2 ") or second[2:7] != line[2:7]:
                raise ValueError()
            norad = int(line[2:7])
            year, day = int(line[18:20]), float(line[20:32])
            if not 1 <= day < 367:
                raise ValueError()
            epoch = datetime(2000 + year if year < 57 else 1900 + year, 1, 1, tzinfo=timezone.utc) + timedelta(days=day - 1)
            label = lines[index - 1].removeprefix("0 ") if index and not lines[index - 1].startswith("2 ") else str(norad)
            records.append({"noradId": norad, "name": label, "orbitalElementsEpoch": epoch.isoformat(),
                            "tleLine1": line, "tleLine2": second})
        except (ValueError, IndexError, OverflowError):
            rejected += 1
    return records, rejected


async def worldview_read(*, projectId: str, source: str = "catalog", group: str = "stations",
                         query: str = "", noradIds: list[int] | None = None, limit: int = 20) -> dict[str, Any]:
    """Read the existing God’s Eye provider; do not change a layer, graph, or camera."""
    if not projectId or source not in {"catalog", "satellites", "launches"}:
        raise ApplicationToolError("worldview_source_required: catalog, satellites or launches")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 50:
        raise ApplicationToolError("worldview_limit_must_be_1_to_50")
    if not isinstance(query, str) or len(query) > 200 or group not in _SATELLITE_GROUPS:
        raise ApplicationToolError("worldview_filter_invalid")
    if noradIds is not None and (not isinstance(noradIds, list) or len(noradIds) > 50
            or any(type(value) is not int or value <= 0 for value in noradIds)):
        raise ApplicationToolError("worldview_norad_ids_invalid")
    if source == "catalog":
        return {"projectId": projectId, "sources": [
            {"id": "satellites", "provider": "CelesTrak", "groups": list(_SATELLITE_GROUPS),
             "scope": "Catalog identities and orbital elements, not live measured positions or verified ownership."},
            {"id": "launches", "provider": "The Space Devs / Launch Library 2",
             "scope": "Provider's recent-launch window (up to 100 source records); cached data can be older."},
        ], "availability": "Read an exact source to check its current availability."}
    origin = validated_backend_origin(os.getenv("WORLDVIEW_GLOBE_URL", "http://127.0.0.1:4174"))
    route = f"/api/celestrak/{group}" if source == "satellites" else "/api/launches"
    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=False, trust_env=False) as client:
            async with client.stream("GET", origin + route) as response:
                response.raise_for_status()
                raw = bytearray()
                async for chunk in response.aiter_bytes():
                    raw.extend(chunk)
                    if len(raw) > 12 * 1024 * 1024:
                        raise ApplicationToolError("worldview_source_response_too_large")
                cache = response.headers.get("x-tle-cache" if source == "satellites" else "x-gev-cache", "UNKNOWN")
        text = raw.decode("utf-8")
        rejected = 0
        if source == "satellites":
            records, rejected = _satellite_records(text)
            source_url = f"https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=tle"
            limitations = ["Orbital-element epoch is not a live observation time; positions require propagation.",
                          "TLE format does not cover every newer catalog identifier. No ownership or financial inference is established."]
        else:
            payload = json.loads(text)
            if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
                raise ValueError()
            records = []
            for item in payload["results"]:
                pad, provider = item.get("pad") or {}, item.get("launch_service_provider") or {}
                records.append({"id": item.get("id"), "name": item.get("name"), "eventTime": item.get("net"),
                    "status": (item.get("status") or {}).get("name"), "sourceReference": item.get("url"),
                    "provider": {"id": provider.get("id"), "name": provider.get("name")},
                    "location": {"name": pad.get("name"), "latitude": pad.get("latitude"), "longitude": pad.get("longitude")}})
            source_url = "https://ll.thespacedevs.com/2.3.0/launches/"
            limitations = ["Bounded recent-launch feed, not a complete launch history or live ascent telemetry.",
                          "A planned launch time is not proof of launch; use each record's status."]
        needle = query.casefold().strip()
        matches = [record for record in records
                   if (not needle or needle in str(record.get("name") or "").casefold()
                       or needle in str((record.get("provider") or {}).get("name") or "").casefold())
                   and (not noradIds or record.get("noradId") in noradIds)]
        return {"projectId": projectId, "source": source, "sourceUrl": source_url,
                "retrievedAt": datetime.now(timezone.utc).isoformat(), "sourceAsOf": None,
                "cacheStatus": cache, "stale": cache.startswith("STALE"), "sourceCount": len(records),
                "matchedCount": len(matches), "truncated": len(matches) > limit, "rejectedRecords": rejected,
                "records": matches[:limit], "limitations": [*limitations,
                    "Retrieval time is this read's time, not the provider cache's original fetch time."]}
    except (httpx.HTTPError, UnicodeError, ValueError, TypeError, AttributeError) as error:
        raise ApplicationToolError(f"worldview_source_unavailable:{source}:{type(error).__name__}") from None

async def main_context(
    *,
    _mainContext: dict[str, Any] | None = None,
    _catalogDiagnostics: dict[str, Any] | None = None,
) -> list[TextContent]:
    if _mainContext is None:
        return [TextContent(type="text", text=json.dumps({
            "ok": False, "error": "main_context_unavailable",
        }))]
    return [TextContent(type="text", text=json.dumps({
        "ok": True,
        "context": _mainContext,
        "diagnostics": _catalogDiagnostics or {},
    }))]


async def worldview_set_capability(
    *, projectId: str, capabilityId: str, enabled: Any, reason: str,
) -> list[TextContent]:
    from app.python_models.project_worldview import (
        ProjectWorldviewError,
        set_main_project_worldview_capability,
    )

    try:
        result = await asyncio.to_thread(
            set_main_project_worldview_capability,
            projectId,
            capabilityId,
            enabled,
            reason,
        )
    except ProjectWorldviewError as error:
        result = {"ok": False, "error": str(error)}
    return [TextContent(type="text", text=json.dumps(result))]


def main_worldview_operation_definitions(
    external: frozenset[str],
    internal: frozenset[str],
) -> list[OperationDefinition]:
    return [
        OperationDefinition(
            canonical_id="worldview.action", title="Control WorldView globe",
            description="Control the one already-open Project globe or read its displayed view. Does not open a view or enable layers. "
                        "fly_to_location requires either exact latitude/longitude or a fully qualified place query. "
                        "Use source-backed coordinates or an explicit user place; preserve returned place, scope and confirmation. "
                        "Unavailable, ambiguous and unconfirmed actions are not success; do not automatically resend.",
            parameters_schema={"type": "object", "properties": {
                "projectId": {"type": "string", "minLength": 1},
                "action": {"type": "string", "enum": list(_ACTION_ARGUMENTS)},
                "arguments": {"type": "object", "properties": _ACTION_FIELDS, "additionalProperties": False},
            }, "required": ["action"], "additionalProperties": False},
            output_schema={"type": "object"}, handler=worldview_action, available=True, publishers=external,
            access="write", namespace="worldview", grant_eligible=True, grant_profiles=frozenset({"worldview"}),
            annotations={"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False},
            server_injected_arguments=frozenset({"projectId"}),
            dispatcher_context_arguments=frozenset({"projectId", "deckId", "_callerCardId"}),
        ),
        OperationDefinition(
            canonical_id="worldview.read", title="Read WorldView data",
            description="Read bounded satellite or launch records from the existing WorldView provider. Start with catalog. "
                        "Returns source references, event/element times and cache limitations; never enables a layer or moves the globe.",
            parameters_schema={"type": "object", "properties": {
                "projectId": {"type": "string", "minLength": 1},
                "source": {"type": "string", "enum": ["catalog", "satellites", "launches"], "default": "catalog"},
                "group": {"type": "string", "enum": list(_SATELLITE_GROUPS), "default": "stations"},
                "query": {"type": "string", "maxLength": 200, "description": "Literal name/provider filter, not inferred ownership."},
                "noradIds": {"type": "array", "maxItems": 50, "items": {"type": "integer", "minimum": 1}},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
            }, "additionalProperties": False},
            output_schema={"type": "object"}, handler=worldview_read, available=True, publishers=external,
            access="read", namespace="worldview", grant_eligible=True,
            annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
            server_injected_arguments=frozenset({"projectId"}), dispatcher_context_arguments=frozenset({"projectId"}),
        ),
        OperationDefinition(
            canonical_id="main.context",
            title="Read Main request context",
            description=(
                "Read the compact server-owned Main entry context for this authenticated "
                "Main request: project, deck, conversation, parent run, and saved "
                "Main-card identities, plus the canonical frozen host catalog and "
                "process/source identity. Request authorization may expose a smaller tool list. "
                "Accepts no caller-supplied identity or context payload."
            ),
            parameters_schema={"type": "object", "properties": {}, "required": []},
            handler=main_context,
            available=True,
            publishers=external,
            access="read",
            namespace="main",
            annotations={
                "readOnlyHint": True,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            grant_eligible=False,
            external_entry=True,
            dispatcher_context_arguments=frozenset({
                "_mainContext", "_catalogDiagnostics",
            }),
        ),
        OperationDefinition(
            canonical_id="worldview.set_capability",
            title="Set a WorldView capability",
            description=(
                "Main only: set Main's ON/OFF choice for one exact capability in the "
                "current authenticated Project WorldView. The server supplies Project "
                "identity. Call only when the current user turn explicitly asks to "
                "change that shared spatial layer. An explicit user choice remains "
                "authoritative over this value."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string", "minLength": 1},
                    "capabilityId": {
                        "type": "string",
                        "pattern": r"^[a-z0-9][a-z0-9._:-]{0,127}$",
                    },
                    "enabled": {"type": "boolean"},
                    "reason": {"type": "string", "minLength": 1, "maxLength": 1000},
                },
                "required": ["capabilityId", "enabled", "reason"],
                "additionalProperties": False,
            },
            handler=worldview_set_capability,
            available=True,
            publishers=external,
            access="write",
            namespace="main",
            grant_eligible=True,
            grant_profiles=frozenset({"main"}),
            annotations={
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            server_injected_arguments=frozenset({"projectId"}),
            dispatcher_context_arguments=frozenset({"projectId"}),
        ),
    ]
