"""MCP Tool construction, provider discovery, and request projection."""
# Entity: Tool Catalog
# Relationship: Builds the authenticated MCP catalog, discovers selected external provider families, rejects duplicate names, and filters each request to its exact grants.

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from typing import Any

from mcp.types import Tool

from app import mcp_auth, mcp_cbm_provider, mcp_graphiti_provider, mcp_provider_operations
from app.python_models.operation_definition import allowed_operation_keys
from app.python_models.tool_catalog import code_owned_tool_projection, project_server_injected_schema
from app.python_models.tool_registry import operation_definition, tool_access


def catalog_identity(tools: list[Tool]) -> tuple[int, str]:
    descriptors = sorted(
        (tool.model_dump(by_alias=True, exclude_none=True) for tool in tools),
        key=lambda descriptor: str(descriptor.get("name") or ""),
    )
    serialized = json.dumps(descriptors, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    return len(descriptors), digest


async def application_tools() -> list[Tool]:
    """Expose every saved-Card tool through the authenticated MCP transport."""
    descriptors = [
        descriptor
        for descriptor in await asyncio.to_thread(code_owned_tool_projection)
        if set(descriptor["publications"]) & {"card-profile", "external-mcp"}
    ]
    tools = [
        mcp_provider_operations.bind_repo_tool_source(
            Tool(
                name=descriptor["canonicalId"],
                title=descriptor.get("displayName"),
                description=descriptor["description"],
                inputSchema=copy.deepcopy(descriptor["inputSchema"]),
                outputSchema=(
                    copy.deepcopy(descriptor["outputSchema"])
                    if isinstance(descriptor.get("outputSchema"), dict)
                    and descriptor["outputSchema"].get("type") == "object"
                    else None
                ),
                annotations=copy.deepcopy(descriptor.get("annotations")),
            ),
            source_id=descriptor["provider"],
            provider_tool_name=descriptor["providerToolName"],
        )
        for descriptor in descriptors
    ]
    for tool in tools:
        tool.input_schema.setdefault("additionalProperties", False)
        definition = operation_definition(tool.name)
        if definition is None:
            raise RuntimeError(f"mcp_tool_definition_missing:{tool.name}")
        missing = set(tool.input_schema.get("properties", {})) - allowed_operation_keys(definition)
        if missing:
            raise RuntimeError(
                f"mcp_tool_dispatch_keys_missing:{tool.name}:{','.join(sorted(missing))}"
            )
    return tools


def bind_authenticated_catalog(tools: list[Tool]) -> list[Tool]:
    """Attach OAuth metadata without filtering the canonical registry."""
    result: list[Tool] = []
    for tool in tools:
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        meta = dict(payload.get("_meta") or {})
        source = dict(meta.get("liquidaitySource") or {})
        canonical_schema = source.get("canonicalInputSchema")
        declared = source.get("serverInjectedArguments")
        if not isinstance(canonical_schema, dict) or not isinstance(declared, list):
            raise RuntimeError(f"mcp_tool_projection_metadata_missing:{tool.name}")
        projected_schema = project_server_injected_schema(canonical_schema, frozenset(declared))
        if tool.input_schema not in (canonical_schema, projected_schema):
            raise RuntimeError(f"mcp_tool_pre_projection_schema_mismatch:{tool.name}")
        payload["inputSchema"] = projected_schema
        source["authenticatedProjection"] = True
        meta["liquidaitySource"] = source
        meta["securitySchemes"] = [{
            "type": "oauth2", "scopes": [mcp_auth.AUTH0_REQUIRED_SCOPE],
        }]
        payload["_meta"] = meta
        result.append(Tool.model_validate(payload))
    return result


def requested_provider_families() -> tuple[str, ...]:
    """Resolve external families only from the authorized live MCP request."""
    principal = mcp_auth.internal_mcp_principal()
    if principal is None:
        if not mcp_auth.access_token_available():
            return ()
        context = mcp_auth.authenticated_project_context()
        selected = set((context or {}).get(mcp_auth.PROJECT_CONTEXT_TOOLS_FIELD) or [])
        return tuple(
            family
            for family, prefix in mcp_provider_operations.PROVIDER_PREFIXES.items()
            if any(name.startswith(prefix) for name in selected)
        )
    kind = str(principal.get("kind") or "")
    if kind == "catalog-reader":
        return tuple(mcp_provider_operations.PROVIDER_PREFIXES)
    if kind != "materializer-read":
        return ()
    tool_names = mcp_auth.validated_principal_tool_names(
        principal.get("grantedTools")
    ) or frozenset()
    return tuple(
        family
        for family, prefix in mcp_provider_operations.PROVIDER_PREFIXES.items()
        if any(name.startswith(prefix) for name in tool_names)
    )


async def discover_provider_tools(provider: str) -> list[Tool]:
    return (
        await mcp_cbm_provider.cbm_tools()
        if provider == "cbm"
        else await mcp_graphiti_provider.graphiti_tools()
    )


def provider_unavailability(provider: str, tools: list[Tool]) -> dict[str, Any] | None:
    if provider == "graphiti" and not tools:
        return mcp_graphiti_provider.graphiti_unavailability()
    return None


def project_provider_tools(provider: str, tools: list[Tool]) -> list[Tool]:
    namespaced = mcp_provider_operations.namespace_provider_tools(provider, tools)
    if provider == "cbm":
        mcp_provider_operations.register_cbm_catalog(namespaced)
    elif provider == "graphiti":
        mcp_provider_operations.register_graphiti_catalog(namespaced)
    return namespaced


def _apply_authentication(tools: list[Tool]) -> list[Tool]:
    return (
        bind_authenticated_catalog(tools)
        if mcp_auth.OAUTH_ENFORCED
        or mcp_auth.authenticated_project_context() is not None
        else tools
    )


def finalize_provider_catalog(tools: list[Tool]) -> list[Tool]:
    tools = [mcp_provider_operations.bind_operation_access(tool) for tool in tools]
    return _apply_authentication(tools)


def complete_catalog(application_catalog: list[Tool], provider_catalog: list[Tool]) -> list[Tool]:
    tools = [*application_catalog, *provider_catalog]
    names = [tool.name for tool in tools]
    if len(names) != len(set(names)):
        duplicates = sorted({name for name in names if names.count(name) > 1})
        raise RuntimeError("federated_duplicate_tool_name:" + ",".join(duplicates))
    context = mcp_auth.authenticated_project_context()
    return bind_authenticated_catalog(tools) if mcp_auth.OAUTH_ENFORCED or context is not None else tools


def catalog_for_request(tools: list[Tool]) -> list[Tool]:
    families = set(requested_provider_families())
    visible = [
        tool
        for tool in tools
        if not any(
            tool.name.startswith(prefix) and family not in families
            for family, prefix in mcp_provider_operations.PROVIDER_PREFIXES.items()
        )
    ]
    principal = mcp_auth.internal_mcp_principal()
    kind = str((principal or {}).get("kind") or "")
    if kind == "materializer-read":
        granted = mcp_auth.validated_principal_tool_names(principal.get("grantedTools"))
        visible = [tool for tool in visible if (
            granted is not None
            and tool.name in granted
            and tool_access(tool.name) == "read"
        )]
    elif principal is None and mcp_auth.access_token_available():
        context = mcp_auth.authenticated_project_context()
        granted = set((context or {}).get(mcp_auth.PROJECT_CONTEXT_TOOLS_FIELD) or [])
        visible = [tool for tool in visible if (
            tool.name in granted
            or bool(
                (definition := operation_definition(tool.name))
                and definition.external_entry
                and context is not None
                and context.get(mcp_auth.PROJECT_CONTEXT_MAIN_ENTRY_FIELD) is True
            )
        )]
    names = [tool.name for tool in visible]
    if len(names) != len(set(names)):
        duplicates = sorted({name for name in names if names.count(name) > 1})
        raise RuntimeError("federated_duplicate_tool_name:" + ",".join(duplicates))
    return visible


def listed_tool_input_schema(tools: tuple[Tool, ...], name: str) -> dict[str, Any] | None:
    match = next((tool for tool in tools if tool.name == name), None)
    return copy.deepcopy(match.input_schema) if match is not None else None
