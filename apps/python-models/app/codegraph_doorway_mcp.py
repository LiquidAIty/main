"""codegraph_doorway — restricted MCP doorway for direct_main_audit.

Exposes EXACTLY two READ-ONLY tools — codegraph.status and codegraph.search — as
thin transport to the backend's EXISTING /api/coder/mcp-bridge/codegraph_* handlers
(CBM is the one CodeGraph indexer/writer; the backend stays the single authority).
This is NOT a new CodeGraph service: it reuses those handlers and the same
LIQUIDAITY_BACKEND_URL environment resolution the Harness MCP host uses.

It deliberately exposes NO ThinkGraph writes, KnowGraph writes/reads, card updates,
Mag One calls, run_coder, web search, or any shell/product tool — so a read-only
Coder audit reaches CodeGraph and nothing else. No fallback, no fake results.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

# Same environment resolution as the Harness MCP host (mcp_host.py).
BACKEND = os.environ.get("LIQUIDAITY_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")

server = Server("liquid_aity_codegraph")


def _bridge_sync(path: str, payload: dict[str, Any]) -> str:
    """POST to the backend's existing codegraph mcp-bridge endpoint (loopback)."""
    request = Request(
        f"{BACKEND}/api/coder/mcp-bridge/{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=300) as response:  # noqa: S310 — loopback backend only
            return response.read().decode("utf-8")
    except HTTPError as err:
        try:
            body = err.read().decode("utf-8")
        except Exception:
            body = ""
        return body or json.dumps({"ok": False, "error": f"codegraph_backend_http_{err.code}"})
    except URLError as err:
        return json.dumps({"ok": False, "error": f"codegraph_backend_unreachable: {err.reason}"})


def _tools() -> list[Tool]:
    return [
        Tool(
            name="codegraph.status",
            description=(
                "READ-ONLY CodeGraph/CBM index freshness and project status. CBM remains the "
                "only CodeGraph writer/indexer."
            ),
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="codegraph.search",
            description=(
                "READ-ONLY structural code search through the CBM index: symbols, definitions, "
                "and structure with qualified names usable for deeper tracing. No writes, no "
                "indexing authority."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "required": ["query"],
            },
        ),
    ]


async def _dispatch(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    args = arguments or {}
    if name == "codegraph.status":
        text = await asyncio.to_thread(_bridge_sync, "codegraph_status", {})
        return [TextContent(type="text", text=text)]
    if name == "codegraph.search":
        payload = {"query": args.get("query"), "limit": args.get("limit")}
        text = await asyncio.to_thread(_bridge_sync, "codegraph_search", payload)
        return [TextContent(type="text", text=text)]
    return [TextContent(type="text", text=json.dumps({"ok": False, "error": f"unknown_tool: {name}"}))]


@server.list_tools()
async def list_tools() -> list[Tool]:
    return _tools()


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    return await _dispatch(name, arguments)


async def main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
