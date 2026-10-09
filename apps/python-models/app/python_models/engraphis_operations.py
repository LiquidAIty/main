"""Engraphis Smart operation contracts, invocation, and application-only actions."""
from __future__ import annotations

import asyncio
from copy import deepcopy
from enum import Enum
import json
import threading
from typing import Any

from engraphis.core.interfaces import SearchFilter

from .engraphis import (
    THINK_INCIDENCE_KIND,
    SERVICE_LOCK,
    newest_think_sort_key,
    public_think_metadata,
    validated_think_metadata,
    get_service,
    project_id,
)

READ_TOOLS = frozenset({
    "engraphis_conflict_review",
    "engraphis_discover_actions",
    "engraphis_execute_read",
    "engraphis_get_memory",
})
WRITE_TOOLS = frozenset({
    "engraphis_execute_action",
    "engraphis_recall_context",
    "engraphis_remember",
    "engraphis_session",
    "engraphis_update_memory",
})


def _registered_tool_catalog():
    """Project Engraphis's compact Smart MCP registrations without an event loop.

    MCPServer.list_tools() is an async wrapper around the synchronous registered
    ToolManager.  Operation metadata is also needed by synchronous authorization
    code that may already be running inside an MCP event loop, so nesting
    asyncio.run() there is invalid. Build the same public MCP Tool models from
    the current Smart registrations instead of publishing the 39-tool Classic
    compatibility surface alongside them.
    """

    from engraphis.mcp_server import smart_mcp, smart_tool_catalog

    return {tool.name: (smart_mcp, tool) for tool in smart_tool_catalog()}


async def _tool_catalog():
    return _registered_tool_catalog()


def engraphis_tools_from_registrations() -> list[dict]:
    result = []
    for _, tool in _registered_tool_catalog().values():
        item = tool.model_dump(by_alias=True, exclude_none=True)
        schema = item["inputSchema"]
        schema.get("properties", {}).pop("workspace", None)
        if "workspace" in schema.get("required", []):
            schema["required"].remove("workspace")
        schema["additionalProperties"] = False
        result.append(item)
    return result


OPERATION_DEFINITIONS: tuple[Any, ...] | None = None
_OPERATION_DEFINITIONS_LOCK = threading.Lock()


def operation_definitions() -> list[Any]:
    """Contribute Engraphis contracts without routing through MCP discovery."""

    global OPERATION_DEFINITIONS
    if OPERATION_DEFINITIONS is not None:
        return list(OPERATION_DEFINITIONS)
    with _OPERATION_DEFINITIONS_LOCK:
        if OPERATION_DEFINITIONS is not None:
            return list(OPERATION_DEFINITIONS)
        try:
            engraphis_contracts = engraphis_tools_from_registrations()
        except BaseException as error:
            raise RuntimeError("engraphis_operation_definitions_unavailable") from error

        from app.python_models.operation_definition import OperationDefinition

        definitions = []
        for item in engraphis_contracts:
            name = str(item.get("name") or "").strip()
            access = "read" if name in READ_TOOLS else "write" if name in WRITE_TOOLS else ""
            if not name or not access:
                raise RuntimeError(f"engraphis_operation_access_missing:{name}")

            async def dispatch(
                *, _name: str = name, projectId: str = "", **arguments: Any,
            ) -> Any:
                if not projectId.strip():
                    return {"ok": False, "error": "authenticated_project_required"}
                return await invoke_tool(projectId, _name, arguments)

            definitions.append(OperationDefinition(
                canonical_id=name,
                description=str(item.get("description") or name),
                parameters_schema=deepcopy(item["inputSchema"]),
                handler=dispatch,
                available=True,
                publishers=frozenset({"internal-plugin", "external-mcp"}),
                access=access,
                namespace="engraphis",
                external_source_id="engraphis",
                output_schema=deepcopy(item.get("outputSchema")),
                title=str(
                    item.get("title")
                    or (item.get("annotations") or {}).get("title")
                    or name
                ),
                annotations=deepcopy(item.get("annotations") or {}),
                dispatcher_context_arguments=frozenset({"projectId"}),
            ))
        OPERATION_DEFINITIONS = tuple(definitions)
        return list(OPERATION_DEFINITIONS)


async def invoke_tool(project: str, name: str, arguments: dict) -> dict:
    # FastMCP synchronous tools execute on their caller's thread. Keep
    # embedding and SQLite work off Python rails' shared HTTP event loop.
    return await asyncio.to_thread(_invoke_tool_sync, project, name, arguments)


def _invoke_tool_sync(project: str, name: str, arguments: dict) -> dict:
    with SERVICE_LOCK:
        return asyncio.run(_invoke_tool(project, name, arguments))


async def _invoke_tool(project: str, name: str, arguments: dict) -> dict:
    catalog = await _tool_catalog()
    if name not in catalog:
        raise ValueError("thinkgraph_tool_unavailable")
    project = project_id(project)
    if "workspace" in arguments:
        raise ValueError("thinkgraph_scope_is_owned_by_project")
    server, tool = catalog[name]
    arguments = dict(arguments)
    if "workspace" in tool.input_schema.get("properties", {}):
        arguments["workspace"] = project
    if name in {"engraphis_execute_read", "engraphis_execute_action"}:
        from engraphis.mcp_server import resolve_capability
        capability = resolve_capability(
            arguments.get("capability_id"), arguments.get("schema_digest"),
        )
        if capability is not None and "workspace" in capability.input_schema.get("properties", {}):
            nested = dict(arguments.get("arguments") or {})
            if "workspace" in nested and nested["workspace"] != project:
                raise ValueError("thinkgraph_scope_is_owned_by_project")
            nested["workspace"] = project
            arguments["arguments"] = nested
    get_service()
    response = await server.call_tool(name, arguments)
    content = response.content if hasattr(response, "content") else response[0] if isinstance(response, tuple) else response
    if getattr(response, "is_error", False):
        raise ValueError(" ".join(getattr(block, "text", "") for block in content))
    for block in content:
        if getattr(block, "type", None) == "text":
            if block.text.startswith("Error:"):
                raise ValueError(block.text)
            data = json.loads(block.text)
            if isinstance(data, dict):
                if data.get("ok") is False or data.get("error"):
                    raise ValueError(json.dumps(data))
                if name == "engraphis_recall_context" and (
                    not data.get("semantic_support") or data.get("degraded_mode")
                ):
                    raise RuntimeError("thinkgraph_semantic_search_unavailable")
                return data
    raise RuntimeError("thinkgraph_result_invalid")


def inspect(project: str, id_field: str, identifier: str) -> dict:
    service = get_service()
    project = project_id(project)
    if id_field == "engraphisEntityId":
        entity = service.graph_entity(
            identifier,
            workspace=project,
            include_weak_cooccurrence=False,
        )
        evidence_by_id: dict[str, dict[str, Any]] = {}
        member_ids = [str(value) for value in entity.get("member_ids") or []]
        if member_ids:
            workspace_row = service.store.conn.execute(
                "SELECT id FROM workspaces WHERE name=?", (project,)
            ).fetchone()
            workspace_id = str(workspace_row["id"]) if workspace_row is not None else ""
            incidences = service.store.list_memory_entities(
                SearchFilter(workspace_id=workspace_id),
                entity_ids=member_ids,
                limit=512,
            )
            direct = [
                row for row in incidences
                if row.get("source_kind") == THINK_INCIDENCE_KIND
            ]
            memory_ids = list(dict.fromkeys(
                str(row["memory_id"]) for row in direct
            ))
            memories = service.store.get_memories(memory_ids)
            for row in direct:
                memory_id = str(row["memory_id"])
                memory = memories.get(memory_id)
                if memory is None or validated_think_metadata(memory) is None:
                    continue
                evidence_by_id[memory_id] = {
                    "memory_id": memory.id,
                    "title": memory.title,
                    "excerpt": memory.content[:500],
                    "memory_type": (
                        memory.mtype.value
                        if isinstance(memory.mtype, Enum) else str(memory.mtype)
                    ),
                    "source_kind": str(row.get("source_kind") or ""),
                    "confidence": float(row.get("confidence") or 0.0),
                    "valid_from": memory.valid_from,
                    "valid_to": memory.valid_to,
                    "valid_to_recorded_at": memory.valid_to_recorded_at,
                    "ingested_at": memory.ingested_at,
                    "expired_at": memory.expired_at,
                    "provenance": deepcopy(memory.provenance),
                    "metadata": public_think_metadata(memory.metadata),
                }
        entity["evidence"] = sorted(evidence_by_id.values(), key=newest_think_sort_key)
        return {"entity": entity}
    if id_field != "engraphisMemoryId":
        raise ValueError("engraphis_reference_type_invalid")
    result = service.inspect(identifier, workspace=project)
    result["memory"]["metadata"] = public_think_metadata(
        service.store.get_memory(identifier).metadata
    )
    # Preserve directional composite identities from the Engraphis link store.
    # The public inspector has already authorized the neighboring records.
    neighbors = {link["id"] for link in result["links"]}
    result["relationships"] = [link for link in service.store.get_links(identifier)
        if (link["b"] if link["a"] == identifier else link["a"]) in neighbors]
    return result


def private_operation(project: str, operation: str, arguments: dict) -> dict:
    """Application operations outside model tool grants."""
    project = project_id(project)
    if operation == "retire":
        if set(arguments) != {"memoryId"}:
            raise ValueError("engraphis_memory_reference_invalid")
        memory_id = str(arguments.get("memoryId") or "")
        with SERVICE_LOCK:
            return get_service().retire(memory_id, workspace=project,
                reason="Removed in ThinkGraph", actor="user")
    if operation == "delete_workspace":
        if arguments != {"confirmed": True}:
            raise ValueError("thinkgraph_workspace_delete_requires_confirmation")
        with SERVICE_LOCK:
            return get_service().delete_workspace(project)
    if operation == "inspect":
        if set(arguments) == {"entityId"}:
            return inspect(
                project, "engraphisEntityId", str(arguments.get("entityId") or ""),
            )
        if set(arguments) == {"memoryId"}:
            return inspect(
                project, "engraphisMemoryId", str(arguments.get("memoryId") or ""),
            )
        raise ValueError("engraphis_reference_invalid")
    raise ValueError("thinkgraph_operation_unavailable")
