"""Main request-context and WorldView application operations."""
# Entity: Main Chat
# Relationship: Exposes one authenticated external entry that reuses the saved Main Card's existing conversation, Run, IDF, session, and orange-roster execution path.

# Entity: WorldView
# Relationship: Defines the authenticated Main capability control and saved WorldView Card action surface with explicit grant boundaries.

from __future__ import annotations

import asyncio
import json
from typing import Any
from uuid import uuid4

from app import mcp_auth
from app.backend_operation_transport import (
    WORLDVIEW_ACTION_HTTP_TIMEOUT_SECONDS,
    post_backend_text,
    post_backend_text_sync,
)
from app.python_models.graph_reference_contracts import grounded_data_anchors_schema
from app.python_models.operation_definition import OperationDefinition
from mcp.types import TextContent


WORLDVIEW_ACTION_ROUTE = "/api/worldview/internal/actions"
MAIN_SESSION_CHAT_ROUTE = "/api/main/session/chat"
MAIN_SUBMIT_HTTP_TIMEOUT_SECONDS = 540.0


def _main_session_events(raw: str) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    for block in str(raw or "").replace("\r\n", "\n").split("\n\n"):
        event_name = ""
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event_name = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        if not event_name or not data_lines:
            continue
        try:
            payload = json.loads("\n".join(data_lines))
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            events.append((event_name, payload))
    return events


def _main_submit_result(raw: str) -> dict[str, Any]:
    text = str(raw or "").strip()
    if not text:
        return {"ok": False, "error": "main_submit_response_empty"}
    try:
        direct = json.loads(text)
    except json.JSONDecodeError:
        direct = None
    if isinstance(direct, dict):
        return direct

    events = _main_session_events(text)
    run_ids = {
        str(payload.get("runId") or "").strip()
        for _, payload in events
        if str(payload.get("runId") or "").strip()
    }
    if len(run_ids) != 1:
        return {"ok": False, "error": "main_submit_run_identity_invalid"}
    run_id = next(iter(run_ids))
    error = next((payload for name, payload in events if name == "error"), None)
    end = next((payload for name, payload in reversed(events) if name == "end"), None)
    done = next((payload for name, payload in reversed(events) if name == "done"), None)
    if error is not None:
        return {
            "ok": False,
            "runId": run_id,
            "error": str(error.get("code") or error.get("message") or "main_submit_failed"),
            "errorMessage": str(error.get("message") or ""),
            "completionObserved": False,
            "streamEnded": end is not None,
        }
    if done is None or end is None:
        return {
            "ok": False,
            "runId": run_id,
            "error": "main_submit_completion_missing",
            "completionObserved": done is not None,
            "streamEnded": end is not None,
        }
    state = str(done.get("state") or "completed").strip()
    result = {
        "ok": state == "completed",
        "runId": run_id,
        "state": state,
        "cardId": str(done.get("cardId") or end.get("cardId") or ""),
        "participant": done.get("participant"),
        "requestedParticipant": end.get("requestedParticipant"),
        "result": str(done.get("fullText") or ""),
        "completionObserved": True,
        "streamEnded": True,
        "toolEvents": sum(name in {"tool_start", "tool_result"} for name, _ in events),
    }
    if result["ok"] is not True:
        result["error"] = "main_submit_cancelled"
    return result


async def main_submit(
    *, input: str, projectId: str, deckId: str, _callerCardId: str,
    dataAnchors: list[Any] | None = None,
) -> dict[str, Any]:
    identity = mcp_auth.authenticated_external_identity()
    if identity is None:
        return {"ok": False, "error": "main_external_identity_unavailable"}
    message = str(input or "")
    if not message.strip():
        return {"ok": False, "error": "main_submit_input_required"}
    raw = await asyncio.to_thread(
        post_backend_text_sync,
        MAIN_SESSION_CHAT_ROUTE,
        {
            "projectId": projectId,
            "deckId": deckId,
            "message": message,
            "clientMessageId": f"msg_{uuid4()}",
            "clientReplyMessageId": f"msg_{uuid4()}",
            "dataAnchors": list(dataAnchors or []),
            "externalIssuer": identity["issuer"],
            "externalSubject": identity["subject"],
            "expectedMainCardId": _callerCardId,
        },
        timeout_seconds=MAIN_SUBMIT_HTTP_TIMEOUT_SECONDS,
        require_internal_secret=True,
    )
    return _main_submit_result(raw)


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


async def worldview_action(
    *, projectId: str, deckId: str, parentRunId: str,
    _callerCardId: str, name: str, arguments: dict[str, Any],
) -> list[TextContent]:
    if not all((projectId, deckId, parentRunId, _callerCardId)):
        return [TextContent(type="text", text=json.dumps({
            "ok": False, "error": "worldview_card_run_context_required",
        }))]
    return await post_backend_text(
        WORLDVIEW_ACTION_ROUTE,
        {
            "projectId": projectId,
            "deckId": deckId,
            "cardId": _callerCardId,
            "parentRunId": parentRunId,
            "name": name,
            "arguments": arguments if isinstance(arguments, dict) else {},
        },
        timeout_seconds=WORLDVIEW_ACTION_HTTP_TIMEOUT_SECONDS,
        require_internal_secret=True,
    )


def main_worldview_operation_definitions(
    external: frozenset[str],
    internal: frozenset[str],
) -> list[OperationDefinition]:
    return [
        OperationDefinition(
            canonical_id="main.submit",
            title="Send work through saved Main",
            description=(
                "Submit one bounded mission to the authenticated Project's unique saved Main "
                "Card and wait for its actual completed result. Main preserves its saved Run, "
                "IDF, Hermes session, and exact orange Card roster; a leading @Card may address "
                "only a currently authorized saved target. No caller-selected Project, Card, "
                "profile, conversation, or Run identity is accepted."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "input": {"type": "string", "minLength": 1, "maxLength": 120000},
                    "dataAnchors": grounded_data_anchors_schema(),
                },
                "required": ["input"],
                "additionalProperties": False,
            },
            handler=main_submit,
            available=True,
            publishers=external,
            access="write",
            namespace="main",
            grant_eligible=False,
            external_entry=True,
            annotations={
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": False,
            },
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId",
            }),
        ),
        OperationDefinition(
            canonical_id="main.context",
            title="Read Main request context",
            description=(
                "Read the compact server-owned Main entry context for this authenticated "
                "Main request: project, deck, conversation, parent run, and saved "
                "Main-card identities, plus the exact served catalog/process/source identity. "
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
        OperationDefinition(
            canonical_id="worldview.action",
            title="Run a WorldView action",
            description=(
                "Saved WorldView Hermes Card only: execute one existing God's Eye action "
                "against the currently mounted WorldView in this Project. Examples: "
                "get_current_view_state, get_entity_context, track_entity, "
                "focus_satellites, set_layer_visibility, zoom_to_globe. The current "
                "Project source OFF ceiling is enforced; an absent or ambiguous mount "
                "fails closed. set_layer_visibility changes the shared Project choice "
                "and is only for an explicit request in the current user turn to change "
                "that layer; never enable a layer for passive scene questions or analysis. "
                "Returns the real action readback, not an inferred success. "
                "focus_satellites takes exactly {noradIds: [positive safe integer]} with "
                "at most 50 exact NORAD IDs; [] clears transient agent focus. Establish "
                "bounded IDs from existing context before calling it."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "enum": [
                        "get_current_view_state", "get_entity_context", "zoom_to_globe",
                        "track_entity", "stop_tracking", "focus_satellites",
                        "set_layer_visibility",
                    ]},
                    "arguments": {"type": "object", "additionalProperties": True},
                },
                "required": ["name", "arguments"],
                "additionalProperties": False,
            },
            handler=worldview_action,
            available=True,
            publishers=internal,
            access="write",
            namespace="worldview",
            grant_eligible=True,
            annotations={
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": False,
            },
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "parentRunId", "_callerCardId",
            }),
        ),
    ]
