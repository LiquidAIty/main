"""Canonical MCP request authorization, dispatch, timeout, and typed results."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: MCP Host
# Relationship: This file dispatches one MCP request under a bounded timeout and returns protocol-declared outcomes without interpreting result prose.
# Entity: Tool Catalog
# Relationship: This file resolves only published operation definitions, enforces each request's exact grants, rejects caller-supplied server identity, and invokes the selected canonical operation.
# Entity: Authentication
# Relationship: This file resolves supplied native admission references through the trusted context owner, binds their saved authorization for one request, and injects authenticated Project, Card, Run, and caller scope.

from __future__ import annotations

import asyncio
import inspect
import json
import time
from typing import Any
from uuid import uuid4

from app import mcp_auth, mcp_catalog_runtime, mcp_observability, mcp_provider_operations
from app.application_tool_error import ApplicationToolError
from app.python_models.operation_definition import OperationDefinition, allowed_operation_keys
from app.python_models.tool_registry import operation_definition, tool_access
from mcp.types import CallToolResult, TextContent

MCP_CALL_TIMEOUT_SECONDS = 30.0
ENGRAPHIS_OPERATION_TIMEOUT_SECONDS = 120.0


def _tool_error_result(
    error: str,
    *,
    failure_code: str,
    category: str,
    dependency: str = "mcp",
    retryable: bool = False,
) -> CallToolResult:
    payload = {
        "ok": False,
        "error": error,
        "failureCode": failure_code,
        "errorCategory": category,
        "retryable": retryable,
        "dependency": dependency,
    }
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(payload))],
        structuredContent=payload,
        isError=True,
    )


def request_tool_is_allowed(
    name: str,
    definition: OperationDefinition | None = None,
) -> bool:
    resolved_definition = definition or operation_definition(name)
    access = (
        resolved_definition.access
        if resolved_definition is not None
        else tool_access(name)
    )
    principal = mcp_auth.internal_mcp_principal()
    if (
        mcp_provider_operations.is_provider_operation_name(name)
        and name not in mcp_catalog_runtime.published_mcp_tool_names()
    ):
        return False
    # The public host preserves the canonical unknown-tool error from dispatch.
    # Internal catalog/materializer principals remain read-only infrastructure.
    if access is None:
        return principal is None
    if principal is None:
        if not mcp_auth.OAUTH_ENFORCED:
            return True
        context = mcp_auth.authenticated_project_context()
        if resolved_definition is not None and resolved_definition.external_entry:
            return (
                context is not None
                and context.get(mcp_auth.PROJECT_CONTEXT_MAIN_ENTRY_FIELD) is True
                and name in mcp_catalog_runtime.published_mcp_tool_names()
            )
        granted = set((context or {}).get(mcp_auth.PROJECT_CONTEXT_TOOLS_FIELD) or [])
        return (
            name in mcp_catalog_runtime.published_mcp_tool_names()
            and name in granted
        )
    kind = str(principal.get("kind") or "")
    if kind == "catalog-reader":
        return False
    if kind == "card-runtime":
        context = mcp_auth.authenticated_project_context()
        granted = set((context or {}).get(mcp_auth.PROJECT_CONTEXT_TOOLS_FIELD) or [])
        return (
            name in mcp_catalog_runtime.published_mcp_tool_names()
            and name in granted
        )
    if kind == "materializer-read":
        grants = mcp_auth.validated_principal_tool_names(
            principal.get("grantedTools")
        )
        return access == "read" and grants is not None and name in grants
    return False
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
    "parentRunId",
    "originatingRunId",
    "_callerCardId",
    "_sourceCardId",
    "_sourceRunId",
    "_mainContext",
    "_catalogDiagnostics",
    "_authenticatedProjectId",
}
async def dispatch_tool(
    name: str,
    arguments: dict[str, Any],
) -> Any:
    context = mcp_auth.authenticated_project_context()
    principal = mcp_auth.internal_mcp_principal()
    if context is None and principal and principal.get("kind") == "materializer-read":
        # Pre-dispatch reads have real project/Card identity but no Run yet.
        # Keep their provider graph scope without fabricating runtime telemetry.
        context = {
            "projectId": principal["projectId"], "deckId": principal["deckId"],
            "callerCardId": principal["callerCardId"],
            "conversationId": principal.get("conversationId", ""),
        }
    if (
        mcp_provider_operations.is_provider_operation_name(name)
        and name not in mcp_catalog_runtime.published_mcp_tool_names()
    ):
        return _tool_error_result(
            f"unknown_tool: {name}",
            failure_code="unknown_tool",
            category="NOT_FOUND",
        )
    definition = operation_definition(name)
    if definition is None:
        return _tool_error_result(
            f"unknown_tool: {name}",
            failure_code="unknown_tool",
            category="NOT_FOUND",
        )
    if not request_tool_is_allowed(name, definition):
        return _tool_error_result(
            f"tool_not_granted: {name}",
            failure_code="tool_not_granted",
            category="AUTHORIZATION",
        )
    allowed = allowed_operation_keys(definition)
    server_injected = definition.server_injected_arguments
    dispatcher_context = definition.dispatcher_context_arguments
    args = dict(arguments or {})
    supplied_identity = sorted(
        (SERVER_OWNED_ARGUMENTS | set(server_injected)) & args.keys()
    )
    if supplied_identity:
        return _tool_error_result(
            "caller_identity_rejected: " + ",".join(supplied_identity),
            failure_code="caller_identity_rejected",
            category="INVALID_ARGUMENT",
        )
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
                args["_sourceCardId"] = str(context["callerCardId"])
            if "_sourceRunId" in dispatcher_context:
                args["_sourceRunId"] = str(context["parentRunId"])
            if "_callerCardId" in dispatcher_context:
                args["_callerCardId"] = str(context["callerCardId"])
            if "_authenticatedProjectId" in dispatcher_context:
                args["_authenticatedProjectId"] = str(context["projectId"])
            if "_mainContext" in dispatcher_context:
                args["_mainContext"] = {
                    field: str(context[field]) for field in mcp_auth.PROJECT_CONTEXT_FIELDS
                }
            if "_catalogDiagnostics" in dispatcher_context:
                args["_catalogDiagnostics"] = (
                    mcp_catalog_runtime.catalog_diagnostics()
                )
            if "senderAgentId" in allowed:
                args["senderAgentId"] = str(context["callerCardId"])
            if "correlationId" in allowed:
                args["correlationId"] = f"external-mcp:{uuid4()}"
            missing_injected = sorted(
                server_injected - args.keys()
                if definition.external_source_id != "graphiti"
                else frozenset()
            )
            if missing_injected:
                raise ValueError(
                    "server_injected_argument_unavailable:" + ",".join(missing_injected)
                )
        except (KeyError, RuntimeError, ValueError):
            return _tool_error_result(
                "server_context_unavailable",
                failure_code="server_context_unavailable",
                category="INTERNAL",
                dependency="tool-runtime",
            )
    caller_card_id = str(args.get("_callerCardId", "") or "").strip()
    if not caller_card_id and context is not None:
        caller_card_id = str(context.get("callerCardId") or "").strip()
    if "_callerCardId" in dispatcher_context:
        args["_callerCardId"] = caller_card_id
    extra = [k for k in args.keys() if k not in allowed]
    if extra:
        return _tool_error_result(
            f"tool_arguments_rejected: {','.join(sorted(extra))}",
            failure_code="tool_arguments_rejected",
            category="INVALID_ARGUMENT",
        )
    try:
        result = definition.handler(**args)
        if inspect.isawaitable(result):
            result = await result
    except ApplicationToolError as error:
        return _tool_error_result(
            str(error),
            failure_code="application_tool_failure",
            category="APPLICATION",
            dependency="tool-runtime",
        )
    graph_reference_identity = {
        "run_id": str((context or {}).get("parentRunId") or "").strip(),
        "project_id": str((context or {}).get("projectId") or "").strip(),
        "card_id": str((context or {}).get("callerCardId") or "").strip(),
    }
    if name == "graphiti.get_know" and all(graph_reference_identity.values()):
        from app.python_models.card_run_graph_references import (
            record_graphiti_know_readback,
        )

        record_graphiti_know_readback(
            result=result,
            **graph_reference_identity,
        )
    if isinstance(result, CallToolResult):
        return result
    if isinstance(result, list):
        return CallToolResult(content=result, isError=False)
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
    if name == "graphiti.add_know":
        return mcp_provider_operations.GRAPHITI_KNOW_WRITE_TIMEOUT_SECONDS
    if name in {'building_model.read_case', 'building_model.edit_inputs'}:
        return 960.0  # Existing Python rails worker: 900 s; HTTP forwarding: 930 s.
    definition = operation_definition(name)
    if definition is not None and definition.external_source_id == "openstudio":
        return 600.0
    if name == "engraphis_remember":
        # Semantic extraction and storage can exceed the ordinary read deadline.
        return 190.0
    if name.startswith("engraphis_"):
        # Engraphis semantic reads may cold-load the embedding/reranking stack.
        # Keep one bounded provider-family budget instead of per-tool exceptions.
        return ENGRAPHIS_OPERATION_TIMEOUT_SECONDS
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
    from app.python_models.project_graph_invocation import CURRENT_GRAPH_INVOCATION, rails_context
    scope_token = None
    try:
        arguments = dict(arguments)
        admission = arguments.pop("_nativeAdmissionId", None)
        if admission is not None:
            principal = mcp_auth.internal_mcp_principal() or {}
            scope_started = time.monotonic()
            invocation = await asyncio.to_thread(rails_context, "resolve", principal=principal, admissionId=admission)
            mcp_observability.trace("graph_invocation_resolved", **trace_fields,
                duration_ms=round((time.monotonic() - scope_started) * 1000))
            authorization = await asyncio.to_thread(mcp_auth._resolve_internal_card_context_sync,
                {**principal, "projectId": invocation["projectId"]})
            if authorization is None:
                raise ValueError("graph_invocation_authorization_unavailable")
            scope_token = CURRENT_GRAPH_INVOCATION.set({**invocation, "authorization": authorization})
            mcp_observability.trace("graph_invocation_authorized", **trace_fields,
                duration_ms=round((time.monotonic() - scope_started) * 1000))
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
    finally:
        if scope_token is not None:
            CURRENT_GRAPH_INVOCATION.reset(scope_token)


async def call_tool(name: str, arguments: dict[str, Any]) -> Any:
    return await execute_tool_request(
        name,
        arguments,
        transport="mcp",
    )
