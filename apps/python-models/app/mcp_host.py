"""LiquidAIty Python MCP host (stdio) — THE one MCP host the Harness launches.

Replaces the Node workaround host (liquidAItyMcpHost.mjs). Same launch shape:
the gRPC Harness spawns `<LIQUIDAITY_MCP_NODE> <LIQUIDAITY_MCP_HOST>` as one
stdio MCP client, where LIQUIDAITY_MCP_NODE is this venv's python.exe and
LIQUIDAITY_MCP_HOST is this file's absolute path.

Exposes exactly three tools:
  * describe_agent_fabric            (compatibility migration — unchanged contract)
  * execute_visible_flow             (compatibility migration — unchanged contract)
  * thinkgraph.process_conversation_pair   (the ThinkGraph front door)

All tools are thin transport to the backend's existing /api/coder/mcp-bridge/*
endpoints on loopback — the backend remains the single authority for deck state,
conversation store, card resolution, and graph persistence. No product logic,
no semantics, no fallback lives here.
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

BACKEND = os.environ.get("LIQUIDAITY_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")

server = Server("liquidaity")


def _bridge_sync(path: str, payload: dict[str, Any]) -> str:
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
        return body or json.dumps({"ok": False, "error": f"backend_http_{err.code}"})
    except URLError as err:
        return json.dumps({"ok": False, "error": f"backend_unreachable: {err.reason}"})


async def _bridge(path: str, payload: dict[str, Any]) -> list[TextContent]:
    text = await asyncio.to_thread(_bridge_sync, path, payload)
    return [TextContent(type="text", text=text)]


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="describe_agent_fabric",
            description=(
                "Inspect the REAL downstream Agent Fabric before writing an executable plan step: "
                "visible flow catalog, runnable/connected state, and (for the selected flow) connected "
                "agents + roles, tools, models, expected artifacts, needs-input conditions, and "
                "graph-write policy. Do not invent agents, tools, data, or outputs."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "selectedCardId": {"type": "string"},
                },
                "required": ["projectId", "deckId"],
            },
        ),
        Tool(
            name="execute_visible_flow",
            description=(
                "Run the selected visible Agent Builder flow as a mission via the LiquidAIty Python "
                "AutoGen / Mag One runner. No approval boolean — calling this is the execution command. "
                "Returns runId, task updates keyed to the provided plan task IDs, artifacts, evidence, "
                "progress, needs_input (when the flow is not runnable), failure, and provenance."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "taskIds": {"type": "array", "items": {"type": "string"}},
                    "selectedCardId": {"type": "string"},
                    "missionPacket": {"type": "object"},
                    "plan": {"type": "object"},
                },
                "required": ["projectId", "deckId"],
            },
        ),
        Tool(
            name="thinkgraph.process_conversation_pair",
            description=(
                "ThinkGraph front door: process ONE exact completed conversation pair through the "
                "deck's configured ThinkGraph card. Accepts only server-trusted structural references "
                "(project, deck, conversation, exact user/assistant message ids, correlation id) — "
                "never raw prompts, models, cards, tools, patches, or task data. The configured card "
                "decides no_patch vs a compact provenance-backed patch through its own scoped tools."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "userMessageId": {"type": "string"},
                    "assistantMessageId": {"type": "string"},
                    "correlationId": {"type": "string"},
                },
                "required": ["projectId", "conversationId", "userMessageId", "assistantMessageId", "correlationId"],
            },
        ),
    ]


# Structural allow-list per tool: unexpected keys are rejected honestly, never
# silently forwarded (prevents smuggling prompts/models/patches through the host).
_ALLOWED_KEYS: dict[str, set[str]] = {
    "describe_agent_fabric": {"projectId", "deckId", "selectedCardId"},
    "execute_visible_flow": {"projectId", "deckId", "taskIds", "selectedCardId", "missionPacket", "plan"},
    "thinkgraph.process_conversation_pair": {
        "projectId", "deckId", "conversationId", "userMessageId", "assistantMessageId", "correlationId",
    },
}

_BRIDGE_PATHS: dict[str, str] = {
    "describe_agent_fabric": "describe_agent_fabric",
    "execute_visible_flow": "execute_visible_flow",
    "thinkgraph.process_conversation_pair": "thinkgraph_process_pair",
}


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    allowed = _ALLOWED_KEYS.get(name)
    path = _BRIDGE_PATHS.get(name)
    if allowed is None or path is None:
        return [TextContent(type="text", text=json.dumps({"ok": False, "error": f"unknown_tool: {name}"}))]
    args = arguments or {}
    extra = [k for k in args.keys() if k not in allowed]
    if extra:
        return [
            TextContent(
                type="text",
                text=json.dumps({"ok": False, "error": f"tool_arguments_rejected: {','.join(sorted(extra))}"}),
            )
        ]
    return await _bridge(path, args)


async def main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
