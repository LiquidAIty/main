"""Canonical MCP request authorization, dispatch, timeout, and typed results."""

from __future__ import annotations

import asyncio
import inspect
import json
from typing import Any
from uuid import uuid4

from app import mcp_auth, mcp_catalog_runtime, mcp_observability, mcp_provider_operations
from app.application_tool_error import ApplicationToolError
from app.python_models.operation_definition import OperationDefinition, allowed_operation_keys
from app.python_models.tool_registry import operation_definition, required_tool_caller_runtime, tool_access
from mcp.types import CallToolResult, TextContent

MCP_CALL_TIMEOUT_SECONDS = 30.0
ENGRAPHIS_OPERATION_TIMEOUT_SECONDS = 120.0
MAG_ONE_COMPLETION_TIMEOUT_SECONDS = 570.0
SPECIALIST_CARD_TOOL_TIMEOUT_SECONDS = 570.0
def request_tool_is_allowed(
    name: str,
    definition: OperationDefinition | None = None,
) -> bool:
    access = definition.access if definition is not None else tool_access(name)
    principal = mcp_auth.internal_mcp_principal()
    if (
        mcp_provider_operations.is_provider_operation_name(name)
        and name not in mcp_catalog_runtime.published_mcp_tool_names()
    ):
        return False
    # The public host preserves the canonical unknown-tool error from dispatch.
    # An internal Card-scoped connection fails closed before dispatch because it
    # may call only operations present in the live registry and its exact grants.
    if access is None:
        return principal is None
    if principal is None:
        if not mcp_auth.OAUTH_ENFORCED:
            return True
        # Preserve the canonical unknown-tool result for names the registry has
        # never owned, but do not let a stale external client invoke a known
        # internal-only operation that is absent from this process's frozen
        # MCP publication catalog.
        return name in mcp_catalog_runtime.published_mcp_tool_names()
    kind = str(principal.get("kind") or "")
    if kind == "catalog-reader":
        return False
    if kind == "materializer-read":
        grants = mcp_auth.validated_principal_tool_names(
            principal.get("grantedTools")
        )
        return access == "read" and grants is not None and name in grants
    if kind != "card-runtime":
        return False
    grants = mcp_auth.validated_principal_tool_names(principal.get("grantedTools"))
    presented = mcp_auth.validated_principal_tool_names(principal.get("presentedTools"))
    return (
        grants is not None
        and presented is not None
        and name in grants
        and name in presented
    )
async def list_resources() -> list[Any]:
    mcp_observability.trace(
        "resources_list",
        mcp_method="resources/list",
        response_status=200,
        result_category="empty_catalog",
        completed=True,
        **mcp_auth.oauth_trace_fields(),
    )
    return []
SERVER_OWNED_ARGUMENTS = {
    "projectId",
    "deckId",
    "conversationId",
    "correlationId",
    "senderAgentId",
    "senderCardId",
    "parentRunId",
    "originatingAgentId",
    "originatingRunId",
    "_callerCardId",
    "_callerRuntimeKind",
    "_callerRuntimeMode",
    "_sourceCardId",
    "_sourceRunId",
    "_effectTargetCardId",
    "_effectTargetCardRevisionId",
    "_effectTargetDeckRevision",
    "_builderOperation",
    "_mainContext",
    "_catalogDiagnostics",
    "_authenticatedUserEdit",
    "_authenticatedProjectId",
    "_principalKind",
}
def enforce_tool_caller(
    name: str,
    args: dict[str, Any],
    *,
    authenticated_external: bool = False,
) -> str | None:
    expected = required_tool_caller_runtime(name)
    card_id = str(args.pop("_callerCardId", "") or "").strip()
    kind = str(args.pop("_callerRuntimeKind", "") or "").strip()
    mode = str(args.pop("_callerRuntimeMode", "") or "").strip()
    if authenticated_external and not kind and not mode:
        # The authenticated account MCP surface is the Main doorway. Internal
        # runtimes supply their exact saved runtime union instead.
        kind, mode = "hermes", "main"
    if expected is None:
        return None
    if not card_id or not kind or not mode:
        return "tool_caller_identity_unavailable"
    if {"kind": kind, "mode": mode} != expected:
        return (
            f"tool_caller_not_authorized: {name} requires "
            f"{expected['kind']}/{expected['mode']}"
        )
    return None


async def dispatch_tool(
    name: str,
    arguments: dict[str, Any],
) -> Any:
    context = mcp_auth.authenticated_main_context()
    principal = mcp_auth.internal_mcp_principal()
    if context is None and principal and principal.get("kind") == "materializer-read":
        # Pre-dispatch reads have real project/Card identity but no Run yet.
        # Keep their provider graph scope without fabricating runtime telemetry.
        context = {
            "projectId": principal["projectId"], "deckId": principal["deckId"],
            "mainCardId": principal["callerCardId"],
            "conversationId": principal.get("conversationId", ""),
        }
    if (
        mcp_provider_operations.is_provider_operation_name(name)
        and name not in mcp_catalog_runtime.published_mcp_tool_names()
    ):
        return [TextContent(type="text", text=json.dumps({
            "ok": False, "error": f"unknown_tool: {name}",
        }))]
    definition = operation_definition(name)
    if definition is None:
        return [TextContent(type="text", text=json.dumps({
            "ok": False, "error": f"unknown_tool: {name}",
        }))]
    if not request_tool_is_allowed(name, definition):
        raise PermissionError(f"tool_not_granted: {name}")
    allowed = allowed_operation_keys(definition)
    server_injected = definition.server_injected_arguments
    dispatcher_context = definition.dispatcher_context_arguments
    args = dict(arguments or {})
    supplied_identity = sorted(
        (SERVER_OWNED_ARGUMENTS | set(server_injected)) & args.keys()
    )
    if supplied_identity:
        return [TextContent(type="text", text=json.dumps({
            "ok": False,
            "error": "caller_identity_rejected: "
            + ",".join(supplied_identity),
        }))]
    required_runtime = required_tool_caller_runtime(name)
    if context is None and required_runtime is not None:
        surface = "main" if required_runtime.get("mode") == "main" else "card"
        return [TextContent(type="text", text=json.dumps({
            "ok": False,
            "error": f"authenticated_{surface}_context_required",
        }))]
    if context is not None:
        try:
            for field in ("projectId", "deckId", "conversationId"):
                if field in dispatcher_context:
                    if (name == "agentgraph.inspect" and field == "conversationId"
                            and (args.get("runId") or args.get("projectWide") is True)):
                        continue
                    args[field] = str(context[field])
            if "parentRunId" in dispatcher_context:
                args["parentRunId"] = str(context.get("parentRunId") or "")
            if "_sourceCardId" in dispatcher_context:
                args["_sourceCardId"] = str(context["mainCardId"])
            if "_sourceRunId" in dispatcher_context:
                args["_sourceRunId"] = str(context["parentRunId"])
            if "_callerCardId" in dispatcher_context:
                args["_callerCardId"] = str(context["mainCardId"])
            if "_authenticatedProjectId" in dispatcher_context:
                args["_authenticatedProjectId"] = str(context["projectId"])
            if "_principalKind" in dispatcher_context:
                args["_principalKind"] = str(context.get("principalKind") or "")
            if "_authenticatedUserEdit" in dispatcher_context:
                args["_authenticatedUserEdit"] = bool(
                    context.get("principalKind") is None and principal is None
                )
            if "_mainContext" in dispatcher_context:
                args["_mainContext"] = {
                    field: str(context[field]) for field in mcp_auth.MAIN_CONTEXT_FIELDS
                }
            if "_catalogDiagnostics" in dispatcher_context:
                args["_catalogDiagnostics"] = (
                    mcp_catalog_runtime.catalog_diagnostics()
                )
            if "senderAgentId" in allowed:
                args["senderAgentId"] = str(context["mainCardId"])
            if "correlationId" in allowed:
                args["correlationId"] = f"external-mcp:{uuid4()}"
            if required_runtime is not None:
                args["_callerCardId"] = str(context["mainCardId"])
                args["_callerRuntimeKind"] = str(
                    context.get("callerRuntimeKind") or "hermes"
                )
                args["_callerRuntimeMode"] = str(
                    context.get("callerRuntimeMode") or "main"
                )
            missing_injected = sorted(
                server_injected - args.keys()
                if definition.external_source_id != "graphiti"
                else frozenset()
            )
            if missing_injected:
                raise ValueError(
                    "server_injected_argument_unavailable:" + ",".join(missing_injected)
                )
        except (KeyError, RuntimeError, ValueError) as err:
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": str(err)}))]
    caller_card_id = str(args.get("_callerCardId", "") or "").strip()
    caller_error = enforce_tool_caller(
        name,
        args,
        authenticated_external=context is not None,
    )
    if caller_error:
        return [
            TextContent(
                type="text",
                text=json.dumps({"ok": False, "error": caller_error}),
            )
        ]
    if not caller_card_id and context is not None:
        caller_card_id = str(context.get("mainCardId") or "").strip()
    if "_callerCardId" in dispatcher_context:
        args["_callerCardId"] = caller_card_id
    extra = [k for k in args.keys() if k not in allowed]
    if extra:
        return [
            TextContent(
                type="text",
                text=json.dumps({"ok": False, "error": f"tool_arguments_rejected: {','.join(sorted(extra))}"}),
            )
        ]
    try:
        result = definition.handler(**args)
        if inspect.isawaitable(result):
            result = await result
    except ApplicationToolError as error:
        return [TextContent(type="text", text=json.dumps({
            "ok": False, "error": str(error),
        }))]
    if isinstance(result, CallToolResult):
        return result
    if isinstance(result, list):
        return result
    result_text = json.dumps(result, default=str, ensure_ascii=False)
    return CallToolResult(
        content=[TextContent(type="text", text=result_text)],
        structuredContent=result if isinstance(result, dict) else None,
        isError=(
            isinstance(result, dict)
            and (result.get("ok") is False or bool(result.get("error")))
        ),
    )


def mcp_tool_timeout_seconds(name: str) -> float:
    if name in {"thinkgraph.reason", "knowgraph.research"}:
        return SPECIALIST_CARD_TOOL_TIMEOUT_SECONDS
    if name == "engraphis_remember":
        # Semantic extraction and storage can exceed the ordinary read deadline.
        return 190.0
    if name.startswith("engraphis_"):
        # Engraphis semantic reads may cold-load the embedding/reranking stack.
        # Keep one bounded provider-family budget instead of per-tool exceptions.
        return ENGRAPHIS_OPERATION_TIMEOUT_SECONDS
    if name == "run_mag_one":
        return MAG_ONE_COMPLETION_TIMEOUT_SECONDS
    return MCP_CALL_TIMEOUT_SECONDS


async def execute_tool_request(
    name: str,
    arguments: dict[str, Any],
    *,
    transport: str,
) -> Any:
    tool_name = str(name or "").strip()
    trace_fields = {
        "tool_transport": transport,
        "tool_name": tool_name[:160],
        **(mcp_auth.oauth_trace_fields() if transport == "mcp" else {}),
    }
    mcp_observability.trace("tool_call_started", **trace_fields)
    try:
        result = await asyncio.wait_for(
            dispatch_tool(tool_name, arguments),
            timeout=mcp_tool_timeout_seconds(tool_name),
        )
        result_category = mcp_observability.tool_result_category(result)
        mcp_observability.trace(
            "tool_call_completed",
            **trace_fields,
            response_status=500 if result_category == "tool_error" else 200,
            result_category=result_category,
            completed=True,
        )
        if result_category == "tool_error" and isinstance(result, list):
            result = CallToolResult(content=result, isError=True)
        return result
    except Exception as error:
        failure = mcp_observability.typed_failure(
            error,
            dependency="mcp" if transport == "mcp" else "tool-runtime",
        )
        mcp_observability.trace(
            "tool_call_failed",
            **trace_fields,
            response_status=500,
            result_category="tool_error",
            exception_class=error.__class__.__name__,
            completed=True,
        )
        result = CallToolResult(
            content=[
                TextContent(
                    type="text",
                    text=json.dumps({
                        key: failure[key]
                        for key in (
                            "ok",
                            "error",
                            "failureCode",
                            "errorCategory",
                            "retryable",
                            "dependency",
                        )
                    }),
                )
            ],
            isError=True,
        )
        return result


async def call_tool(name: str, arguments: dict[str, Any]) -> Any:
    return await execute_tool_request(
        name,
        arguments,
        transport="mcp",
    )
