"""Main request-context and WorldView application operations."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from app.backend_operation_transport import (
    WORLDVIEW_ACTION_HTTP_TIMEOUT_SECONDS,
    post_backend_text,
)
from app.python_models.operation_definition import OperationDefinition
from mcp.types import TextContent


WORLDVIEW_ACTION_ROUTE = "/api/worldview/internal/actions"


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
            annotations={
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            server_injected_arguments=frozenset({"projectId"}),
            dispatcher_context_arguments=frozenset({"projectId"}),
            required_caller_runtime=("hermes", "main"),
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
            annotations={
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": False,
            },
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "parentRunId", "_callerCardId",
            }),
            required_caller_runtime=("hermes", "delegate"),
        ),
    ]
