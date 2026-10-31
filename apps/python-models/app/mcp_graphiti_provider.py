"""Process-owned Graphiti MCP provider lifecycle for the LiquidAIty MCP host."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: KnowGraph
# Relationship: This file owns Graphiti provider lifecycle and dispatch, installs the research write-validation extension, and projects research provenance on exact Know reads.
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
            from app.python_models.knowgraph_research import ResearchGraphOperations
            graphiti_module_ref.graphiti_client.driver.graph_operations_interface = ResearchGraphOperations()
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
    if name == "add_know":
        from app import mcp_auth
        from app.python_models.project_graph_invocation import CURRENT_GRAPH_INVOCATION
        from app.python_models.knowgraph_research import add_research_know
        principal = mcp_auth.internal_mcp_principal() or {}
        if CURRENT_GRAPH_INVOCATION.get() is not None or principal.get("profile") == "knowgraph":
            try:
                value = await add_research_know(graphiti_module_ref, arguments)
            except ValueError as error:
                if str(error) != "Know UUID is already used by a different episode":
                    raise
                from app.application_tool_error import ApplicationToolError
                raise ApplicationToolError(
                    "know_content_conflict: This UUID already exists with different content. "
                    "The saved Know was not changed. Read it and preserve its exact field values."
                ) from error
            know = value["know"]
            receipt = {
                "message": f"Know {know['uuid']} saved; settlement {value['status']}",
                "know_uuid": know["uuid"], "content_hash": know["content_hash"],
                "group_id": know["group_id"], "entity_name": arguments["entity_name"],
                "entity_uuid": know["entity_uuid"], **value,
            }
            return CallToolResult(
                content=[TextContent(type="text", text=json.dumps(receipt, ensure_ascii=False))],
                structuredContent={"result": receipt}, isError=value["status"] != "completed",
            )
        # Existing explicitly granted non-research callers keep Graphiti's contract.
        # A native KnowGraph turn can never escape its required research scope.
    if name == "get_know":
        from app.python_models.knowgraph_know_contract import know_from_properties
        know = await graphiti_module_ref.graphiti_client.get_know(arguments["uuid"], group_id=arguments.get("group_id"))
        rows, _, _ = await graphiti_module_ref.graphiti_client.driver.execute_query(
            "MATCH (k:Episodic:Know {uuid:$id,group_id:$group}) RETURN properties(k) AS properties",
            id=know.uuid, group=know.group_id, routing_="r")
        projected = know_from_properties(dict(rows[0]["properties"])) if rows else None
        origins = {key: projected[key] for key in ("researchOrigins", "researchOriginCount")
                   if projected and key in projected}
        payload = {"message": f"Found Know {know.uuid}",
                   "know": {**graphiti_module_ref._know_result(know), **origins}}
        return CallToolResult(
            content=[TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
            structuredContent={"result": payload}, isError=False,
        )
    return await graphiti_module_ref.mcp.call_tool(name, dict(arguments))


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
