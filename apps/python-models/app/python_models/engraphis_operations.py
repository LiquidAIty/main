"""Engraphis Smart operation contracts, invocation, and application-only actions."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: ThinkGraph
# Relationship: Binds Think writes, maintenance and research claims/results to authorized Project scope, verifying Graphiti result references before completing research.
# Entity: Tool Catalog
# Relationship: This file projects the installed Smart operation schemas, explicit effects, grant eligibility, and ThinkGraph-only update ceiling into canonical definitions.
# Entity: Data Anchors
# Relationship: This file inspects exact Engraphis Entity and Memory identities with bounded evidence and relationship records for provider reference hydration.
from __future__ import annotations

import asyncio
from copy import deepcopy
from enum import Enum
import json
import threading
from typing import Any
from urllib.parse import unquote

from engraphis.core.interfaces import SearchFilter

from .engraphis import (
    THINK_INCIDENCE_KIND,
    SERVICE_LOCK,
    exact_think_entity_ids,
    newest_think_sort_key,
    public_think_metadata,
    validated_think_metadata,
    get_service,
    project_principal,
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
    "engraphis_remember_entities",
    "engraphis_add_thinks",
    "engraphis_session",
    "engraphis_update_memory",
    "engraphis_correct",
    "engraphis_retire",
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
            description = str(item.get("description") or name).strip()
            if name == "engraphis_recall_context":
                description += (
                    " Each successful recall appends a retrieval/accounting receipt, so it is "
                    "not read-only or safe to retry blindly after an uncertain transport failure."
                )
            elif name == "engraphis_remember_entities":
                description = (
                    "Atomically store one durable memory per exact Entity. Each fact requires "
                    "content and entity_name and may reuse an exact entity_id."
                )

            async def dispatch(
                *, _name: str = name, projectId: str = "", **arguments: Any,
            ) -> Any:
                if not projectId.strip():
                    return {"ok": False, "error": "authenticated_project_required"}
                return await invoke_tool(projectId, _name, arguments)

            definitions.append(OperationDefinition(
                canonical_id=name,
                description=description,
                parameters_schema=deepcopy(item["inputSchema"]),
                handler=dispatch,
                available=True,
                publishers=frozenset({"internal-plugin", "external-mcp"}),
                access=access,
                namespace="engraphis",
                grant_eligible=name not in {
                    "engraphis_conflict_review", "engraphis_session",
                },
                grant_profiles=(
                    frozenset({"thinkgraph", "builder"}) if name == "engraphis_retire"
                    else frozenset({"thinkgraph"})
                    if name in {"engraphis_update_memory", "engraphis_add_thinks", "engraphis_correct"} else frozenset()
                ),
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
        definitions.append(OperationDefinition(
            canonical_id="engraphis_retire_relationship", namespace="engraphis", available=True,
            title="Retire one ThinkGraph relationship",
            description="Remove one exact incorrect ThinkGraph edge from the active graph, preserving its history, "
                "both Entities and their Thinks. Use only for an explicit request to remove that relationship.",
            parameters_schema={"type": "object", "additionalProperties": False,
                "required": ["edge_id", "confirmed"], "properties": {
                    "edge_id": {"type": "string", "minLength": 1},
                    "confirmed": {"type": "boolean", "const": True},
                }},
            handler=retire_relationship_operation, access="write", grant_eligible=True,
            grant_profiles=frozenset({"thinkgraph", "builder"}),
            annotations={"readOnlyHint": False, "destructiveHint": True,
                         "idempotentHint": False, "openWorldHint": False},
            publishers=frozenset({"internal-plugin", "external-mcp"}),
            dispatcher_context_arguments=frozenset({"projectId"}),
        ))
        definitions.append(OperationDefinition(
            canonical_id="engraphis_research", namespace="engraphis", available=True,
            title="Claim or finish a Think research request",
            description="Operate on one exact Think research request in the authorized Project. "
                "Claim before research; only claimed=true grants this attempt and returns a claimToken. "
                "Pass its origin Think ID, version and claim token to graphiti.add_know. "
                "Complete discovers and validates already saved Knows for that request, including recovery "
                "after a failed acknowledgement; never resave findings merely to finish. "
                "Blocked/inconclusive require the claim token and a reason. No action launches an agent.",
            parameters_schema={"type": "object", "additionalProperties": False,
                "required": ["action", "think_id", "request_version"], "properties": {
                    "action": {"type": "string", "enum": ["claim", "complete", "blocked", "inconclusive"]},
                    "think_id": {"type": "string", "minLength": 1},
                    "request_version": {"type": "integer", "minimum": 1},
                    "claim_token": {"type": "string"}, "reason": {"type": "string", "maxLength": 4000},
                }},
            handler=research_request_operation, access="write", grant_eligible=True,
            grant_profiles=frozenset({"knowgraph"}),
            annotations={"readOnlyHint": False, "destructiveHint": False,
                         "idempotentHint": True, "openWorldHint": False},
            publishers=frozenset({"internal-plugin", "external-mcp"}),
            dispatcher_context_arguments=frozenset({"projectId"}),
        ))
        OPERATION_DEFINITIONS = tuple(definitions)
        return list(OPERATION_DEFINITIONS)


def _research_service_call(project: str, method: str, *args, **kwargs):
    from engraphis.service_context import bind_service
    service = get_service(project)
    with bind_service(service, principal=project_principal(project)):
        return getattr(service, method)(*args, workspace=project, **kwargs)


async def retire_relationship_operation(*, projectId: str, edge_id: str, confirmed: bool) -> dict:
    if confirmed is not True:
        raise ValueError("explicit_relationship_removal_confirmation_required")
    result = await asyncio.to_thread(private_operation, projectId, "retire_relationship", {"edgeId": edge_id})
    from app.backend_operation_transport import notify_graph_changed
    await asyncio.to_thread(notify_graph_changed, projectId, project_principal(projectId)["id"], "thinkgraph")
    return result


async def research_request_operation(*, projectId: str, action: str, think_id: str,
                                     request_version: int, claim_token: str = "", reason: str = "") -> dict:
    project = project_id(projectId)
    if action == "claim":
        result = await asyncio.to_thread(_research_service_call, project, "claim_think_research",
                                         think_id, version=request_version)
    elif action in {"complete", "blocked", "inconclusive"}:
        ids: list[str] = []
        if action == "complete":
            from app.mcp_graphiti_provider import ensure_graphiti_service, research_result_knows
            await ensure_graphiti_service()
            request = await asyncio.to_thread(_research_service_call, project, "read_think_research", think_id)
            if request["researchRequestVersion"] != request_version:
                raise ValueError("research request version changed")
            knows = await research_result_knows(project, request["researchOriginThinkId"], request_version)
            if not knows:
                raise ValueError("No sourced Know was saved for this research request; it cannot be marked researched")
            ids = [know.uuid for know in knows]
            # Only the host sees this token. Completion recovers committed evidence,
            # not research work, so another run can acknowledge an already saved result.
            def completion_token():
                service = get_service(project)
                with SERVICE_LOCK:
                    memory = service.store.get_memory(request["thinkId"])
                    return memory.metadata["structured_extraction"]["think"].get("researchClaimToken", "")
            claim_token = await asyncio.to_thread(completion_token)
        result = await asyncio.to_thread(_research_service_call, project, "finish_think_research",
            think_id, version=request_version, claim_token=claim_token,
            state="researched" if action == "complete" else action, know_ids=ids, reason=reason)
    else:
        raise ValueError("invalid research action")
    if result.get("claimed") or result.get("changed") or action == "complete":
        from app.backend_operation_transport import notify_graph_changed
        try:
            await asyncio.to_thread(notify_graph_changed, project, project_principal(project)["id"], "thinkgraph")
        except Exception as error:
            # The claim/state is committed. Never lose the returned claim token
            # or misreport a saved result because presentation delivery failed.
            result["notificationError"] = str(error)
    return result


async def invoke_tool(project: str, name: str, arguments: dict) -> dict:
    # Service creation can load embeddings; keep it off the HTTP event loop.
    return await asyncio.to_thread(_invoke_tool_sync, project, name, arguments)


def _invoke_tool_sync(project: str, name: str, arguments: dict) -> dict:
    # MCP dispatches synchronous handlers on another worker. Holding SERVICE_LOCK
    # here deadlocks a handler that resolves its source pair through get_service.
    # Engraphis owns storage transactions; get_service locks its own creation.
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
    if name == "engraphis_add_thinks" and "thinks" in arguments:
        # Foreign-provider and joined canvas references are not Engraphis IDs.
        # Keep the authored subject name; Engraphis owns exact-name reuse/creation.
        arguments["thinks"] = [
            {key: value for key, value in think.items() if key != "entity_id"}
            if str(think.get("entity_id") or "").startswith("knowgraph:")
            or unquote(str(think.get("entity_id") or "")) in (
                f"codegraph:feature:{think.get('entity_name', '')}",
                f"node-name:{think.get('entity_name', '')}",
            )
            else think
            for think in arguments["thinks"]
        ]
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
                # Exact memory reads expose Engraphis's workspace ID. Accept that
                # same Project's ID, never a foreign workspace name or ID.
                with SERVICE_LOCK:
                    workspace = get_service(project).store.conn.execute(
                        "SELECT id FROM workspaces WHERE name=?", (project,),
                    ).fetchone()
                if workspace is None or nested["workspace"] != workspace["id"]:
                    raise ValueError("thinkgraph_scope_is_owned_by_project")
            nested["workspace"] = project
            arguments["arguments"] = nested
    from engraphis.service_context import bind_service
    # Request-local binding; never switch the standalone MCP singleton.
    with bind_service(get_service(project), principal=project_principal(project)):
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
                if name == "engraphis_get_memory":
                    record = data.get("memory", data)
                    if isinstance(record, dict) and isinstance(record.get("metadata"), dict):
                        record["metadata"] = public_think_metadata(record["metadata"])
                if name == "engraphis_recall_context" and (
                    not data.get("semantic_support") or data.get("degraded_mode")
                ):
                    raise RuntimeError("thinkgraph_semantic_search_unavailable")
                if name in {"engraphis_correct", "engraphis_retire"} or (
                    name == "engraphis_execute_action" and data.get("canonical_action") in {"correct", "retire"}
                ):
                    from app.backend_operation_transport import notify_graph_changed
                    await asyncio.to_thread(notify_graph_changed, project, project_principal(project)["id"], "thinkgraph")
                return data
    raise RuntimeError("thinkgraph_result_invalid")


def inspect(project: str, id_field: str, identifier: str) -> dict:
    service = get_service(project)
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
            exact_entities = exact_think_entity_ids(
                service.store,
                workspace_id=workspace_id,
                memory_ids=memory_ids,
            )
            canonical_entity_id = str(entity.get("canonical_id") or identifier)
            for row in direct:
                memory_id = str(row["memory_id"])
                memory = memories.get(memory_id)
                if (
                    memory is None
                    or validated_think_metadata(memory) is None
                    or exact_entities.get(memory_id) != canonical_entity_id
                ):
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
    result = service.inspect(identifier, workspace=project, follow_corrections=True)
    identifier = result["memory"]["id"]
    result["memory"]["metadata"] = public_think_metadata(
        service.store.get_memory(identifier).metadata
    )
    memory = service.store.get_memory(identifier)
    result["ownerEntityId"] = exact_think_entity_ids(service.store,
        workspace_id=memory.workspace_id, memory_ids=[identifier]).get(identifier)
    # Preserve directional composite identities from the Engraphis link store.
    # The public inspector has already authorized the neighboring records.
    neighbors = {link["id"] for link in result["links"]}
    result["relationships"] = [link for link in service.store.get_links(identifier)
        if (link["b"] if link["a"] == identifier else link["a"]) in neighbors]
    return result


def private_operation(project: str, operation: str, arguments: dict) -> dict | list[dict]:
    """Application operations; selected exact actions also have scoped granted wrappers."""
    project = project_id(project)
    if operation == "conversation":
        from .conversations import conversation_operation
        return conversation_operation(project, str(arguments.get("action") or ""), arguments)
    if operation == "source_exchanges":
        from .conversations import read_source_exchanges
        if "memoryId" not in arguments or set(arguments) - {"memoryId", "includeExchange"} or not isinstance(arguments.get("includeExchange", False), bool):
            raise ValueError("source_memory_reference_required")
        return read_source_exchanges(project, str(arguments["memoryId"]), include_exchange=arguments.get("includeExchange", False))
    if operation == "search_sources":
        from .conversations import search_source_exchanges
        return search_source_exchanges(project, arguments.get("query"), arguments.get("limit", 5))
    if operation == "index_sources":
        from .conversations import index_source_exchanges
        return index_source_exchanges(project, arguments.get("conversationId"))
    if operation == "prepare_conversation_pair":
        from .conversations import read_pair
        from .thinkgraph_completed_pair_preparation import prepare_completed_pair
        source = read_pair(project, arguments.get("conversationId"),
                           arguments.get("userMessageIds"), arguments.get("assistantMessageId"))
        preparation = prepare_completed_pair(source)
        from .conversations import register_source_pair
        register_source_pair(project, preparation["pairReference"], source["sourceReferences"][0])
        return {"source": source, "preparation": preparation}
    if operation == "retire":
        if set(arguments) != {"memoryId"}:
            raise ValueError("engraphis_memory_reference_invalid")
        memory_id = str(arguments.get("memoryId") or "")
        with SERVICE_LOCK:
            return get_service(project).retire(memory_id, workspace=project,
                reason="Removed in ThinkGraph", actor="user")
    if operation == "retire_relationship":
        if set(arguments) != {"edgeId"}:
            raise ValueError("engraphis_relationship_reference_invalid")
        edge_id = str(arguments.get("edgeId") or "").strip()
        if not edge_id:
            raise ValueError("engraphis_relationship_reference_invalid")
        with SERVICE_LOCK:
            service = get_service(project)
            workspace = service.store.conn.execute(
                "SELECT id FROM workspaces WHERE name=?",
                (project,),
            ).fetchone()
            if workspace is None:
                raise ValueError("engraphis_relationship_not_found")
            edge = service.store.conn.execute(
                "SELECT id FROM edges WHERE id=? AND workspace_id=? "
                "AND valid_to IS NULL AND expired_at IS NULL",
                (edge_id, str(workspace["id"])),
            ).fetchone()
            if edge is None:
                raise ValueError("engraphis_relationship_not_found")
            service.store.invalidate_edge(edge_id)
            return {"ok": True, "edgeId": edge_id, "operation": "retire"}
    if operation == "delete_workspace":
        if arguments != {"confirmed": True}:
            raise ValueError("thinkgraph_workspace_delete_requires_confirmation")
        with SERVICE_LOCK:
            return get_service(project).delete_workspace(project)
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
