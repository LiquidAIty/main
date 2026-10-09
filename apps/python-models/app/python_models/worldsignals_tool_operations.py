"""WorldSignals package handlers and operation definitions."""

from __future__ import annotations

import asyncio
from typing import Any

from app.python_models.operation_definition import OperationDefinition
from app.python_models.worldsignals_client import (
    collect_worldsignals_signal_package,
    worldsignals_batch,
    worldsignals_capabilities,
    worldsignals_command,
    worldsignals_poll,
    worldsignals_stream_events,
)

async def worldsignals_package_tool(
    command: str,
    reason: str,
    arguments: dict[str, Any] | None = None,
    domains: list[str] | None = None,
    sourceRefs: list[str] | None = None,
    maxAgeSeconds: int | None = None,
    limit: int = 25,
    *,
    projectId: str,
    deckId: str,
    _sourceCardId: str,
    _sourceRunId: str,
) -> dict[str, Any]:
    """Collect one scoped read-only WorldSignals evidence package."""

    if not all((projectId, deckId, _sourceCardId, _sourceRunId)):
        raise ValueError("worldsignals_package_card_context_required")
    package = await asyncio.to_thread(
        collect_worldsignals_signal_package,
        command=command,
        arguments=arguments or {},
        project_id=projectId,
        deck_id=deckId,
        requesting_card_id=_sourceCardId,
        requesting_run_id=_sourceRunId,
        reason=reason,
        producer_card_id=_sourceCardId,
        producer_run_id=_sourceRunId,
        domains=[str(value) for value in domains or []],
        source_refs=[str(value) for value in sourceRefs or []],
        max_age_seconds=maxAgeSeconds,
        limit=limit,
    )
    return package.model_dump(mode="json")
def _annotations(
    *, read_only: bool, destructive: bool, idempotent: bool, open_world: bool,
) -> dict[str, bool]:
    return {
        "readOnlyHint": read_only,
        "destructiveHint": destructive,
        "idempotentHint": idempotent,
        "openWorldHint": open_world,
    }
def worldsignals_tool_operation_definitions() -> list[OperationDefinition]:
    internal = frozenset({"internal-plugin"})
    read_open = _annotations(
        read_only=True, destructive=False, idempotent=True, open_world=True,
    )
    return [
        OperationDefinition(
            canonical_id="worldsignals.capabilities",
            title="WorldSignals capabilities",
            description=(
                "Read a bounded live WorldSignals capability/command view. Filter by domain, "
                "exact command, keyword, or read/write operation class; an exact command match "
                "returns that command's current parameter schema."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "domain": {"type": "string"},
                    "command": {"type": "string"},
                    "keyword": {"type": "string"},
                    "operation_class": {"type": "string", "enum": ["read", "write"]},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 25},
                },
                "required": [],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=worldsignals_capabilities,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
        ),
        OperationDefinition(
            canonical_id="worldsignals.command",
            title="Run a WorldSignals command",
            description="Run one real command from the WorldSignals command manifest.",
            parameters_schema={
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "arguments": {"type": "object"},
                },
                "required": ["command"],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=worldsignals_command,
            available=True,
            publishers=internal,
            access="write",
            namespace="python",
            external_source_id="python_runtime",
            annotations=_annotations(
                read_only=False, destructive=True, idempotent=False, open_world=True,
            ),
        ),
        OperationDefinition(
            canonical_id="worldsignals.batch",
            title="Run WorldSignals commands",
            description="Run up to twenty real WorldSignals commands through its batch channel.",
            parameters_schema={
                "type": "object",
                "properties": {
                    "commands": {
                        "type": "array",
                        "maxItems": 20,
                        "items": {
                            "type": "object",
                            "properties": {
                                "cmd": {"type": "string", "minLength": 1},
                                "args": {"type": "object"},
                            },
                            "required": ["cmd"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["commands"],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=worldsignals_batch,
            available=True,
            publishers=internal,
            access="write",
            namespace="python",
            external_source_id="python_runtime",
            annotations=_annotations(
                read_only=False, destructive=True, idempotent=False, open_world=True,
            ),
        ),
        OperationDefinition(
            canonical_id="worldsignals.poll",
            title="Poll WorldSignals results",
            description="Destructively read and consume completed command results and pending WorldSignals tasks.",
            parameters_schema={
                "type": "object", "properties": {}, "required": [],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=worldsignals_poll,
            available=True,
            publishers=internal,
            access="write",
            namespace="python",
            external_source_id="python_runtime",
            annotations=_annotations(
                read_only=False, destructive=True, idempotent=False, open_world=True,
            ),
        ),
        OperationDefinition(
            canonical_id="worldsignals.stream_events",
            title="Stream WorldSignals events",
            description="Read a bounded set of real-time events from the WorldSignals SSE channel.",
            parameters_schema={
                "type": "object",
                "properties": {
                    "max_events": {"type": "integer", "minimum": 1, "maximum": 20, "default": 1},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 30, "default": 15},
                },
                "required": [],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=worldsignals_stream_events,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
        ),
        OperationDefinition(
            canonical_id="worldsignals.package",
            title="Collect a WorldSignals evidence package",
            description=(
                "Run one live WorldSignals command only when its manifest classifies it "
                "as read-only, then return one provenance-bound signal.package.v1 envelope. "
                "Project, deck, Card, and Run scope are injected by the authenticated runtime."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "command": {"type": "string", "minLength": 1},
                    "reason": {"type": "string", "minLength": 1, "maxLength": 4000},
                    "arguments": {"type": "object"},
                    "domains": {"type": "array", "maxItems": 16, "items": {"type": "string", "minLength": 1}},
                    "sourceRefs": {"type": "array", "maxItems": 32, "items": {"type": "string", "minLength": 1}},
                    "maxAgeSeconds": {"type": ["integer", "null"], "minimum": 1, "maximum": 2592000},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
                },
                "required": ["command", "reason"],
                "additionalProperties": False,
            },
            output_schema={
                "type": "object",
                "properties": {
                    "schemaVersion": {"const": "signal.package.v1"},
                    "packageId": {"type": "string"},
                    "query": {"type": "object"},
                    "candidates": {"type": "array", "maxItems": 100},
                },
                "required": ["schemaVersion", "packageId", "query", "candidates"],
            },
            handler=worldsignals_package_tool,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_sourceCardId", "_sourceRunId",
            }),
        ),
    ]
