"""Scoped research through Graphiti's existing queue and mutation extension."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: KnowGraph
# Relationship: This file validates admitted research scope at Graphiti write hooks, submits the native queued Know writer, persists research origins, and reads back completion before notifying the graph UI.
# Entity: Jev Decisions
# Relationship: This file sends persisted Know relationships to the existing web-research settlement endpoint and reports partial results when assessment or notification fails.

from __future__ import annotations

import asyncio
from contextvars import ContextVar
from copy import deepcopy
import json

from graphiti_core.driver.graph_operations.graph_operations import GraphOperationsInterface
from graphiti_core.knows import KnowCitation, KnowDirection, normalize_entity_name
from graphiti_core.models.nodes.node_db_queries import get_entity_node_save_bulk_query, get_episode_node_save_bulk_query
from graphiti_core.models.edges.edge_db_queries import get_entity_edge_save_bulk_query, get_episodic_edge_save_bulk_query

from .project_graph_invocation import CURRENT_GRAPH_INVOCATION, rails_context

_WRITE_SCOPE = ContextVar("knowgraph_research_write", default=None)


def validate_names(scope: dict, nodes: list[dict]) -> None:
    group = "liquidaity-" + scope["projectId"]
    if any(node.get("group_id") != group for node in nodes):
        raise PermissionError("research_graph_scope_mismatch")
    if scope["mode"] == "automatic":
        admitted = {normalize_entity_name(item["canonicalName"]) for item in scope["map"]["entities"]}
        admitted &= set(scope.get("currentNames", admitted))
        if any(normalize_entity_name(node.get("name") or "") not in admitted for node in nodes):
            raise PermissionError("automatic_research_new_entity_name_rejected")


class ResearchGraphOperations(GraphOperationsInterface):
    """Native Cypher stays unchanged; the extension validates before its writes."""

    async def node_save(self, node, driver):
        scope = _WRITE_SCOPE.get()
        if scope:
            validate_names(scope, [node.model_dump()])
        raise NotImplementedError  # Native single-node implementation, after validation.

    async def episodic_node_save_bulk(self, _cls, driver, transaction, nodes):
        await transaction.run(get_episode_node_save_bulk_query(driver.provider), episodes=nodes)

    async def node_save_bulk(self, _cls, driver, transaction, nodes, batch_size=100):
        scope = _WRITE_SCOPE.get()
        if scope:
            validate_names(scope, nodes)
        await transaction.run(get_entity_node_save_bulk_query(driver.provider, nodes), nodes=nodes)

    async def episodic_edge_save_bulk(self, _cls, driver, transaction, edges, batch_size=100):
        await transaction.run(get_episodic_edge_save_bulk_query(driver.provider), episodic_edges=edges)

    async def edge_save_bulk(self, _cls, driver, transaction, edges, batch_size=100):
        scope = _WRITE_SCOPE.get()
        if scope and edges:
            ids = list({edge[key] for edge in edges for key in ("source_node_uuid", "target_node_uuid")})
            result = await transaction.run("MATCH (n:Entity) WHERE n.uuid IN $ids RETURN n.uuid AS uuid,n.name AS name,n.group_id AS group_id", ids=ids)
            nodes = await result.data()
            if {node["uuid"] for node in nodes} != set(ids):
                raise PermissionError("research_relationship_endpoint_missing")
            validate_names(scope, nodes)
        await transaction.run(get_entity_edge_save_bulk_query(driver.provider), entity_edges=edges)


async def add_research_know(module, arguments: dict) -> dict:
    scope = deepcopy(CURRENT_GRAPH_INVOCATION.get())
    if not scope or scope["profile"] != "knowgraph":
        raise PermissionError("research_invocation_required")
    args = dict(arguments)
    expected_group = "liquidaity-" + scope["projectId"]
    if args.get("group_id") != expected_group:
        raise PermissionError("research_graph_scope_mismatch")
    args["citation"] = KnowCitation.model_validate(args["citation"])
    from .knowgraph_know_contract import safe_source_url
    if not safe_source_url(args["citation"].url) or (args["citation"].resolved_url and not safe_source_url(args["citation"].resolved_url)):
        raise ValueError("research_citation_url_invalid")
    if args.get("direction"):
        args["direction"] = KnowDirection.model_validate(args["direction"])
    args["reference_time"] = module.parse_reference_time(args.get("reference_time"))
    args.setdefault("entity_types", module.graphiti_service.entity_types)
    args.setdefault("edge_types", module.graphiti_service.edge_types)
    args.setdefault("edge_type_map", module.graphiti_service.edge_type_map)
    # Supply the actual name vocabulary, not fabricated endpoints or relationships.
    instructions = "Preserve citation text as evidence, not Entity nodes. Never extract URLs, publishers or citation titles as Entities. "
    if scope["mode"] == "automatic":
        instructions += "Use only these existing canonical Entity names; omit other subjects from extraction: " + json.dumps(
            [item["canonicalName"] for item in scope["map"]["entities"]], ensure_ascii=False)
    args["custom_extraction_instructions"] = instructions + "\n" + str(args.get("custom_extraction_instructions") or "")
    future = asyncio.get_running_loop().create_future()
    future.add_done_callback(lambda finished: finished.exception() if not finished.cancelled() else None)

    async def process():
        token = _WRITE_SCOPE.set(scope)
        persisted = None
        try:
            from .engraphis import project_principal
            if project_principal(scope["projectId"])["id"] != scope["ownerUserId"]:
                raise PermissionError("research_project_owner_changed")
            current = await asyncio.to_thread(rails_context, "names", projectId=scope["projectId"], ownerUserId=scope["ownerUserId"])
            current_names = {normalize_entity_name(item["canonicalName"]) for item in current["entities"]}
            scope["currentNames"] = current_names
            if scope["mode"] == "automatic":
                if not {normalize_entity_name(name) for name in scope["entityNames"]} <= current_names:
                    raise PermissionError("research_target_no_longer_current")
                validate_names(scope, [{"name": args["entity_name"], "group_id": expected_group}])
            if args.get("entity_uuid"):
                from graphiti_core.nodes import EntityNode
                from graphiti_core.errors import NodeNotFoundError
                from app.application_tool_error import ApplicationToolError
                try:
                    existing = await EntityNode.get_by_uuid(module.graphiti_client.driver, args["entity_uuid"])
                except NodeNotFoundError:
                    raise ApplicationToolError("graphiti_entity_not_found: entity_uuid must be an existing Graphiti Entity ID, never an Engraphis ID. If the map has no graphitiEntityId for this name, omit entity_uuid and supply the canonical entity_name. Nothing was written.") from None
                if existing.group_id != expected_group:
                    raise PermissionError("research_entity_scope_mismatch")
            result = await module.graphiti_client.add_know(**args)
            persisted = module._know_result(result.know)
            origin = {key: scope[key] for key in ("requestId", "mode", "thinkIds", "entityNames", "focus")}
            rows, _, _ = await module.graphiti_client.driver.execute_query(
                "MATCH (k:Episodic:Know {uuid:$id,group_id:$group}) "
                "SET k.research_origins=CASE WHEN $origin IN coalesce(k.research_origins,[]) "
                "THEN k.research_origins ELSE coalesce(k.research_origins,[])+$origin END RETURN k.uuid AS uuid,k.research_origins AS origins",
                id=result.know.uuid, group=expected_group, origin=json.dumps(origin, ensure_ascii=False, sort_keys=True))
            if len(rows) != 1 or json.dumps(origin, ensure_ascii=False, sort_keys=True) not in rows[0]["origins"]:
                raise RuntimeError("research_origin_readback_missing")
            persisted = {**module._know_result(result.know), "researchOrigins": [origin]}
            jev = await settle_relationships(scope["projectId"], result.know.uuid)
            know = await module.graphiti_client.get_know(result.know.uuid, group_id=expected_group)
            value = {"status": "completed" if jev["status"] in {"success", "current"} else "partial",
                     "know": {**module._know_result(know), "researchOrigins": [origin]}, "jev": jev,
                     "created": result.created, "entity_created": result.entity_created}
        except Exception as error:
            if persisted is not None:
                value = {"status": "partial", "know": persisted, "error": str(error)}
            else:
                future.set_exception(error)
                return
        finally:
            _WRITE_SCOPE.reset(token)
        try:
            await asyncio.to_thread(notify_graph, scope)
        except Exception:
            value.update(status="partial", visibility="notification_failed")
        future.set_result(value)

    await module.queue_service.add_episode_task(expected_group, process)
    return await asyncio.shield(future)


def notify_graph(scope):
    from urllib.request import Request
    from app import mcp_auth
    from app.backend_operation_transport import open_backend_request
    request = Request(mcp_auth.BACKEND + "/api/mcp/graph-changed", method="POST",
        headers={"Content-Type": "application/json", "X-LiquidAIty-Internal-MCP-Secret": mcp_auth.INTERNAL_MCP_SECRET},
        data=json.dumps({"projectId": scope["projectId"], "ownerUserId": scope["ownerUserId"]}).encode())
    with open_backend_request(request, timeout_seconds=10) as response:
        if response.status != 200:
            raise RuntimeError("research_graph_notification_failed")


async def settle_relationships(project_id, know_id):
    import os
    import httpx
    from app import mcp_auth
    async with httpx.AsyncClient(timeout=300, follow_redirects=False) as client:
        response = await client.post(os.environ.get("KNOWGRAPH_URL", "http://127.0.0.1:8001").rstrip("/") + "/research/settle",
            headers={"X-LiquidAIty-Internal-MCP-Secret": mcp_auth.INTERNAL_MCP_SECRET},
            json={"project_id": project_id, "know_uuid": know_id})
        response.raise_for_status()
        return response.json()
