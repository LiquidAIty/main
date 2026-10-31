"""CBM and Graphiti publication, invocation, and result policy."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: MCP Host
# Relationship: This file discovers and dispatches bounded CBM and Graphiti provider operations through their current authenticated MCP contracts.
#
# Entity: Tool Catalog
# Relationship: This file publishes canonical provider-operation metadata, availability, eligibility, schemas, and profile ceilings into the authenticated catalog.

from __future__ import annotations

import asyncio
import copy
import json
import os
import re
import shutil
from typing import Any

from mcp.types import CallToolResult, TextContent, Tool

from app import mcp_cbm_provider, mcp_graphiti_provider
from app.python_models.operation_definition import OperationDefinition
from app.python_models.tool_registry import (
    graphiti_operation_policy,
    operation_definition,
    replace_discovered_external_operations,
)


_PACKAGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(os.path.dirname(_PACKAGE_ROOT))
_CBM_HOST_REPO_ROOT = os.path.normpath(_REPO_ROOT)
CBM_REQUEST_TIMEOUT_SECONDS = 300.0
_PROVIDER_TOOL_TIMEOUT_SECONDS = 30.0
GRAPHITI_KNOW_WRITE_TIMEOUT_SECONDS = 600.0
PROVIDER_PREFIXES = {
    "cbm": "cbm.",
    "graphiti": "graphiti.",
}
PROVIDER_FAMILIES = tuple(PROVIDER_PREFIXES)
_CARD_CATALOG_PROVIDER_TOOL_NAMES = {
    "cbm": frozenset({
        "check_index_coverage",
        "detect_changes",
        "get_architecture",
        "get_code_snippet",
        "get_graph_schema",
        "query_graph",
        "search_code",
        "search_graph",
        "trace_path",
    }),
    "graphiti": frozenset({
        "add_know",
        "add_memory",
        "build_communities",
        "clear_graph",
        "delete_entity_edge",
        "delete_episode",
        "get_know",
        "get_entity_knows",
        "get_entity_edge",
        "get_episode_entities",
        "get_episodes",
        "get_status",
        "search_memory_facts",
        "search_knows",
        "search_nodes",
        "summarize_saga",
    }),
}
_PROVIDER_TOOL_TITLES = {
    "cbm": {
        "check_index_coverage": "Check CodeGraph index coverage",
        "detect_changes": "Detect repository code changes",
        "get_architecture": "Read repository architecture",
        "get_code_snippet": "Read a CodeGraph source snippet",
        "get_graph_schema": "Read the CodeGraph schema",
        "query_graph": "Query CodeGraph structure",
        "search_code": "Search repository source",
        "search_graph": "Search CodeGraph structure",
        "trace_path": "Trace a CodeGraph path",
    },
    "graphiti": {
        "add_know": "Add a Know to an Entity",
        "add_memory": "Add a KnowGraph memory episode",
        "build_communities": "Build KnowGraph communities",
        "clear_graph": "Clear KnowGraph data",
        "delete_entity_edge": "Delete a KnowGraph relationship",
        "delete_episode": "Delete a KnowGraph episode",
        "get_know": "Read an exact Know",
        "get_entity_knows": "Read an Entity's Knows",
        "get_entity_edge": "Read a KnowGraph relationship",
        "get_episode_entities": "Read episode entities and relationships",
        "get_episodes": "List KnowGraph episodes",
        "get_status": "Read KnowGraph status",
        "search_memory_facts": "Search KnowGraph facts",
        "search_knows": "Search Knows",
        "search_nodes": "Search KnowGraph entities",
        "summarize_saga": "Summarize a KnowGraph saga",
    },
}
_GRAPHITI_SERVER_INJECTED_ARGUMENTS = frozenset({"group_id", "group_ids"})
_GRAPHITI_PROJECT_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def _inline_graphiti_know_schema(payload: dict[str, Any]) -> None:
    """Inline MCP-v2 definitions before projecting through the v1 Tool model."""

    schema = copy.deepcopy(payload.get("inputSchema") or {})
    definitions = schema.pop("$defs", {})
    properties = schema.get("properties")
    if not isinstance(definitions, dict) or not isinstance(properties, dict):
        payload["inputSchema"] = schema
        return

    citation = definitions.get("KnowCitation")
    if isinstance(citation, dict) and properties.get("citation") == {
        "$ref": "#/$defs/KnowCitation",
    }:
        properties["citation"] = copy.deepcopy(citation)

    direction = properties.get("direction")
    if isinstance(direction, dict) and isinstance(direction.get("anyOf"), list):
        direction["anyOf"] = [
            copy.deepcopy(definitions["KnowDirection"])
            if item == {"$ref": "#/$defs/KnowDirection"}
            and isinstance(definitions.get("KnowDirection"), dict)
            else item
            for item in direction["anyOf"]
        ]
    payload["inputSchema"] = schema


async def _entity_know_provider_arguments(
    arguments: dict[str, Any],
    project_id: str,
) -> dict[str, Any]:
    provider_arguments = dict(arguments)
    raw_citation = provider_arguments.get("citation")
    entity_name = str(provider_arguments.get("entity_name") or "").strip()
    if not project_id or not entity_name or not isinstance(raw_citation, dict):
        raise ValueError("know_project_and_entity_required")
    reference_time = raw_citation.get("eventAt") or raw_citation.get("publishedAt")
    if reference_time:
        provider_arguments["reference_time"] = reference_time
    return provider_arguments


def is_provider_operation_name(name: str) -> bool:
    return name.startswith((*PROVIDER_PREFIXES.values(), "engraphis_"))


def belongs_to_provider(name: str, family: str) -> bool:
    if family in PROVIDER_PREFIXES:
        return name.startswith(PROVIDER_PREFIXES[family])
    definition = operation_definition(name)
    return bool(definition and definition.external_source_id == family)


def graphiti_project_group_id(project_id: str) -> str:
    """Map a Main project to Graphiti's existing isolated group namespace."""
    if not isinstance(project_id, str) or not _GRAPHITI_PROJECT_ID.fullmatch(project_id):
        raise ValueError(
            "projectId must contain only letters, numbers, underscores, and hyphens"
        )
    return f"liquidaity-{project_id}"


def namespace_provider_tools(provider: str, tools: list[Tool]) -> list[Tool]:
    """Project the deliberate model-facing provider subset with its routing prefix."""
    prefix = PROVIDER_PREFIXES[provider]
    exposed_names = _CARD_CATALOG_PROVIDER_TOOL_NAMES[provider]
    result: list[Tool] = []
    for tool in tools:
        if tool.name not in exposed_names:
            continue
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        provider_tool_name = tool.name
        payload["name"] = prefix + provider_tool_name
        payload["title"] = _PROVIDER_TOOL_TITLES[provider][provider_tool_name]
        meta = dict(payload.get("_meta") or {})
        meta["liquidaitySource"] = {
            "sourceId": provider,
            "namespace": provider,
            "providerToolName": tool.name,
            "connectionKind": "external-mcp",
        }
        payload["_meta"] = meta
        if provider == "graphiti" and provider_tool_name == "add_know":
            _inline_graphiti_know_schema(payload)
        if provider == "graphiti" and provider_tool_name == "get_episodes":
            schema = copy.deepcopy(payload.get("inputSchema") or {})
            properties = schema.setdefault("properties", {})
            properties.update({
                "include_body": {
                    "type": "boolean",
                    "default": False,
                    "description": (
                        "Explicitly include episode bodies; ordinary reads return previews."
                    ),
                },
                "body_preview_chars": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2000,
                    "default": 400,
                },
                "max_response_chars": {
                    "type": "integer",
                    "minimum": 2000,
                    "maximum": 100000,
                    "default": 20000,
                },
            })
            payload["inputSchema"] = schema
        result.append(Tool.model_validate(payload))
    return result


def register_cbm_catalog(tools: list[Tool]) -> None:
    """Project the current official CBM catalog into runtime authorization."""
    definitions: list[OperationDefinition] = []
    for tool in tools:
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        annotations = dict(payload.get("annotations") or {})
        read_only = annotations.get("readOnlyHint")
        if read_only is None:
            read_only = False
            annotations["readOnlyHint"] = False
        annotations.setdefault("destructiveHint", read_only is not True)
        annotations.setdefault("idempotentHint", read_only is True)
        annotations.setdefault("openWorldHint", False)
        provider_tool_name = str(
            (payload.get("_meta") or {}).get("liquidaitySource", {}).get(
                "providerToolName"
            )
            or tool.name.removeprefix(PROVIDER_PREFIXES["cbm"])
        )

        async def dispatch_cbm(
            *, _provider_tool_name: str = provider_tool_name, **arguments: Any,
        ) -> Any:
            return await call_cbm_operation(_provider_tool_name, arguments)

        definitions.append(OperationDefinition(
            canonical_id=tool.name,
            description=str(tool.description or "").strip(),
            parameters_schema=copy.deepcopy(tool.input_schema),
            handler=dispatch_cbm,
            available=True,
            publishers=frozenset({"external-mcp"}),
            access="read" if read_only is True else "write",
            namespace="cbm",
            grant_eligible=True,
            external_source_id="cbm",
            output_schema=(
                copy.deepcopy(tool.output_schema)
                if tool.output_schema is not None
                else None
            ),
            title=str(
                tool.title
                or (payload.get("annotations") or {}).get("title")
                or tool.name
            ),
            annotations=copy.deepcopy(annotations),
            dispatcher_owner="app.mcp_provider_operations.call_cbm_operation",
        ))
    replace_discovered_external_operations("cbm", definitions)


def register_graphiti_catalog(tools: list[Tool]) -> None:
    """Bind exact live Graphiti schemas to the explicit provider adapter contract."""
    definitions: list[OperationDefinition] = []
    for tool in tools:
        policy = graphiti_operation_policy(tool.name)
        if policy is None:
            raise RuntimeError(f"graphiti_operation_definition_missing:{tool.name}")
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        annotations = dict(payload.get("annotations") or {})
        for key, value in policy["annotations"].items():
            if key in annotations and annotations[key] is not value:
                raise RuntimeError(f"graphiti_annotation_mismatch:{tool.name}:{key}")
            annotations[key] = copy.deepcopy(value)
        properties = tool.input_schema.get("properties", {})
        if not isinstance(properties, dict):
            raise RuntimeError(f"graphiti_input_schema_invalid:{tool.name}")
        server_injected = frozenset(properties) & _GRAPHITI_SERVER_INJECTED_ARGUMENTS
        provider_tool_name = str(
            (payload.get("_meta") or {}).get("liquidaitySource", {}).get(
                "providerToolName"
            )
            or tool.name.removeprefix(PROVIDER_PREFIXES["graphiti"])
        )

        async def dispatch_graphiti(
            *, _provider_tool_name: str = provider_tool_name,
            _authenticatedProjectId: str = "",
            _server_injected: frozenset[str] = server_injected,
            **arguments: Any,
        ) -> Any:
            provider_arguments = dict(arguments)
            if _provider_tool_name == "add_know":
                if not _authenticatedProjectId:
                    raise RuntimeError("know_project_context_required")
                provider_arguments = await _entity_know_provider_arguments(
                    provider_arguments,
                    _authenticatedProjectId,
                )
            include_body = bool(provider_arguments.pop("include_body", False))
            preview_chars = max(0, min(
                2000, int(provider_arguments.pop("body_preview_chars", 400)),
            ))
            response_budget = max(2000, min(
                100000, int(provider_arguments.pop("max_response_chars", 20000)),
            ))
            if _authenticatedProjectId:
                group_id = graphiti_project_group_id(_authenticatedProjectId)
                if "group_id" in _server_injected:
                    provider_arguments["group_id"] = group_id
                if "group_ids" in _server_injected:
                    provider_arguments["group_ids"] = [group_id]
                missing_scope = sorted(_server_injected - provider_arguments.keys())
                if missing_scope:
                    raise RuntimeError(
                        "server_injected_argument_unavailable:"
                        + ",".join(missing_scope)
                    )
            result = await call_graphiti_operation(_provider_tool_name, provider_arguments)
            if (
                _provider_tool_name == "get_episodes"
                and isinstance(result, CallToolResult)
            ):
                return _bounded_graphiti_episodes(
                    result,
                    include_body=include_body,
                    preview_chars=preview_chars,
                    response_budget=response_budget,
                )
            return result

        definitions.append(OperationDefinition(
            canonical_id=tool.name,
            description=str(tool.description or "").strip(),
            parameters_schema=copy.deepcopy(tool.input_schema),
            handler=dispatch_graphiti,
            available=True,
            publishers=frozenset({"external-mcp"}),
            access=str(policy["access"]),
            namespace="graphiti",
            grant_eligible=True,
            external_source_id="graphiti",
            output_schema=(
                copy.deepcopy(tool.output_schema)
                if tool.output_schema is not None else None
            ),
            title=str(tool.title or tool.name),
            annotations=annotations,
            server_injected_arguments=server_injected,
            dispatcher_context_arguments=server_injected | frozenset({
                "_authenticatedProjectId",
                "include_body",
                "body_preview_chars",
                "max_response_chars",
            }),
            dispatcher_owner="app.mcp_provider_operations.call_graphiti_operation",
        ))
    replace_discovered_external_operations("graphiti", definitions)


def bind_repo_tool_source(
    tool: Tool,
    *,
    source_id: str = "main_mcp",
    provider_tool_name: str | None = None,
) -> Tool:
    """Attach factual connection identity to a repo-owned MCP declaration."""
    payload = tool.model_dump(by_alias=True, exclude_none=True)
    meta = dict(payload.get("_meta") or {})
    meta["liquidaitySource"] = {
        "sourceId": source_id,
        "providerToolName": provider_tool_name or tool.name,
        "connectionKind": "external-mcp",
    }
    payload["_meta"] = meta
    return Tool.model_validate(payload)


def bind_operation_access(tool: Tool) -> Tool:
    """Attach access from the canonical operation or provider definition."""
    definition = operation_definition(tool.name)
    access = definition.access if definition is not None else None
    if access is None:
        raise RuntimeError(f"mcp_tool_missing_operation_access:{tool.name}")
    payload = tool.model_dump(by_alias=True, exclude_none=True)
    if definition.title and not payload.get("title"):
        payload["title"] = definition.title
    annotations = dict(payload.get("annotations") or {})
    for key, value in (definition.annotations or {}).items():
        if key in annotations and annotations[key] != value:
            raise RuntimeError(f"mcp_tool_annotation_mismatch:{tool.name}:{key}")
        annotations[key] = copy.deepcopy(value)
    required_hints = {
        "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint",
    }
    if not required_hints.issubset(annotations):
        missing = ",".join(sorted(required_hints - set(annotations)))
        raise RuntimeError(f"mcp_tool_annotations_missing:{tool.name}:{missing}")
    payload["annotations"] = annotations
    meta = dict(payload.get("_meta") or {})
    meta["liquidaityAccess"] = access
    source = dict(meta.get("liquidaitySource") or {})
    canonical_input_schema = copy.deepcopy(definition.parameters_schema)
    if definition.publishers != frozenset({"external-mcp"}):
        canonical_input_schema.setdefault("additionalProperties", False)
    source.update({
        "namespace": definition.namespace,
        "publication": "external-mcp",
        "access": access,
        "available": definition.available,
        "grantEligible": definition.grant_eligible,
        "grantProfiles": sorted(definition.grant_profiles),
        "canonicalInputSchema": canonical_input_schema,
        "serverInjectedArguments": sorted(definition.server_injected_arguments),
        "dispatcherContextArguments": sorted(definition.dispatcher_context_arguments),
        "dispatcherOwner": definition.dispatcher_owner,
        "authenticatedProjection": False,
    })
    meta["liquidaitySource"] = source
    payload["_meta"] = meta
    return Tool.model_validate(payload)


async def call_graphiti_operation(name: str, arguments: dict[str, Any]) -> Any:
    arguments = dict(arguments)
    try:
        await asyncio.wait_for(
            mcp_graphiti_provider.ensure_graphiti_service(),
            timeout=_PROVIDER_TOOL_TIMEOUT_SECONDS,
        )
    except TimeoutError as error:
        raise RuntimeError("graphiti_initialization_timeout") from error
    try:
        result = await asyncio.wait_for(
            mcp_graphiti_provider.call_graphiti_tool(name, arguments),
            timeout=GRAPHITI_KNOW_WRITE_TIMEOUT_SECONDS if name == "add_know" else _PROVIDER_TOOL_TIMEOUT_SECONDS,
        )
    except TimeoutError as error:
        raise RuntimeError(f"graphiti_timeout:{name}") from error
    return _normalize_graphiti_result(result)


def _normalize_graphiti_result(result: Any) -> Any:
    return _normalize_provider_tool_result(result)


def _bounded_graphiti_episodes(
    result: CallToolResult,
    *,
    include_body: bool,
    preview_chars: int,
    response_budget: int,
) -> CallToolResult:
    """Project Graphiti episodes into a stable, context-bounded public response."""
    if result.is_error or not isinstance(result.structured_content, dict):
        return result
    graphiti_payload = result.structured_content.get("result")
    if (
        not isinstance(graphiti_payload, dict)
        or not isinstance(graphiti_payload.get("episodes"), list)
    ):
        return result
    projected: list[dict[str, Any]] = []
    for graphiti_episode in graphiti_payload["episodes"]:
        if not isinstance(graphiti_episode, dict):
            continue
        content = str(graphiti_episode.get("content") or "")
        episode = {
            key: graphiti_episode.get(key)
            for key in (
                "uuid", "name", "source", "source_description", "created_at", "valid_at",
                "reference_time", "group_id", "saga_uuid",
            )
            if graphiti_episode.get(key) is not None
        }
        episode["content_chars"] = len(content)
        if include_body:
            episode["content"] = content
        else:
            episode["content_preview"] = content[:preview_chars]
            episode["content_truncated"] = len(content) > preview_chars
        projected.append(episode)
    payload: dict[str, Any] = {
        "message": graphiti_payload.get("message") or "Episodes retrieved successfully",
        "episodes": projected,
        "bodyIncluded": include_body,
        "responseBudgetChars": response_budget,
        "truncated": False,
        "omittedEpisodes": 0,
    }
    serialized = json.dumps(payload, ensure_ascii=False)
    if len(serialized) > response_budget and include_body and projected:
        overhead = len(serialized) - len(str(projected[0].get("content") or ""))
        allowed_body = max(0, response_budget - overhead - 100)
        original = str(projected[0].get("content") or "")
        projected[0]["content"] = original[:allowed_body]
        projected[0]["content_truncated"] = len(original) > allowed_body
        payload["truncated"] = payload["truncated"] or len(original) > allowed_body
        serialized = json.dumps(payload, ensure_ascii=False)
    while len(serialized) > response_budget and projected:
        projected.pop()
        payload["omittedEpisodes"] += 1
        payload["truncated"] = True
        serialized = json.dumps(payload, ensure_ascii=False)
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
        structuredContent={"result": payload},
        isError=False,
    )


def _normalize_provider_tool_result(result: Any) -> Any:
    """Preserve provider-declared MCP success or failure without parsing prose."""

    if isinstance(result, CallToolResult):
        return result
    if isinstance(result, tuple) and len(result) == 2 and isinstance(result[0], list):
        blocks = result[0]
        structured = result[1] if isinstance(result[1], dict) else None
    else:
        blocks = result
        structured = None
    if not isinstance(blocks, list):
        return result
    return CallToolResult(
        content=blocks,
        structuredContent=structured,
        isError=False,
    )


def cbm_config() -> tuple[str, list[str], str]:
    """Open the one current official user-installed CBM frontend owned by this host."""
    command = os.environ.get("MCP_CBM_BINARY", "").strip() or "codebase-memory-mcp"
    binary = shutil.which(command) or command
    return (binary, [], _CBM_HOST_REPO_ROOT)


async def call_cbm_operation(name: str, arguments: dict[str, Any]) -> CallToolResult:
    return await mcp_cbm_provider.call_cbm_tool(
        name,
        dict(arguments),
        request_timeout_seconds=CBM_REQUEST_TIMEOUT_SECONDS,
    )
