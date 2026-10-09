"""Saved ThinkGraph and KnowGraph specialist operations."""

from __future__ import annotations

import json
from typing import Any

from app.backend_operation_transport import (
    SPECIALIST_CARD_HTTP_TIMEOUT_SECONDS,
    post_backend_json,
)
from app.python_models.graph_reference_contracts import DATA_ANCHOR_ID_FIELDS
from app.python_models.operation_definition import OperationDefinition
from mcp.types import CallToolResult, TextContent


SAVED_SPECIALIST_ROUTE = "/api/saved-specialists/invoke"


def grounded_data_anchors_schema() -> dict[str, Any]:
    id_fields = {
        field: {"type": "string", "minLength": 1}
        for field in DATA_ANCHOR_ID_FIELDS
    }
    return {
        "type": "array",
        "minItems": 0,
        "maxItems": 16,
        "items": {
            "type": "object",
            "properties": {
                **id_fields,
                "reason": {"type": "string", "minLength": 1, "maxLength": 2000},
                "priority": {"type": "integer"},
                "boundedExpansion": {"type": "integer", "minimum": 0, "maximum": 3},
                "resultLimit": {"type": "integer", "minimum": 1, "maximum": 24},
            },
            "required": ["reason", "priority", "boundedExpansion", "resultLimit"],
            "oneOf": [{"required": [field]} for field in id_fields],
            "additionalProperties": False,
        },
    }


async def _saved_specialist_card_bridge(payload: dict[str, Any]) -> dict[str, Any]:
    return await post_backend_json(
        SAVED_SPECIALIST_ROUTE,
        payload,
        timeout_seconds=SPECIALIST_CARD_HTTP_TIMEOUT_SECONDS,
        invalid_result_error="saved_specialist_backend_result_invalid",
        http_error_prefix="saved_specialist_backend_http",
    )


async def _saved_specialist_operation(
    operation: str,
    *, request: str, dataAnchors: list[Any] | None = None,
    projectId: str, deckId: str, conversationId: str,
    _sourceCardId: str, _sourceRunId: str, _principalKind: str = "",
) -> CallToolResult:
    if _principalKind != "card-runtime":
        payload = {"ok": False, "error": "authenticated_card_context_required"}
        return CallToolResult(
            content=[TextContent(type="text", text=json.dumps(payload))],
            structuredContent=payload,
            isError=True,
        )
    result = await _saved_specialist_card_bridge({
        "operation": operation,
        "request": request,
        "dataAnchors": dataAnchors if isinstance(dataAnchors, list) else [],
        "projectId": projectId,
        "deckId": deckId,
        "conversationId": conversationId,
        "sourceCardId": _sourceCardId,
        "sourceRunId": _sourceRunId,
    })
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(result, ensure_ascii=False))],
        structuredContent=result,
        isError=result.get("ok") is False or bool(result.get("error")),
    )


async def thinkgraph_reason(**arguments: Any) -> CallToolResult:
    return await _saved_specialist_operation("thinkgraph.reason", **arguments)


async def knowgraph_research(**arguments: Any) -> CallToolResult:
    return await _saved_specialist_operation("knowgraph.research", **arguments)


def saved_graph_specialist_operation_definitions(
    internal: frozenset[str],
) -> list[OperationDefinition]:
    data_anchors_schema = grounded_data_anchors_schema()
    return [
        OperationDefinition(
            canonical_id="thinkgraph.reason",
            title="Reason with ThinkGraph",
            description=(
                "Ask the one enabled saved ThinkGraph Card to reason over bounded project "
                "history through its normal saved Hermes Run. The authenticated Card runtime "
                "supplies source and Project identity; the caller supplies only the request "
                "and optional exact data anchors. Returns the actual target result and Run IDs."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "request": {"type": "string", "minLength": 1, "maxLength": 20000},
                    "dataAnchors": data_anchors_schema,
                },
                "required": ["request"],
                "additionalProperties": False,
            },
            handler=thinkgraph_reason,
            available=True,
            publishers=internal,
            access="write",
            namespace="main",
            annotations={
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": False,
            },
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "conversationId", "_sourceCardId", "_sourceRunId",
                "_principalKind",
            }),
        ),
        OperationDefinition(
            canonical_id="knowgraph.research",
            title="Research with KnowGraph",
            description=(
                "Ask the one enabled saved KnowGraph Card to perform bounded sourced research "
                "through its normal saved Hermes Run. The authenticated Card runtime supplies "
                "source and Project identity; the caller supplies only the request and optional "
                "exact data anchors. Returns the actual target result and Run IDs."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "request": {"type": "string", "minLength": 1, "maxLength": 20000},
                    "dataAnchors": grounded_data_anchors_schema(),
                },
                "required": ["request"],
                "additionalProperties": False,
            },
            handler=knowgraph_research,
            available=True,
            publishers=internal,
            access="write",
            namespace="main",
            annotations={
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": True,
            },
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "conversationId", "_sourceCardId", "_sourceRunId",
                "_principalKind",
            }),
        ),
    ]
