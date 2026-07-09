"""LiquidAIty Python MCP host (stdio) — THE one MCP host the Harness launches.

Launch shape: localcoder/scripts/start-grpc.ts resolves this venv's python.exe
and this file's absolute path from the real repo layout, validates both exist,
and the gRPC Harness (localcoder/src/grpc/server.ts) spawns them as ONE stdio
MCP client for the server's lifetime — before any chat work is accepted. No
env vars, no .env, no per-turn spawn, no fallback host.

Exposes exactly this tool surface:
  * mag_one.describe_connected_agents (read the connected, bus-eligible Mag One
                                      Agent Cards + their capabilities before
                                      writing a run_mag_one prompt)
  * run_mag_one                      (run regular native Mag One from a
                                      Harness-authored Markdown orchestration
                                      prompt — used verbatim, no plan/task/gate)
  * thinkgraph.get_graph_slice       (bounded READ-ONLY graph scope)
  * canvas.inspect / card.update_configuration / canvas.upsert_wire /
    card.assign_runtime_skill / card.assign_data_binding /
    card.run_assistant_agent         (user-directed Harness control surface;
                                      handlers live in app.control_plane — Python)

Bridge tools are thin transport to the backend's existing /api/coder/mcp-bridge/*
endpoints on loopback — the backend remains the single authority for deck state,
conversation store, card resolution, and graph persistence. Control tools dispatch
to Python handlers (app/control_plane.py) which own validation/policy and use the
existing backend deck routes + the Python runtime-assignment store. No semantics,
no fallback lives in this host.

There is NO model-facing graph-write tool on this host. Live ThinkGraph writes
happen ONLY inside a real configured ThinkGraph card run: the thin native
doorway calls card.run_assistant_agent, Python runConfiguredCard runs the
ThinkGraph card, and that card's own scoped read_thinkgraph_scope /
apply_thinkgraph_patch tools (authority injected from the trusted card-run
context, never the model) perform the transaction. The obsolete post-chat pair
front door and the model-facing apply_live_patch tool were removed.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

# Bootstrap the package root onto sys.path. The gRPC harness launches this host as a
# SCRIPT (`python .../apps/python-models/app/mcp_host.py`), so sys.path[0] is the
# `app/` dir and the `app` package (rooted at apps/python-models) is NOT importable —
# which broke every `from app...` control handler at call time ("No module named
# 'app'"). Adding the package root here (the ONE launch/bootstrap boundary) makes all
# `app.*` imports resolve, for every tool. Not a per-tool sys.path hack.
_PACKAGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PACKAGE_ROOT not in sys.path:
    sys.path.insert(0, _PACKAGE_ROOT)

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
            name="mag_one.describe_connected_agents",
            description=(
                "Read the currently connected, bus-eligible (magentic_option) Mag One Agent Cards and "
                "their actual capabilities before writing a run_mag_one prompt: cardId, title, "
                "role/capability, selected model, configured Python tools, and connected status. "
                "Read-only and deck-authentic — never invents agents, tools, models, or outputs. "
                "deckId is optional and defaults to the one canonical Agent Canvas deck; never "
                "guess a deckId."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                },
                "required": ["projectId"],
            },
        ),
        Tool(
            name="run_mag_one",
            description=(
                "Run regular native Mag One. Task source is EITHER promptMarkdown OR a Coder "
                "job-folder handoff (jobId). With jobId, the run's task is the EXACT bytes of "
                "handoff/<jobId>/prompt.md, the Magnetic One variable context packet for this run, and its "
                "return surface is returns/<jobId>/ under the server-forced trusted workspace root — "
                "the result reports that returns dir and the files actually written there (honest "
                "no_return_files_created when none). With promptMarkdown, that string IS Mag One's "
                "job, used verbatim. jobId takes precedence so the on-disk file is the contract. "
                "Mag One reasons over the task, selects among connected eligible workers itself, and "
                "returns its result. No structured plan, no task ledger gate, no approval gate. "
                "deckId is optional and defaults to the one canonical Agent Canvas deck; never "
                "guess a deckId."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "promptMarkdown": {"type": "string"},
                    "jobId": {"type": "string"},
                },
                "required": ["projectId"],
            },
        ),
        Tool(
            name="write_mag_one_instructions",
            description=(
                "Local Coder: write EXACT Mag One variable context packet into handoff/<run-id>/prompt.md "
                "in the trusted active Coder workspace, and assign returns/<run-id>/ as the run's "
                "result folder. Supply `instructions` (the exact run-specific text Mag One receives — not "
                "summarized/wrapped/rewritten, and not durable card constants) and optionally `runId` to reuse an existing handoff. "
                "Returns runId + workspace-relative handoff and returns paths. Run run_mag_one with "
                "that runId as jobId to have Mag One read those exact bytes as its task."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "instructions": {"type": "string"},
                    "runId": {"type": "string"},
                },
                "required": ["instructions"],
            },
        ),
        Tool(
            name="read_model_results",
            description=(
                "Local Coder: discover and read model-produced result files under returns/<run-id>/ "
                "in the trusted active Coder workspace. With no runId, lists available return runs. "
                "With a runId and no path, lists that run's actual artifacts. With a runId and a "
                "workspace-return-relative path, reads one artifact — text/code/reports inline; "
                "images/video/PDFs/other binaries as a reference + metadata (never corrupted, never "
                "base64-dumped). Absolute paths and traversal are rejected. Honest empty states: "
                "no_return_runs_found / no_return_files_created / artifact_not_found."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "runId": {"type": "string"},
                    "path": {"type": "string"},
                },
                "required": [],
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
                "exist on this path — extra arguments are rejected structurally. deckId defaults to "
                "the canonical Agent Canvas deck. On the Harness saved-card doorway path, the "
                "server injects projectId/correlationId/conversationId; the model supplies the "
                "bound cardId plus the task input only. conversationId is the real live "
                "conversation this run belongs to, when one exists — card-scoped authority is "
                "minted server-side from it; never invent one."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "correlationId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "input": {"type": "string"},
                },
                "required": ["cardId", "input"],
            },
        ),
    ]


# Structural allow-list per tool: unexpected keys are rejected honestly, never
# silently forwarded (prevents smuggling prompts/models/patches through the host).
_ALLOWED_KEYS: dict[str, set[str]] = {
    "mag_one.describe_connected_agents": {"projectId", "deckId"},
    "run_mag_one": {"projectId", "deckId", "promptMarkdown", "jobId"},
    "write_mag_one_instructions": {"instructions", "runId"},
    "read_model_results": {"runId", "path"},
    "canvas.inspect": {"projectId", "deckId"},
    "card.update_configuration": {"projectId", "deckId", "cardId", "updates"},
    "canvas.upsert_wire": {"projectId", "deckId", "op", "wire"},
    "card.assign_runtime_skill": {"projectId", "deckId", "cardId", "skillId", "skillVersion", "op"},
    "card.assign_data_binding": {"projectId", "deckId", "cardId", "bindingType", "bindingRef", "op"},
    "card.run_assistant_agent": {"projectId", "deckId", "cardId", "correlationId", "conversationId", "input"},
    "thinkgraph.get_graph_slice": {"projectId", "limit"},
}

_BRIDGE_PATHS: dict[str, str] = {
    "mag_one.describe_connected_agents": "describe_connected_agents",
    "run_mag_one": "run_mag_one",
}

# Coder job-folder tools dispatch to the ONE shared Python implementation
# (app.python_models.coder_job_tools) — pure filesystem over the trusted
# workspace, no backend/psycopg dependency. Same functions for both Coder surfaces.
_JOB_TOOL_HANDLERS: dict[str, str] = {
    "write_mag_one_instructions": "write_mag_one_instructions",
    "read_model_results": "read_model_results",
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
    job_handler = _JOB_TOOL_HANDLERS.get(name)
    if job_handler is not None:
        from app.python_models import coder_job_tools

        result = await asyncio.to_thread(getattr(coder_job_tools, job_handler), args)
        return [TextContent(type="text", text=json.dumps(result))]
    return await _bridge(_BRIDGE_PATHS[name], args)


async def main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
