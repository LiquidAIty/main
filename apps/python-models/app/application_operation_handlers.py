"""Callable handlers for application-owned tool definitions."""

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
# Relationship: This file dispatches exact topology inspection and single-connection updates with the authenticated caller Card identity preserved.

from __future__ import annotations

# Entity: CodeGraph
# Relationship: Forwards authenticated Builder category selections and declared file references to the existing active Project graph view without editing source or graph records.

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


async def codegraph_configure(*, projectId: str, enable: list[str] | None = None,
                              disable: list[str] | None = None, selectionId: str | None = None) -> dict[str, Any]:
    """Change only category visibility in an already-open Project graph view."""
    from app import mcp_auth
    from app.backend_operation_transport import request_backend_json

    principal = mcp_auth.internal_mcp_principal() or {}
    if principal.get('projectId') != projectId or not principal.get('ownerUserId'):
        raise ApplicationToolError('graph_view_project_scope_required')
    payload = {
        'projectId': projectId, 'ownerUserId': principal['ownerUserId'],
        'enable': enable or [], 'disable': disable or [],
        'selectionId': selectionId,
    }
    result = await asyncio.to_thread(request_backend_json, 'POST', '/api/mcp/code-categories',
                                     payload, require_internal_secret=True)
    if not enable and not disable and result.get('active') and not result.get('categories'):
        from app.python_models.codegraph_reference_reads import read_codegraph_view
        source = await asyncio.to_thread(read_codegraph_view, {
            'projectId': projectId, 'deckId': principal['deckId'], 'cardId': 'builder', 'mode': 'projection',
        })
        if not source.get('projection'):
            raise ApplicationToolError('codegraph_categories_unavailable')
        payload['categories'] = [{'id': node['id'], 'label': node['label'],
                                  'memberFilePaths': node['properties'].get('memberFilePaths', [])}
                                 for node in source['projection']['nodes']
                                 if node.get('properties', {}).get('recordKind') == 'feature']
        return await asyncio.to_thread(request_backend_json, 'POST', '/api/mcp/code-categories',
                                       payload, require_internal_secret=True)
    return result


async def card_create_operation(**arguments: Any) -> Any:
    from app.saved_card_create import card_create

    caller_card_id = str(arguments.pop("_callerCardId", "") or "")
    return await card_create(arguments, caller_card_id=caller_card_id)


async def card_update_configuration_operation(**arguments: Any) -> Any:
    from app.saved_card_update import card_update_configuration

    caller_card_id = str(arguments.pop("_callerCardId", "") or "")
    return await card_update_configuration(
        arguments,
        caller_card_id=caller_card_id,
    )


async def canvas_upsert_wire_operation(**arguments: Any) -> Any:
    from app.saved_canvas_tools import canvas_upsert_wire

    caller_card_id = str(arguments.pop("_callerCardId", "") or "")
    return await canvas_upsert_wire(arguments, caller_card_id=caller_card_id)
