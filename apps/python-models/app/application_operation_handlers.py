"""Callable handlers for application-owned tool definitions."""

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

    caller_card_id = str(arguments.pop("_callerCardId", "") or "")
    return await canvas_inspect(arguments, caller_card_id=caller_card_id)


async def card_create_operation(**arguments: Any) -> Any:
    from app.saved_card_create import card_create

    caller_card_id = str(arguments.pop("_callerCardId", "") or "")
    return await card_create(arguments, caller_card_id=caller_card_id)


async def card_update_configuration_operation(**arguments: Any) -> Any:
    from app.saved_card_update import card_update_configuration

    caller_card_id = str(arguments.pop("_callerCardId", "") or "")
    authenticated_user_edit = arguments.pop("_authenticatedUserEdit", False) is True
    return await card_update_configuration(
        arguments,
        authenticated_user_edit=authenticated_user_edit,
        caller_card_id=caller_card_id,
    )


async def canvas_upsert_wire_operation(**arguments: Any) -> Any:
    from app.saved_canvas_tools import canvas_upsert_wire

    return await canvas_upsert_wire(arguments)
