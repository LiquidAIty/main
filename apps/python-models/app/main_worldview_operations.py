"""Main request-context and WorldView application operations."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: WorldView
# Relationship: Defines the authenticated Main capability control and saved WorldView Card action surface with explicit grant boundaries.

from __future__ import annotations

import asyncio
import json
from typing import Any
from app.python_models.operation_definition import OperationDefinition
from mcp.types import TextContent

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
