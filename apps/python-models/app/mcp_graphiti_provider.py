"""Process-owned Graphiti MCP provider lifecycle for the LiquidAIty MCP host."""
# Entity: KnowGraph
# Relationship: This file owns Graphiti provider discovery, lazy Neo4j and model-service initialization, tool dispatch, and shutdown for KnowGraph.
# Entity: MCP Host
# Relationship: This file exposes Graphiti's tool catalog and calls through the application MCP host lifecycle.
# Entity: Tool Catalog
# Relationship: This file supplies the available Graphiti tool descriptors and provider-unavailable state to the host catalog.
# Entity: Credentials
# Relationship: This file reads the configured Graphiti, Neo4j, and OpenRouter credentials needed to initialize the provider.

from __future__ import annotations

import asyncio
import copy
import inspect
import json
import os
from importlib import metadata as importlib_metadata
from typing import Any

from mcp.types import CallToolResult, TextContent, Tool


_GRAPHITI_MODULE: Any | None = None
_GRAPHITI_TOOLS: tuple[Tool, ...] | None = None
_GRAPHITI_UNAVAILABLE: dict[str, Any] | None = None
_GRAPHITI_SERVICE_READY = False
_GRAPHITI_SERVICE_INIT_LOCK = asyncio.Lock()


def graphiti_runtime_versions() -> dict[str, str | None]:
    """Expose resolved Graphiti packages, never an expected or hard-coded pin."""

    def resolved(distribution: str) -> str | None:
        try:
            return importlib_metadata.version(distribution)
        except importlib_metadata.PackageNotFoundError:
            return None

    return {
        "core": resolved("graphiti-core"),
        "mcp": resolved("mcp-server"),
    }


def _graphiti_config():
    """Build the official Graphiti config from the existing authorities."""
    from config.schema import GraphitiConfig

    openrouter_key = os.environ.get("OPENROUTER_API_KEY") or None
    openrouter_url = (
        os.environ.get("OPENROUTER_OPENAI_BASE_URL")
        or os.environ.get("OPENROUTER_BASE_URL")
        or "https://openrouter.ai/api/v1"
    )
    return GraphitiConfig(
        database={
            "provider": "neo4j",
            "providers": {
                "neo4j": {
                    "uri": os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
                    "username": os.environ.get("NEO4J_USER", "neo4j"),
                    "password": os.environ.get("NEO4J_PASSWORD") or None,
                    "database": os.environ.get("NEO4J_DATABASE", "neo4j"),
                }
            },
        },
        llm={
            "provider": "openai",
            "model": os.environ.get(
                "OPENROUTER_DEFAULT_KG_MODEL_KEY",
                os.environ.get("OPENROUTER_DEFAULT_MODEL", "z-ai/glm-5.2"),
            ),
            "providers": {
                "openai": {
                    "api_key": openrouter_key,
                    "api_url": openrouter_url,
                }
            },
        },
        embedder={
            "provider": "openai",
            "model": (
                os.environ.get("GRAPHITI_EMBEDDER_MODEL")
                or os.environ.get("KNOWGRAPH_OPENROUTER_EMBEDDING_MODEL")
                or "openai/text-embedding-3-large"
            ),
            "dimensions": int(
                os.environ.get("KNOWGRAPH_OPENROUTER_EMBEDDING_DIM") or 3072
            ),
            "providers": {
                "openai": {
                    "api_key": openrouter_key,
                    "api_url": openrouter_url,
                }
            },
        },
        graphiti={
            "group_id": "liquidaity",
            "user_id": "liquidaity-mcp",
        },
    )


async def _initialize_graphiti() -> None:
    """Discover the Graphiti catalog without opening provider connections."""
    global _GRAPHITI_MODULE, _GRAPHITI_TOOLS
    global _GRAPHITI_UNAVAILABLE
    if _GRAPHITI_TOOLS is not None:
        return
    if not os.environ.get("OPENROUTER_API_KEY", "").strip():
        _GRAPHITI_TOOLS = ()
        _GRAPHITI_UNAVAILABLE = {
            "ok": False,
            "failureCode": "optional_capability_unavailable",
            "errorCategory": "DEPENDENCY_UNAVAILABLE",
            "retryable": False,
            "dependency": "graphiti",
            "detail": "Graphiti provider credentials are not configured.",
        }
        return

    graphiti_module_ref: Any | None = None
    try:
        def load_catalog() -> tuple[Any, tuple[Tool, ...]]:
            # Importing Graphiti loads its provider modules and can take several
            # seconds on Windows. Keep that work with the already-threaded
            # descriptor read so the MCP listener and health routes remain
            # responsive while the provider catalog is initializing.
            import graphiti_mcp_server as graphiti_module

            return graphiti_module, tuple(
                asyncio.run(graphiti_module.mcp.list_tools())
            )

        graphiti_module_ref, tools = await asyncio.to_thread(load_catalog)
        names = [tool.name for tool in tools]
        if len(names) != len(set(names)):
            raise RuntimeError("graphiti_duplicate_tool_name")
    except Exception as error:
        client = (
            getattr(graphiti_module_ref, "graphiti_client", None)
            if graphiti_module_ref is not None else None
        )
        close = getattr(getattr(client, "driver", None), "close", None)
        if callable(close):
            close_result = close()
            if inspect.isawaitable(close_result):
                await close_result
        _GRAPHITI_MODULE = None
        _GRAPHITI_TOOLS = ()
        _GRAPHITI_UNAVAILABLE = {
            "ok": False,
            "failureCode": "optional_capability_unavailable",
            "errorCategory": "DEPENDENCY_UNAVAILABLE",
            "retryable": False,
            "dependency": "graphiti",
            "detail": f"Graphiti initialization failed ({error.__class__.__name__}).",
        }
        return

    _GRAPHITI_MODULE = graphiti_module_ref
    _GRAPHITI_TOOLS = tools
    _GRAPHITI_UNAVAILABLE = None


async def ensure_graphiti_service() -> None:
    """Open Graphiti providers lazily on the first Graphiti tool call."""
    global _GRAPHITI_SERVICE_READY, _GRAPHITI_UNAVAILABLE
    if _GRAPHITI_SERVICE_READY:
        return
    await _initialize_graphiti()
    graphiti_module_ref = _GRAPHITI_MODULE
    if graphiti_module_ref is None:
        detail = (_GRAPHITI_UNAVAILABLE or {}).get(
            "detail", "Graphiti catalog is unavailable."
        )
        raise RuntimeError(f"graphiti_unavailable:{detail}")
    async with _GRAPHITI_SERVICE_INIT_LOCK:
        if _GRAPHITI_SERVICE_READY:
            return
        try:
            graphiti_module_ref.config = _graphiti_config()
            graphiti_module_ref.graphiti_service = graphiti_module_ref.GraphitiService(
                graphiti_module_ref.config, graphiti_module_ref.SEMAPHORE_LIMIT
            )
            graphiti_module_ref.queue_service = graphiti_module_ref.QueueService()
            await graphiti_module_ref.graphiti_service.initialize()
            graphiti_module_ref.graphiti_client = (
                await graphiti_module_ref.graphiti_service.get_client()
            )
            graphiti_module_ref.semaphore = graphiti_module_ref.graphiti_service.semaphore
            await graphiti_module_ref.queue_service.initialize(
                graphiti_module_ref.graphiti_client
            )
        except BaseException as error:
            client = getattr(graphiti_module_ref, "graphiti_client", None)
            close = getattr(getattr(client, "driver", None), "close", None)
            if callable(close):
                close_result = close()
                if inspect.isawaitable(close_result):
                    await close_result
            graphiti_module_ref.graphiti_client = None
            _GRAPHITI_SERVICE_READY = False
            _GRAPHITI_UNAVAILABLE = {
                "ok": False,
                "failureCode": "optional_capability_unavailable",
                "errorCategory": "DEPENDENCY_UNAVAILABLE",
                "retryable": True,
                "dependency": "graphiti",
                "detail": (
                    "Graphiti provider initialization failed "
                    f"({error.__class__.__name__})."
                ),
            }
            if isinstance(error, asyncio.CancelledError):
                raise
            raise RuntimeError(
                f"graphiti_initialization_failed:{error.__class__.__name__}"
            ) from error
        _GRAPHITI_SERVICE_READY = True
        _GRAPHITI_UNAVAILABLE = None


async def graphiti_tools() -> list[Tool]:
    await _initialize_graphiti()
    return list(_GRAPHITI_TOOLS or ())


def graphiti_unavailability() -> dict[str, Any] | None:
    """Return a copy of the current provider availability failure, if any."""
    return copy.deepcopy(_GRAPHITI_UNAVAILABLE)


async def call_graphiti_tool(name: str, arguments: dict[str, Any]) -> Any:
    """Call the initialized provider without owning host timeout or normalization."""
    graphiti_module_ref = _GRAPHITI_MODULE
    if graphiti_module_ref is None:
        raise RuntimeError("graphiti_not_initialized")
    if name == "get_entity_knows":
        from app import mcp_auth
        from graphiti_core.nodes import EntityNode
        from app.python_models.engraphis import read_entity_think_context
        context = mcp_auth.authenticated_project_context() or mcp_auth.internal_mcp_principal() or {}
        project = str(context.get("projectId") or "")
        group = arguments.get("group_id")
        if not project or group != f"liquidaity-{project}":
            raise PermissionError("know_project_scope_mismatch")
        client = graphiti_module_ref.graphiti_client
        entity_id, entity_name = arguments.get("entity_uuid"), arguments.get("entity_name")
        if entity_id:
            owner = await EntityNode.get_by_uuid(client.driver, entity_id)
            if owner.group_id != group or (entity_name and owner.name != entity_name):
                raise ValueError("Entity identity does not match this Project")
            entity_name = owner.name
        elif entity_name:
            rows, _, _ = await client.driver.execute_query(
                'MATCH (e:Entity {group_id:$group,name:$name}) RETURN e.uuid AS uuid LIMIT 2',
                group=group, name=entity_name, routing_='r')
            if len(rows) > 1:
                raise ValueError("Entity name is ambiguous")
            entity_id = rows[0]['uuid'] if rows else None
        else:
            raise ValueError("Provide entity_uuid or an exact entity_name")
        knows = await client.get_entity_knows(entity_id, group_id=group,
            limit=arguments.get("max_knows", 10)) if entity_id else []
        requests = await asyncio.to_thread(read_entity_think_context, project, entity_name)
        payload = {"message": f"Found {len(knows)} Knows for {entity_name}",
                   "entity_name": entity_name, "entity_uuid": entity_id,
                   "knows": [graphiti_module_ref._know_result(know) for know in knows], **requests}
        return CallToolResult(content=[TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
                              structuredContent={"result": payload})
    if name in {"add_know", "update_know", "remove_know", "delete_entity_edge"}:
        from app import mcp_auth
        from graphiti_core.knows import KnowCitation, KnowDirection
        from graphiti_core.utils.datetime_utils import utc_now

        context = mcp_auth.authenticated_project_context() or {}
        principal = mcp_auth.internal_mcp_principal() or {}
        project_id = str(context.get("projectId") or principal.get("projectId") or "")
        if not project_id or arguments.get("group_id") != f"liquidaity-{project_id}":
            raise PermissionError("know_project_scope_mismatch")
        args = dict(arguments)
        claim_token = args.pop("research_claim_token", None)
        if name == "add_know" and (args.get("research_origin_think_id") or args.get("research_request_version") or claim_token):
            from app.python_models.engraphis_operations import _research_service_call
            request = await asyncio.to_thread(_research_service_call, project_id,
                "validate_think_research_claim", args.get("research_origin_think_id"),
                version=args.get("research_request_version"), claim_token=claim_token)
            args["research_origin_think_id"] = request["researchOriginThinkId"]
        if args.get("citation") is not None:
            args["citation"] = KnowCitation.model_validate(args["citation"])
        if args.get("direction"):
            args["direction"] = KnowDirection.model_validate(args["direction"])
        if name != "add_know":
            if name == "update_know":
                know = await graphiti_module_ref.graphiti_client.update_know(**args)
                payload = {"status": "completed", "know_uuid": know.uuid,
                           "know": graphiti_module_ref._know_result(know), "message": "Know updated in place."}
            elif name == "remove_know":
                await graphiti_module_ref.graphiti_client.remove_know(**args)
                payload = {"status": "completed", "know_uuid": args["uuid"], "message": "Know removed."}
            else:
                result = await graphiti_module_ref.delete_entity_edge(**args)
                if result.get("error"):
                    raise ValueError(result["error"])
                payload = {"status": "completed", "relationship_uuid": args["uuid"], "message": result["message"]}
            await _notify_know_change(project_id, payload)
            return CallToolResult(
                content=[TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
                structuredContent={"result": payload}, isError=payload["status"] != "completed",
            )
        args["reference_time"] = utc_now()
        written = await graphiti_module_ref.graphiti_client.add_know(**args)
        payload = {
            "status": "completed", "know_uuid": written.know.uuid,
            "message": "Know stored." if written.created else "Know already exists.",
            "content_hash": written.know.content_hash,
            "group_id": written.know.group_id,
            "entity_name": written.entity.name,
            "entity_uuid": written.know.entity_uuid,
            "created": written.created, "entity_created": written.entity_created,
            "relationships": [edge.uuid for edge in written.relationships],
        }
        try:
            if args.get("relationships"):
                # A duplicate write can be retrying a prior partial settlement.
                # Existing edge IDs stay stable; Jev itself reuses current decisions.
                payload["relationships"] = list(written.know.entity_edges)
                payload["jev"] = await _settle_research_relationships(project_id, written.know.uuid)
                if payload["jev"].get("status") not in {"success", "current"}:
                    payload["status"] = "partial"
            else:
                payload["jev"] = {"status": "not_applicable", "classified_fact_count": 0}
        except Exception as error:
            payload.update(status="partial", error=str(error))
        await _notify_know_change(project_id, payload)
        if payload["status"] != "completed":
            payload["message"] = "Know stored; relationship settlement or graph notification is incomplete."
        # Keep outcome and repair details ahead of the long evidence record in
        # bounded Hermes tool output. The exact Know remains available unchanged.
        payload["know"] = graphiti_module_ref._know_result(written.know)
        return CallToolResult(
            content=[TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
            structuredContent={"result": payload}, isError=payload["status"] != "completed",
        )
    return await graphiti_module_ref.mcp.call_tool(name, dict(arguments))


async def research_result_knows(project: str, think_id: str, version: int):
    """Recover only committed source-backed results of this exact request version."""
    from graphiti_core.knows import KnowNode
    from graphiti_core.edges import EntityEdge
    from app.python_models.knowgraph_know_contract import know_from_properties
    client = _GRAPHITI_MODULE.graphiti_client
    knows = await KnowNode.get_by_research_origin(client.driver, group_id=f"liquidaity-{project}",
                                                 think_id=think_id, version=version)
    for know in knows:
        if know_from_properties(know._properties()) is None:
            raise ValueError("Saved research result has no valid sourced Know")
        for edge_id in know.entity_edges:
            edge = await EntityEdge.get_by_uuid(client.driver, edge_id)
            if edge.group_id != know.group_id or not edge.attributes.get("jev_relation_winner"):
                raise ValueError("Saved Know relationship still needs settlement; keep the existing Know and retry settlement")
    return knows


async def _notify_know_change(project_id: str, payload: dict) -> None:
    try:
        from app.backend_operation_transport import notify_graph_changed
        from app.python_models.engraphis import project_principal
        await asyncio.to_thread(
            notify_graph_changed, project_id, project_principal(project_id)["id"], "knowgraph",
        )
    except Exception as error:
        payload.update(status="partial", visibility="notification_failed", notificationError=str(error))


async def _settle_research_relationships(project_id: str, know_id: str) -> dict[str, Any]:
    """Classify explicit, Know-supported relationships through the existing Jev owner."""
    import httpx
    from app import mcp_auth

    origin = os.environ.get("KNOWGRAPH_URL", "http://127.0.0.1:8001").rstrip("/")
    async with httpx.AsyncClient(timeout=300, follow_redirects=False) as client:
        response = await client.post(
            origin + "/research/settle",
            headers={"X-LiquidAIty-Internal-MCP-Secret": mcp_auth.INTERNAL_MCP_SECRET},
            json={"project_id": project_id, "know_uuid": know_id},
        )
        response.raise_for_status()
        return response.json()


async def close_graphiti() -> None:
    global _GRAPHITI_MODULE, _GRAPHITI_TOOLS
    global _GRAPHITI_UNAVAILABLE
    global _GRAPHITI_SERVICE_READY
    graphiti_module_ref = _GRAPHITI_MODULE
    _GRAPHITI_MODULE = None
    _GRAPHITI_TOOLS = None
    _GRAPHITI_UNAVAILABLE = None
    _GRAPHITI_SERVICE_READY = False
    client = (
        getattr(graphiti_module_ref, "graphiti_client", None)
        if graphiti_module_ref is not None else None
    )
    driver = getattr(client, "driver", None)
    close = getattr(driver, "close", None)
    if callable(close):
        result = close()
        if inspect.isawaitable(result):
            await result
