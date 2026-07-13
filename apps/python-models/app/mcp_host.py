"""LiquidAIty Python MCP host (stdio) — THE one MCP host the Harness launches.

Launch shape: localcoder/scripts/start-grpc.ts resolves this venv's python.exe
and this file's absolute path from the real repo layout, validates both exist,
and the gRPC Harness (localcoder/src/grpc/server.ts) spawns them as ONE stdio
MCP client for the server's lifetime — before any chat work is accepted. No
env vars, no .env, no per-turn spawn, no fallback host.

Exposes exactly this tool surface:
  * mag_one.describe_connected_agents (read connected, bus-eligible Mag One cards)
  * run_mag_one                      (run native Mag One from the one Hermes
                                      canonical Coder job-folder handoff)
  * thinkgraph.get_graph_slice       (bounded READ-ONLY graph scope)
  * web_search                       (real Tavily search; Search Agent only by grant)
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

ThinkGraph and KnowGraph mutations are explicit Hermes-only grants. The host
transports structured updates to the canonical writers; graph authorities never
appear as cards or conversational agents. The obsolete post-chat pair front door
and apply_live_patch path remain deleted.
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
KNOWGRAPH_QUERY_TIMEOUT_S = float(os.environ.get("KNOWGRAPH_QUERY_TIMEOUT_S", "10"))

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
            name="run_coder_subagent",
            description=(
                "Main Chat only: run one approved coding assignment through the application-owned Coder Router. "
                "The adapter must be named explicitly — claude_code (Claude Code CLI) or codex (OpenAI Codex CLI); "
                "there is no fallback or substitution between adapters. Pass the exact active "
                "project/deck/conversation/parentRunId from LIQUIDAITY_RUNTIME_CONTEXT, the saved Coder card id, "
                "and approvedPrompt bytes. Returns the linked child run, the coder session/thread id, structured "
                "command evidence, and the CoderReport verbatim."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "parentRunId": {"type": "string"},
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "adapter": {"type": "string", "enum": ["claude_code", "codex"]},
                    "approvedPrompt": {"type": "string"},
                },
                "required": ["parentRunId", "projectId", "deckId", "conversationId", "cardId", "adapter", "approvedPrompt"],
            },
        ),
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
                "Main Chat only: submit an existing finalized job folder through the bus control input. "
                "The job is identified by jobId/projectId/deckId; Mag One reads the exact bytes of "
                "handoff/<jobId>/prompt.md and writes real artifacts under returns/<jobId>/. "
                "Supporting files may accompany prompt.md. The prompt file is the final start signal. "
                "The backend resolves the live worker roster from blue SIDE connections; never type "
                "a roster. Execute only on an explicit user request — Hermes never launches Mag One."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "jobId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "parentContext": {
                        "type": "object",
                        "description": "Inherited Main Chat review context for Hermes only; never Mag One task input.",
                    },
                },
                "required": ["jobId", "projectId", "deckId"],
            },
        ),
        Tool(
            name="write_mag_one_instructions",
            description=(
                "Main Chat finalization / approved Coder handoff: write the EXACT Mag One task into handoff/<run-id>/prompt.md "
                "in the trusted active Coder workspace, and assign returns/<run-id>/ as the run's "
                "result folder. Supply `instructions` (the exact run-specific text Mag One receives — not "
                "summarized/wrapped/rewritten, and not durable card constants) and optionally `runId` to reuse an existing handoff. "
                "Only Main Chat owns the final prompt.md; Hermes may prepare supporting files but never calls this finalization tool. "
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
            name="thinkgraph.submit_update",
            description=(
                "Hermes only: submit ONE bounded structured ThinkGraph update (resources / "
                "relations / statements — decisions, constraints, uncertainty, questions, "
                "provenance links). The canonical backend writer validates the structure and "
                "applies it under server-minted Hermes-card authority; there is no raw Cypher "
                "and no model-supplied authority. Pass your real conversationId for provenance."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "resources": {"type": "array", "items": {"type": "object"}},
                    "relations": {"type": "array", "items": {"type": "object"}},
                    "statements": {"type": "array", "items": {"type": "object"}},
                },
                "required": ["projectId", "conversationId"],
            },
        ),
        Tool(
            name="knowgraph.query",
            description=(
                "READ-ONLY grounded knowledge retrieval from KnowGraph (Neo4j): sourced claims, "
                "entities, relationships, conflicts, and provenance via exact + full-text + "
                "vector retrieval. Returns real stored evidence only. An empty/unseeded graph "
                "returns assertions/evidence empty; an unreachable or timed-out graph returns an "
                "honest error, never fabricated context. Do not retry a terminal empty/error result."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "query": {"type": "string"},
                    "anchors": {"type": "array", "items": {"type": "string"}},
                    "maxResults": {"type": "integer"},
                },
                "required": ["projectId", "query"],
            },
        ),
        Tool(
            name="knowgraph.ingest",
            description=(
                "Hermes only: ingest REAL source material into KnowGraph through the existing "
                "Neo/Python extraction pipeline (chunking, extraction prompts, entity/relationship "
                "extraction, provenance, Neo4j writes). Each document must carry real source text "
                "plus source metadata (source_url/title/fetched_at/document_id). Never invent "
                "sources; never ingest model speculation."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "documents": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "document_id": {"type": "string"},
                                "text": {"type": "string"},
                                "title": {"type": "string"},
                                "source_url": {"type": "string"},
                                "fetched_at": {"type": "string"},
                                "snippet": {"type": "string"},
                                "metadata": {"type": "object"},
                            },
                            "required": ["text"],
                        },
                    },
                    "researchFocus": {"type": "object"},
                },
                "required": ["projectId", "documents"],
            },
        ),
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
                "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}},
                "required": ["query"],
            },
        ),
        Tool(
            name="hermes.memory_read",
            description=(
                "Hermes only: read your project-scoped SQL memory (private steward continuity — "
                "prior judgments, patterns, draft state). Omit key to list recent items."
            ),
            inputSchema={
                "type": "object",
                "properties": {"projectId": {"type": "string"}, "key": {"type": "string"}},
                "required": ["projectId"],
            },
        ),
        Tool(
            name="hermes.memory_write",
            description=(
                "Hermes only: upsert one key/value item in your project-scoped SQL memory. "
                "Separate from ThinkGraph — this is your private continuity, not shared project "
                "reasoning."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "key": {"type": "string"},
                    "value": {},
                },
                "required": ["projectId", "key", "value"],
            },
        ),
        Tool(
            name="web_search",
            description=(
                "Search the live web through Tavily and return real URLs, titles, domains, "
                "content excerpts, and available dates. Read-only; never fabricates sources."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_results": {"type": "integer", "default": 5},
                },
                "required": ["query"],
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
    "run_coder_subagent": {"parentRunId", "projectId", "deckId", "conversationId", "cardId", "adapter", "approvedPrompt"},
    "mag_one.describe_connected_agents": {"projectId", "deckId"},
    "run_mag_one": {"projectId", "deckId", "jobId", "conversationId", "parentContext"},
    "thinkgraph.submit_update": {"projectId", "conversationId", "resources", "relations", "statements"},
    "knowgraph.query": {"projectId", "query", "anchors", "maxResults"},
    "knowgraph.ingest": {"projectId", "documents", "researchFocus"},
    "codegraph.status": set(),
    "codegraph.search": {"query", "limit"},
    "hermes.memory_read": {"projectId", "key"},
    "hermes.memory_write": {"projectId", "key", "value"},
    "write_mag_one_instructions": {"instructions", "runId"},
    "read_model_results": {"runId", "path"},
    "canvas.inspect": {"projectId", "deckId"},
    "card.update_configuration": {"projectId", "deckId", "cardId", "updates"},
    "canvas.upsert_wire": {"projectId", "deckId", "op", "wire"},
    "card.assign_runtime_skill": {"projectId", "deckId", "cardId", "skillId", "skillVersion", "op"},
    "card.assign_data_binding": {"projectId", "deckId", "cardId", "bindingType", "bindingRef", "op"},
    "card.run_assistant_agent": {"projectId", "deckId", "cardId", "correlationId", "conversationId", "input"},
    "thinkgraph.get_graph_slice": {"projectId", "limit"},
    "web_search": {"query", "max_results"},
}

_BRIDGE_PATHS: dict[str, str] = {
    "run_coder_subagent": "run_coder_subagent",
    "mag_one.describe_connected_agents": "describe_connected_agents",
    "run_mag_one": "run_mag_one",
    "thinkgraph.submit_update": "thinkgraph_submit_update",
    "knowgraph.ingest": "knowgraph_ingest",
    "codegraph.status": "codegraph_status",
    "codegraph.search": "codegraph_search",
    "hermes.memory_read": "hermes_memory_read",
    "hermes.memory_write": "hermes_memory_write",
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
    if name == "knowgraph.query":
        # Direct in-process reuse of the ONE proven hybrid retrieval
        # (services/knowgraph via tool_registry) — read-only; honest error when
        # Neo4j or the embedding backend is unavailable.
        try:
            from app.python_models.tool_registry import retrieve_knowgraph_context_tool

            max_results = args.get("maxResults")
            result = await asyncio.wait_for(
                retrieve_knowgraph_context_tool(
                    project_id=str(args.get("projectId") or ""),
                    query=str(args.get("query") or ""),
                    anchors=[str(a) for a in (args.get("anchors") or []) if str(a).strip()],
                    max_results=max_results if isinstance(max_results, int) and max_results > 0 else 12,
                ),
                timeout=KNOWGRAPH_QUERY_TIMEOUT_S,
            )
            return [TextContent(type="text", text=json.dumps({"ok": True, **result}))]
        except asyncio.TimeoutError:
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": "knowgraph_query_timeout"}))]
        except Exception as err:  # noqa: BLE001 — honest tool-level failure
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": f"knowgraph_query_failed: {err}"}))]
    if name == "web_search":
        from app.python_models.web_search import web_search

        result = await web_search(
            query=str(args.get("query") or ""),
            max_results=int(args.get("max_results") or 5),
        )
        return [TextContent(type="text", text=result)]
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
