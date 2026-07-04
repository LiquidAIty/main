"""LiquidAIty Python MCP host (stdio) — THE one MCP host the Harness launches.

Replaces the Node workaround host (liquidAItyMcpHost.mjs). Same launch shape:
the gRPC Harness spawns `<LIQUIDAITY_MCP_NODE> <LIQUIDAITY_MCP_HOST>` as one
stdio MCP client, where LIQUIDAITY_MCP_NODE is this venv's python.exe and
LIQUIDAITY_MCP_HOST is this file's absolute path.

Exposes exactly this tool surface:
  * describe_agent_fabric            (compatibility migration — unchanged contract)
  * execute_visible_flow             (compatibility migration — unchanged contract;
                                      this IS the Mag One run capability — Mag One
                                      resolves its own participants from saved
                                      magentic_option wiring, never from callers)
  * thinkgraph.process_conversation_pair   (the ThinkGraph front door)
  * canvas.inspect / card.update_configuration / canvas.upsert_wire /
    card.assign_runtime_skill / card.assign_data_binding /
    card.run_assistant_agent         (user-directed Harness control surface;
                                      handlers live in app.control_plane — Python)

Bridge tools are thin transport to the backend's existing /api/coder/mcp-bridge/*
endpoints on loopback — the backend remains the single authority for deck state,
conversation store, card resolution, and graph persistence. Control tools dispatch
to Python handlers (app/control_plane.py) which own validation/policy and use the
existing backend deck routes + the Python runtime-assignment store. No semantics,
no fallback lives in this host. apply_thinkgraph_patch and raw graph/DB writes are
NEVER exposed here.
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
                "maintains the noun-and-verb graph through its own scoped tools, updating it when the "
                "exchange adds something durable and leaving it unchanged otherwise."
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
        Tool(
            name="canvas.inspect",
            description=(
                "Bounded saved canvas/deck view: cards (id, title, runtime binding/type, tools, "
                "assigned runtime profile, pinned skill versions, data binding references), wires, "
                "and recent run traces. Read-only, project-scoped, no secrets."
            ),
            inputSchema={
                "type": "object",
                "properties": {"projectId": {"type": "string"}, "deckId": {"type": "string"}},
                "required": ["projectId", "deckId"],
            },
        ),
        Tool(
            name="card.update_configuration",
            description=(
                "User-directed strict-allowlist update of one persisted card: prompt, title, "
                "modelKey, provider, temperature, maxTokens, tools. Everything else (runtime code, "
                "shell config, hidden tools, authority grants, worker selection) is rejected."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "updates": {"type": "object"},
                },
                "required": ["projectId", "deckId", "cardId", "updates"],
            },
        ),
        Tool(
            name="canvas.upsert_wire",
            description=(
                "Create/update/remove ONE saved canvas wire. Supported wire types only: 'flow' and "
                "'magentic_option'. A wire is persisted visible configuration — it never runs agents."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "op": {"type": "string", "enum": ["upsert", "remove"]},
                    "wire": {"type": "object"},
                },
                "required": ["projectId", "deckId", "op", "wire"],
            },
        ),
        Tool(
            name="card.assign_runtime_skill",
            description=(
                "Assign (exact version pinned) or remove one PROMOTED, runtime-binding-compatible "
                "runtime skill on a persisted card. Database-backed records only — no Markdown."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "skillId": {"type": "string"},
                    "skillVersion": {"type": "integer"},
                    "op": {"type": "string", "enum": ["assign", "remove"]},
                },
                "required": ["projectId", "deckId", "cardId", "skillId", "op"],
            },
        ),
        Tool(
            name="card.assign_data_binding",
            description=(
                "Assign or remove one bounded data binding (pointer/scope record) on a persisted "
                "card. Arbitrary SQL/Cypher/raw queries are structurally rejected."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "bindingType": {"type": "string"},
                    "bindingRef": {"type": "object"},
                    "op": {"type": "string", "enum": ["assign", "remove"]},
                },
                "required": ["projectId", "deckId", "cardId", "bindingType", "op"],
            },
        ),
        Tool(
            name="thinkgraph.get_graph_slice",
            description=(
                "Bounded READ-ONLY slice of stored ThinkGraph project reasoning (resources, "
                "statements, relations, provenance pointers). No write authority exists here."
            ),
            inputSchema={
                "type": "object",
                "properties": {"projectId": {"type": "string"}, "limit": {"type": "integer"}},
                "required": ["projectId"],
            },
        ),
        Tool(
            name="card.run_assistant_agent",
            description=(
                "Run ONE saved, enabled assistant_agent card with its saved prompt/model/tools and "
                "its assigned profile/skills/data bindings. No prompt/model/tool/card overrides "
                "exist on this path — extra arguments are rejected structurally."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "correlationId": {"type": "string"},
                    "input": {"type": "string"},
                },
                "required": ["projectId", "deckId", "cardId", "correlationId", "input"],
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
    "canvas.inspect": {"projectId", "deckId"},
    "card.update_configuration": {"projectId", "deckId", "cardId", "updates"},
    "canvas.upsert_wire": {"projectId", "deckId", "op", "wire"},
    "card.assign_runtime_skill": {"projectId", "deckId", "cardId", "skillId", "skillVersion", "op"},
    "card.assign_data_binding": {"projectId", "deckId", "cardId", "bindingType", "bindingRef", "op"},
    "card.run_assistant_agent": {"projectId", "deckId", "cardId", "correlationId", "input"},
    "thinkgraph.get_graph_slice": {"projectId", "limit"},
}

_BRIDGE_PATHS: dict[str, str] = {
    "describe_agent_fabric": "describe_agent_fabric",
    "execute_visible_flow": "execute_visible_flow",
    "thinkgraph.process_conversation_pair": "thinkgraph_process_pair",
}

# Control tools dispatch to the Python control-plane handlers (app/control_plane.py).
# Imported lazily so bridge-only usage never requires the psycopg dependency chain.
_CONTROL_HANDLER_NAMES: dict[str, str] = {
    "canvas.inspect": "canvas_inspect",
    "card.update_configuration": "card_update_configuration",
    "canvas.upsert_wire": "canvas_upsert_wire",
    "card.assign_runtime_skill": "card_assign_runtime_skill",
    "card.assign_data_binding": "card_assign_data_binding",
    "card.run_assistant_agent": "card_run_assistant_agent",
    "thinkgraph.get_graph_slice": "thinkgraph_get_graph_slice",
}


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    allowed = _ALLOWED_KEYS.get(name)
    if allowed is None:
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
    handler_name = _CONTROL_HANDLER_NAMES.get(name)
    if handler_name is not None:
        from app import control_plane

        try:
            result = await getattr(control_plane, handler_name)(args)
            return [TextContent(type="text", text=json.dumps(result))]
        except control_plane.ControlPlaneError as err:
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": str(err)}))]
    return await _bridge(_BRIDGE_PATHS[name], args)


async def main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
