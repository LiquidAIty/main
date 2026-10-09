"""The one official Python MCP host composition and executable entrypoint."""
from __future__ import annotations

import asyncio
import os
import sys
import tomllib
from typing import Any

_PACKAGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(os.path.dirname(_PACKAGE_ROOT))
if _PACKAGE_ROOT not in sys.path:
    sys.path.insert(0, _PACKAGE_ROOT)

from app.python_models.provider_config import ensure_env_loaded
ensure_env_loaded()

from app import mcp_catalog_runtime, mcp_request_dispatch, mcp_transport
from mcp.server.lowlevel.server import NotificationOptions, Server
from mcp.types import CallToolRequestParams, CallToolResult, ListResourcesResult, ListToolsResult, PaginatedRequestParams

MCP_TRANSPORT = os.environ.get("MCP_TRANSPORT", "stdio").strip().lower()
_PUBLIC_MCP_NAME = "LiquidAIty"

def _hermes_package_version() -> str:
    try:
        with open(os.path.join(_REPO_ROOT, "HermesLatest", "pyproject.toml"), "rb") as package_file:
            package = tomllib.load(package_file)
        version = str((package.get("project") or {}).get("version") or "").strip()
        return version or "unknown"
    except (OSError, ValueError, TypeError):
        return "unknown"

_MCP_IMPLEMENTATION_VERSION = _hermes_package_version()
_PUBLIC_MCP_DESCRIPTION = (
    "Connect ChatGPT to LiquidAIty projects, saved agent cards, CodeGraph, "
    "ThinkGraph, KnowGraph, and supported agent runtimes. "
    "Start with main.context to resolve the authenticated Main conversation and project scope. "
    "Use the currently published tool names and schemas; preserve returned provider IDs and provenance. "
    "Saved Cards own their configuration and granted capabilities. "
    "An accepted operation is not proof of completion; use its returned status and evidence."
)

class ToolChangeNotificationServer(Server):
    def create_initialization_options(self, notification_options: NotificationOptions | None = None,
        experimental_capabilities: dict[str, dict[str, Any]] | None = None,
        extensions: dict[str, dict[str, Any]] | None = None):
        return super().create_initialization_options(
            notification_options or NotificationOptions(tools_changed=True),
            experimental_capabilities, extensions,
        )

async def _server_list_resources(_context: Any, _params: PaginatedRequestParams | None) -> ListResourcesResult:
    return ListResourcesResult(resources=await mcp_request_dispatch.list_resources())

async def _server_list_tools(_context: Any, _params: PaginatedRequestParams | None) -> ListToolsResult:
    return ListToolsResult(tools=await mcp_catalog_runtime.list_tools())

async def _server_call_tool(_context: Any, params: CallToolRequestParams) -> CallToolResult:
    result = await mcp_request_dispatch.call_tool(params.name, dict(params.arguments or {}))
    if isinstance(result, CallToolResult):
        return result
    if isinstance(result, list):
        return CallToolResult(content=result)
    raise RuntimeError(f"mcp_tool_result_invalid:{params.name}")

server = ToolChangeNotificationServer(
    _PUBLIC_MCP_NAME, version=_MCP_IMPLEMENTATION_VERSION,
    description=_PUBLIC_MCP_DESCRIPTION, instructions=_PUBLIC_MCP_DESCRIPTION,
    get_tool_input_schema=mcp_catalog_runtime.listed_tool_input_schema,
    on_list_resources=_server_list_resources, on_list_tools=_server_list_tools,
    on_call_tool=_server_call_tool,
)

async def main() -> None:
    if MCP_TRANSPORT == "stdio":
        await mcp_transport.run_stdio(server, _MCP_IMPLEMENTATION_VERSION)
        return
    if MCP_TRANSPORT == "streamable-http":
        await mcp_transport.run_streamable_http(
            server,
            _MCP_IMPLEMENTATION_VERSION,
            _PUBLIC_MCP_NAME,
        )
        return
    raise RuntimeError(f"unsupported_mcp_transport: {MCP_TRANSPORT}")

if __name__ == "__main__":
    asyncio.run(main())
