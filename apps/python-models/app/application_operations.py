"""Canonical definitions and handlers for application-owned operations."""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from app.application_operation_handlers import (
    agentgraph_inspect,
    canvas_inspect_operation,
    canvas_upsert_wire_operation,
    card_create_operation,
    card_update_configuration_operation,
)
from app.python_models.operation_definition import OperationDefinition
from app.python_models.graph_reference_contracts import DATA_ANCHOR_ID_FIELDS
from app.saved_canvas_tools import saved_canvas_operation_schema
from app.saved_card_tools import (
    saved_card_operation_schema,
)
from mcp.types import CallToolResult, TextContent


BACKEND = os.environ.get("MAIN_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")
PYTHON_RAILS = os.environ.get(
    "PYTHON_RAILS_URL", "http://127.0.0.1:8003"
).rstrip("/")
_MCP_CALL_TIMEOUT_SECONDS = 30.0
_SPECIALIST_CARD_HTTP_TIMEOUT_SECONDS = 540.0


def _grounded_data_anchors_schema() -> dict[str, Any]:
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


def _backend_bridge_timeout_seconds(path: str) -> float:
    return 40.0 if path == "worldview_action" else _MCP_CALL_TIMEOUT_SECONDS


_BACKEND_ROUTES = {
    "saved_specialist_card": "/api/saved-specialists/invoke",
    "worldview_action": "/api/worldview/internal/actions",
}


def _bridge_sync(path: str, payload: dict[str, Any]) -> str:
    secret = os.environ.get("LIQUIDAITY_INTERNAL_MCP_SECRET", "").strip()
    headers = {"Content-Type": "application/json"}
    if path == "worldview_action" and len(secret) < 32:
        raise RuntimeError("internal_mcp_secret_missing")
    if secret:
        headers["X-LiquidAIty-Internal-MCP-Secret"] = secret
    request = Request(
        f"{BACKEND}{_BACKEND_ROUTES[path]}",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(
            request,
            timeout=_backend_bridge_timeout_seconds(path),
        ) as response:  # noqa: S310 — loopback backend only
            return response.read().decode("utf-8")
    except HTTPError as error:
        try:
            body = error.read().decode("utf-8")
        except Exception:
            body = ""
        return body or json.dumps({
            "ok": False, "error": f"backend_http_{error.code}",
        })
    except URLError as error:
        return json.dumps({
            "ok": False, "error": f"backend_unreachable: {error.reason}",
        })


def _thinkgraph_via_python_rails_sync(
    name: str,
    project_id: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    request = Request(
        f"{PYTHON_RAILS}/thinkgraph/operation",
        data=json.dumps({
            "projectId": project_id,
            "operation": str(name or "").strip(),
            "arguments": arguments,
        }).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=190.0) as response:  # noqa: S310
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        try:
            body = json.loads(error.read().decode("utf-8"))
        except Exception:
            body = {}
        raise RuntimeError(
            str(body.get("detail") or f"thinkgraph_python_rails_http_{error.code}")
        ) from error
    except URLError as error:
        raise RuntimeError(
            f"thinkgraph_python_rails_unreachable:{error.reason}"
        ) from error
    if not isinstance(result, dict):
        raise RuntimeError("thinkgraph_python_rails_result_invalid")
    return result


async def _bridge(path: str, payload: dict[str, Any]) -> list[TextContent]:
    text = await asyncio.to_thread(_bridge_sync, path, payload)
    return [TextContent(type="text", text=text)]


async def _saved_specialist_card_bridge(payload: dict[str, Any]) -> dict[str, Any]:
    secret = os.environ.get("LIQUIDAITY_INTERNAL_MCP_SECRET", "").strip()
    if len(secret) < 32:
        raise RuntimeError("internal_mcp_secret_missing")
    import httpx2

    async with httpx2.AsyncClient(
        headers={
            "Content-Type": "application/json",
            "X-LiquidAIty-Internal-MCP-Secret": secret,
        },
        timeout=httpx2.Timeout(_SPECIALIST_CARD_HTTP_TIMEOUT_SECONDS),
        trust_env=False,
    ) as client:
        response = await client.post(
            f"{BACKEND}{_BACKEND_ROUTES['saved_specialist_card']}",
            json=payload,
        )
        try:
            result = response.json()
        except (TypeError, ValueError) as error:
            raise RuntimeError("saved_specialist_backend_result_invalid") from error
    if not isinstance(result, dict):
        raise RuntimeError("saved_specialist_backend_result_invalid")
    if response.status_code >= 400 and not result.get("error"):
        return {
            "ok": False,
            "error": f"saved_specialist_backend_http_{response.status_code}",
        }
    return result


async def main_context(
    *, _mainContext: dict[str, Any] | None = None,
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
    return await _bridge("worldview_action", {
        "projectId": projectId,
        "deckId": deckId,
        "cardId": _callerCardId,
        "parentRunId": parentRunId,
        "name": name,
        "arguments": arguments if isinstance(arguments, dict) else {},
    })


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


async def run_mag_one(
    *, input: str, dataAnchors: list[Any] | None = None,
    projectId: str, deckId: str, conversationId: str,
    _callerCardId: str,
) -> CallToolResult:
    from app.python_models.card_invocation import resolve_magnetic_taskgraph_card
    from app.python_models.card_runs import begin_run, finish_run
    from app.python_models.saved_card_contract import CardDomainError
    from app.python_models.magnetic_taskgraph import (
        MagneticTaskGraphError,
        submit_magnetic_taskgraph,
    )

    run_id = f"req_{uuid4().hex[:16]}"
    run_prepared = False
    anchors = [
        {**anchor, "required": True} if isinstance(anchor, dict) else anchor
        for anchor in (dataAnchors or [])
    ]
    try:
        target = await asyncio.to_thread(
            resolve_magnetic_taskgraph_card, projectId, deckId,
        )
        prepared = await asyncio.to_thread(begin_run, {
            "projectId": target["projectId"],
            "deckId": target["deckId"],
            "cardId": target["cardId"],
            "senderCardId": _callerCardId,
            "runId": run_id,
            "correlationId": run_id,
            "acceptedAt": datetime.now(timezone.utc).isoformat(),
            "conversationId": conversationId or "main",
            "assignment": input,
            "dataAnchors": anchors,
            "discoveredTools": [],
            "discoveredToolCatalogState": "unavailable",
            "unavailableToolCatalogFamilies": [],
        })
        run_prepared = True
        execution = prepared.get("magneticTaskGraph")
        if not isinstance(execution, dict):
            raise MagneticTaskGraphError("magnetic_taskgraph_contract_missing")
        result = await asyncio.to_thread(submit_magnetic_taskgraph, execution)
    except (CardDomainError, MagneticTaskGraphError) as error:
        if run_prepared:
            try:
                await asyncio.to_thread(finish_run, {
                    "runId": run_id,
                    "state": "failed",
                    "errorCode": "magnetic_taskgraph_failed",
                    "errorSummary": str(error),
                })
            except CardDomainError:
                pass
        result = {"ok": False, "error": str(error)}
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(result, ensure_ascii=False))],
        structuredContent=result,
        isError=result.get("ok") is False,
    )


def _annotations(
    *, read_only: bool, destructive: bool, idempotent: bool, open_world: bool,
) -> dict[str, bool]:
    return {
        "readOnlyHint": read_only,
        "destructiveHint": destructive,
        "idempotentHint": idempotent,
        "openWorldHint": open_world,
    }


def _context_and_worldview_operation_definitions(
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
            annotations=_annotations(read_only=True, destructive=False, idempotent=True, open_world=False),
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
                    "capabilityId": {"type": "string", "pattern": r"^[a-z0-9][a-z0-9._:-]{0,127}$"},
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
            annotations=_annotations(read_only=False, destructive=False, idempotent=True, open_world=False),
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
            annotations=_annotations(read_only=False, destructive=False, idempotent=False, open_world=False),
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "parentRunId", "_callerCardId",
            }),
            required_caller_runtime=("hermes", "delegate"),
        ),
    ]


def _agent_execution_operation_definitions(
    external: frozenset[str],
    internal: frozenset[str],
) -> list[OperationDefinition]:
    return [
        OperationDefinition(
            canonical_id="agentgraph.inspect",
            title="Inspect AgentGraph",
            description=(
                "Read a bounded, authenticated Project-scoped view of current PostgreSQL/AGE "
                "Card relationships plus available run, lineage, tool, and artifact telemetry. "
                "runId selects one exact Run; otherwise the authenticated conversation is "
                "selected. cardId filters its direct Runs. projectWide reads across the "
                "authenticated Project, before limits. No prompt or model input is returned."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "runId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
                    "projectWide": {"type": "boolean", "default": False},
                },
                "required": [],
            },
            handler=agentgraph_inspect,
            available=True,
            publishers=external,
            access="read",
            namespace="main",
            annotations=_annotations(read_only=True, destructive=False, idempotent=True, open_world=False),
            dispatcher_context_arguments=frozenset({"projectId", "deckId", "conversationId"}),
        ),
        OperationDefinition(
            canonical_id="run_mag_one",
            title="Mag One",
            description=(
                "Main only: submit one explicitly approved mission and deliberately selected "
                "graph references to the saved Magnetic Card's existing Hermes Mag One execution. "
                "The authenticated runtime supplies Project, Card, conversation, and Run authority; "
                "the saved blue topology supplies the exact worker ceiling. This starts real work "
                "and returns its actual accepted execution state."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "input": {"type": "string", "minLength": 1},
                    "dataAnchors": _grounded_data_anchors_schema(),
                },
                "required": ["input"],
                "additionalProperties": False,
            },
            handler=run_mag_one,
            available=True,
            publishers=external,
            access="write",
            namespace="main",
            annotations=_annotations(read_only=False, destructive=False, idempotent=False, open_world=False),
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "conversationId", "_callerCardId",
            }),
            required_caller_runtime=("hermes", "main"),
        ),
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
                    "dataAnchors": _grounded_data_anchors_schema(),
                },
                "required": ["request"],
                "additionalProperties": False,
            },
            handler=thinkgraph_reason,
            available=True,
            publishers=internal,
            access="write",
            namespace="main",
            annotations=_annotations(read_only=False, destructive=False, idempotent=False, open_world=False),
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
                    "dataAnchors": _grounded_data_anchors_schema(),
                },
                "required": ["request"],
                "additionalProperties": False,
            },
            handler=knowgraph_research,
            available=True,
            publishers=internal,
            access="write",
            namespace="main",
            annotations=_annotations(read_only=False, destructive=False, idempotent=False, open_world=True),
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "conversationId", "_sourceCardId", "_sourceRunId",
                "_principalKind",
            }),
        ),
    ]


def _card_editor_operation_definitions(
    external: frozenset[str],
) -> list[OperationDefinition]:
    return [
        OperationDefinition(
            canonical_id="canvas.inspect",
            title="Inspect the saved Canvas",
            description=(
                "Read the saved deck; optionally inspect one exact Card with its editable "
                "configuration, revisions and current IDD/catalog choices."
            ),
            parameters_schema=saved_canvas_operation_schema("canvas.inspect"),
            handler=canvas_inspect_operation,
            available=True,
            publishers=external,
            access="read",
            namespace="main",
            annotations=_annotations(read_only=True, destructive=False, idempotent=True, open_world=False),
            server_injected_arguments=frozenset({"projectId", "deckId"}),
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId",
            }),
        ),
        OperationDefinition(
            canonical_id="card.create",
            title="Create a saved Card",
            description=(
                "Create one saved Card with explicit configuration and expected deck revision. "
                "Honor its requested Hermes profile. Does not run the Card or create wires."
            ),
            parameters_schema=saved_card_operation_schema("card.create"),
            handler=card_create_operation,
            available=True,
            publishers=external,
            access="write",
            namespace="main",
            annotations=_annotations(read_only=False, destructive=False, idempotent=False, open_world=False),
            server_injected_arguments=frozenset({"projectId", "deckId"}),
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId",
            }),
        ),
        OperationDefinition(
            canonical_id="card.update_configuration",
            title="Update saved Card configuration",
            description=(
                "Update one exact saved Card using current deck and Card revision IDs. "
                "Preserve unspecified fields. Does not run the Card."
            ),
            parameters_schema=saved_card_operation_schema("card.update_configuration"),
            handler=card_update_configuration_operation,
            available=True,
            publishers=external,
            access="write",
            namespace="main",
            annotations=_annotations(read_only=False, destructive=True, idempotent=True, open_world=False),
            server_injected_arguments=frozenset({"projectId", "deckId"}),
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId", "_authenticatedUserEdit",
            }),
        ),
        OperationDefinition(
            canonical_id="canvas.upsert_wire",
            title="Change a saved Canvas wire",
            description=(
                "Create/update/remove ONE saved canvas wire. Supported wire types only: "
                "'flow' and 'magentic_option'. Blue means worker availability to Magnetic and "
                "endpoint order has no runtime meaning. A wire is persisted visible "
                "configuration — it never runs agents."
            ),
            parameters_schema=saved_canvas_operation_schema("canvas.upsert_wire"),
            handler=canvas_upsert_wire_operation,
            available=True,
            publishers=external,
            access="write",
            namespace="main",
            annotations=_annotations(read_only=False, destructive=True, idempotent=True, open_world=False),
            server_injected_arguments=frozenset({"projectId", "deckId"}),
            dispatcher_context_arguments=frozenset({"projectId", "deckId"}),
        ),
    ]


def application_operation_definitions() -> list[OperationDefinition]:
    """Return direct definitions for the application MCP surface."""

    external = frozenset({"internal-plugin", "external-mcp"})
    internal = frozenset({"internal-plugin"})
    return [
        *_context_and_worldview_operation_definitions(external, internal),
        *_agent_execution_operation_definitions(external, internal),
        *_card_editor_operation_definitions(external),
    ]
