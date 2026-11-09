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
    if name == "add_know":
        from app import mcp_auth
        from graphiti_core.knows import KnowCitation, KnowDirection
        from graphiti_core.utils.datetime_utils import utc_now

        context = mcp_auth.authenticated_project_context() or {}
        principal = mcp_auth.internal_mcp_principal() or {}
        project_id = str(context.get("projectId") or principal.get("projectId") or "")
        if not project_id or arguments.get("group_id") != f"liquidaity-{project_id}":
            raise PermissionError("know_project_scope_mismatch")
        args = dict(arguments)
        args["citation"] = KnowCitation.model_validate(args["citation"])
        if args.get("direction"):
            args["direction"] = KnowDirection.model_validate(args["direction"])
        args["reference_time"] = utc_now()
        written = await graphiti_module_ref.graphiti_client.add_know(**args)
        payload = {
            "status": "completed", "know_uuid": written.know.uuid,
            "message": "Know stored." if written.created else "Know already exists.",
            "content_hash": written.know.content_hash,
            "group_id": written.know.group_id,
            "entity_name": args["entity_name"],
            "entity_uuid": written.know.entity_uuid,
            "know": graphiti_module_ref._know_result(written.know),
            "created": written.created, "entity_created": written.entity_created,
            "relationships": [edge.uuid for edge in written.relationships],
        }
        try:
            if written.relationships:
                payload["jev"] = await _settle_research_relationships(project_id, written.know.uuid)
                if payload["jev"].get("status") not in {"success", "current"}:
                    payload["status"] = "partial"
            else:
                payload["jev"] = {"status": "not_applicable", "classified_fact_count": 0}
        except Exception as error:
            payload.update(status="partial", error=str(error))
        try:
            from app.backend_operation_transport import notify_graph_changed
            from app.python_models.engraphis import project_principal
            await asyncio.to_thread(
                notify_graph_changed, project_id, project_principal(project_id)["id"], "knowgraph",
            )
        except Exception as error:
            payload.update(status="partial", visibility="notification_failed", notificationError=str(error))
        if payload["status"] != "completed":
            payload["message"] = "Know stored; relationship settlement or graph notification is incomplete."
        return CallToolResult(
            content=[TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
            structuredContent={"result": payload}, isError=payload["status"] != "completed",
        )
    return await graphiti_module_ref.mcp.call_tool(name, dict(arguments))


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
