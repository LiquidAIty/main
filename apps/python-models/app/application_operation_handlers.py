"""Callable handlers for application-owned tool definitions."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Tool Catalog
# Relationship: This file adapts code-owned feature handlers into the asynchronous callable functions referenced by their canonical operation definitions.
#
# Entity: AgentGraph
# Relationship: This file validates Project and deck scope before dispatching the fixed AgentGraph inspection operation.
#
# Entity: Saved Cards
# Relationship: This file dispatches explicit saved Card creation and configuration updates while preserving the authenticated caller Card identity.
#
# Entity: Card Topology
# Relationship: This file dispatches exact topology inspection and single-connection update operations to the saved canvas owner.

from __future__ import annotations

import asyncio
from typing import Any

from app.application_tool_error import ApplicationToolError


def _require(arguments: dict[str, Any], *keys: str) -> None:
    for key in keys:
        if not str(arguments.get(key) or "").strip():
            raise ApplicationToolError(f"{key}_required")


async def agentgraph_inspect(**arguments: Any) -> dict[str, Any]:
    _require(arguments, "projectId", "deckId")
    from app.python_models.agentgraph_inspection import inspect_agentgraph
    from app.python_models.saved_card_contract import CardDomainError

    try:
        return await asyncio.to_thread(inspect_agentgraph, arguments)
    except CardDomainError as error:
        raise ApplicationToolError(str(error)) from error


async def canvas_inspect_operation(**arguments: Any) -> Any:
    from app.saved_canvas_tools import canvas_inspect

    return await canvas_inspect(arguments)


async def card_create_operation(**arguments: Any) -> Any:
    from app.saved_card_create import card_create

    return await card_create(arguments)


async def card_update_configuration_operation(**arguments: Any) -> Any:
    from app.saved_card_update import card_update_configuration

    caller_card_id = str(arguments.pop("_callerCardId", "") or "")
    return await card_update_configuration(
        arguments,
        caller_card_id=caller_card_id,
    )


async def canvas_upsert_wire_operation(**arguments: Any) -> Any:
    from app.saved_canvas_tools import canvas_upsert_wire

    return await canvas_upsert_wire(arguments)
