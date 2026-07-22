"""LiquidAIty Python MCP host (stdio) — THE one MCP host the Harness launches.

Launch shape: localcoder/scripts/start-grpc.ts resolves this venv's python.exe
and this file's absolute path from the real repo layout, validates both exist,
and the gRPC Harness (localcoder/src/grpc/server.ts) spawns them as ONE stdio
MCP client for the server's lifetime — before any chat work is accepted. No
env vars, no .env, no per-turn spawn, no fallback host.

Exposes exactly this tool surface:
  * mag_one.describe_connected_agents (read connected, bus-eligible Mag One cards)
  * run_mag_one                      (Main-only approved submission of an existing
                                      canonical prompt.md through magentic_control)
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

ThinkGraph mutation is an explicit Main Chat grant; KnowGraph ingestion remains
an explicit Hermes-only grant. The host
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
MCP_TRANSPORT = os.environ.get("LIQUIDAITY_MCP_TRANSPORT", "stdio").strip().lower()
HTTP_MCP_HOST = "127.0.0.1"
HTTP_MCP_PORT = int(os.environ.get("LIQUIDAITY_HTTP_MCP_PORT", "8765"))
HTTP_MCP_PATH = "/mcp"
CHATGPT_MAIN = os.environ.get("LIQUIDAITY_MCP_PRINCIPAL", "").strip() == "chatgpt_main"
CHATGPT_MAIN_TOOL_NAMES = {
    "main.context", "main.invoke_hermes", "main.hermes_status",
    "thinkgraph.get_graph_slice", "thinkgraph.submit_update", "knowgraph.query",
    "codegraph.status", "codegraph.search", "canvas.inspect",
    "mag_one.describe_connected_agents", "write_mag_one_instructions", "run_mag_one",
    "read_model_results", "run_coder_subagent",
}

CHATGPT_MAIN_INSTRUCTIONS = """You are the sole human-facing Main for the connected LiquidAIty session. LiquidAIty is the persistent governed system, not a passive tool bag. Start with main.context. Use only the exposed project-scoped capabilities. Never request or expose raw database access, SQL, Cypher, filesystem access, shell, git, credentials, schemas, the Coder terminal, or permission bypasses. Hermes is the grounding boundary before any Coder or Magentic-One execution: call main.invoke_hermes, wait for main.hermes_status to return a report, obtain explicit user approval, and only then dispatch. The external handoff tools load Hermes's report server-side and never accept raw chat as a coding prompt. Report real statuses and failures. Do not claim ChatGPT-to-LiquidAIty end-to-end success until the user performs that test."""

_CHATGPT_MAIN_IDENTITY_ENV = (
    ("projectId", "LIQUIDAITY_MAIN_PROJECT_ID"),
    ("deckId", "LIQUIDAITY_MAIN_DECK_ID"),
    ("conversationId", "LIQUIDAITY_MAIN_CONVERSATION_ID"),
)

# These fields belong to the configured Main session, not to the model-facing
# tool contract. They remain absent from the public schema and allowed arguments.
_CHATGPT_MAIN_SERVER_OWNED_IDENTITY = {
    "codegraph.search": frozenset({"projectId", "conversationId"}),
}

server = Server("liquidaity", instructions=CHATGPT_MAIN_INSTRUCTIONS if CHATGPT_MAIN else None)


def _chatgpt_main_context() -> dict[str, Any]:
    return {
        "ok": True,
        "principal": "chatgpt_main",
        "role": "Main",
        "projectId": os.environ.get("LIQUIDAITY_MAIN_PROJECT_ID", "").strip(),
        "deckId": os.environ.get("LIQUIDAITY_MAIN_DECK_ID", "").strip(),
        "conversationId": os.environ.get("LIQUIDAITY_MAIN_CONVERSATION_ID", "").strip(),
        "configured": all(
            os.environ.get(name, "").strip()
            for name in (
                "LIQUIDAITY_MAIN_PROJECT_ID",
                "LIQUIDAITY_MAIN_DECK_ID",
                "LIQUIDAITY_MAIN_CONVERSATION_ID",
            )
        ),
        "executionBoundary": "Hermes report -> explicit user approval -> existing OpenClaude Coder or Magentic-One route",
    }


def _chatgpt_main_tools(tools: list[Tool]) -> list[Tool]:
    projected = [tool for tool in tools if tool.name in CHATGPT_MAIN_TOOL_NAMES]
    projected.extend([
        Tool(
            name="main.context",
            description="Read the configured LiquidAIty project/deck/conversation identity and governed Main boundary. No secrets.",
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="main.invoke_hermes",
            description="Start the real installed Hermes runtime for one grounded investigation. Returns the server-minted parentRunId used for status and approved execution.",
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "requestedOutcome": {"type": "string"},
                    "focusNodeIds": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["projectId", "conversationId", "requestedOutcome"],
            },
        ),
        Tool(
            name="main.hermes_status",
            description="Read bounded lifecycle status and the governed Hermes report for a prior invocation. Does not expose the Hermes terminal transcript.",
            inputSchema={
                "type": "object",
                "properties": {"parentRunId": {"type": "string"}},
                "required": ["parentRunId"],
            },
        ),
    ])
    for index, tool in enumerate(projected):
        if tool.name == "run_coder_subagent":
            projected[index] = Tool(
                name=tool.name,
                description="After explicit user approval, run the existing OpenClaude Coder route using the active Hermes report as the approved prompt. Raw chat prompt input is not accepted.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "parentRunId": {"type": "string"},
                        "projectId": {"type": "string"},
                        "deckId": {"type": "string"},
                        "conversationId": {"type": "string"},
                        "cardId": {"type": "string"},
                        "adapter": {"type": "string", "enum": ["claude_code"]},
                        "authority": {"type": "string", "enum": ["direct_main_audit", "mag_one_execution"]},
                        "graphViewIds": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["parentRunId", "projectId", "deckId", "conversationId", "cardId", "adapter"],
                },
            )
        elif tool.name == "write_mag_one_instructions":
            projected[index] = Tool(
                name=tool.name,
                description="After explicit user approval, write the active Hermes report unchanged as the Magentic-One job instructions.",
                inputSchema={
                    "type": "object",
                    "properties": {"parentRunId": {"type": "string"}, "runId": {"type": "string"}},
                    "required": ["parentRunId", "runId"],
                },
            )
    return projected


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
    tools = [
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
                    "authority": {"type": "string", "enum": ["direct_main_audit", "mag_one_execution"]},
                    "graphViewIds": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Persisted Graph View ids (canonical, e.g. codegraph:…) to attach. IDs only — the server resolves the persisted views and renders their compact context; never paste view content.",
                    },
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
                "Hermes Run Plan preparation: write the EXACT proposed Mag One task into handoff/<run-id>/prompt.md "
                "in the trusted active Coder workspace, and assign returns/<run-id>/ as the run's "
                "result folder. Supply `instructions` (the exact run-specific text Mag One receives — not "
                "summarized/wrapped/rewritten, and not durable card constants) and optionally `runId` to reuse an existing handoff. "
                "Hermes may call this tool only when Main explicitly asks it to prepare the existing prompt. Main Chat owns presentation, review, and run approval; writing prompt.md never starts Mag One. "
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
                "Main Chat only: submit zero or ONE bounded structured ThinkGraph update after "
                "reviewing the turn or Hermes findings. Required shape: "
                "each resource is {id, label, kind?, properties?}; each relation is {a, b, tag?}; "
                "each statement is {id, subject, predicateTerm, object, rationale?, review?, tag?, properties?}. "
                "Statement subject and object MUST be resource ids in this update or existing project resources; "
                "labels and ids must be short, stable, and never paragraph text. Minimal valid example: "
                "resources:[{id:'investigation:dup-entity',label:'Duplicate entity handling',kind:'question'},"
                "{id:'system:knowgraph',label:'KnowGraph',kind:'system'}], "
                "statements:[{id:'statement:dup-entity-question',subject:'investigation:dup-entity',"
                "predicateTerm:'term:questions',object:'system:knowgraph',rationale:'Verify entity identity merge behavior.',"
                "review:'provisional'}]. To update an investigation, reuse its stable resource id and add only compact "
                "resources/statements. An empty resources/relations/statements payload is an explicit no-op. "
                "Pass real projectId and conversationId; authority/correlation are server-minted. Never store a transcript, "
                "raw tool output, hidden reasoning, or an unchanged generic summary. If validation fails, "
                "return that one error and finish—never retry by guessing another shape."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "resources": {"type": "array", "items": {"type": "object", "required": ["id", "label"], "properties": {"id": {"type": "string"}, "label": {"type": "string"}, "kind": {"type": "string"}, "properties": {"type": "object"}}}},
                    "relations": {"type": "array", "items": {"type": "object", "required": ["a", "b"], "properties": {"a": {"type": "string"}, "b": {"type": "string"}, "tag": {"type": "string"}}}},
                    "statements": {"type": "array", "items": {"type": "object", "required": ["id", "subject", "predicateTerm", "object"], "properties": {"id": {"type": "string"}, "subject": {"type": "string"}, "predicateTerm": {"type": "string"}, "object": {"type": "string"}, "rationale": {"type": "string"}, "review": {"type": "string"}, "tag": {"type": "string"}, "properties": {"type": "object"}}}},
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
                    "conversationId": {"type": "string"},
                    "query": {"type": "string"},
                    "anchors": {"type": "array", "items": {"type": "string"}},
                    "maxResults": {"type": "integer"},
                    "parentViewId": {"type": "string"},
                },
                "required": ["projectId", "conversationId", "query"],
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
            name="knowgraph_analyze_scope",
            description=(
                "Analyze canonical KnowGraph chunks through the Python clean-room text-network engine or the "
                "explicitly requested InfraNodus MCP provider. The request must use knowgraph.analysis.request.v1. "
                "Local analysis stays in Neo4j; external analysis requires external_provider_permission=true."
            ),
            inputSchema={
                "type": "object",
                "properties": {"request": {"type": "object"}},
                "required": ["request"],
            },
        ),
        Tool(
            name="knowgraph_get_analysis",
            description="Get one persisted derived KnowGraph analysis by its stable analysis ID.",
            inputSchema={
                "type": "object",
                "properties": {"analysisId": {"type": "string"}},
                "required": ["analysisId"],
            },
        ),
        Tool(
            name="knowgraph_compare_providers",
            description=(
                "Run Local and InfraNodus over the same ordered canonical source scope and persist a descriptive "
                "comparison. Explicit external-provider permission is required; neither provider is treated as truth."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "request": {"type": "object"},
                    "externalProviderPermission": {"type": "boolean"},
                    "persist": {"type": "boolean"},
                },
                "required": ["request", "externalProviderPermission"],
            },
        ),
        Tool(
            name="knowgraph_get_topics",
            description="Get derived topical communities and main concepts for a persisted analysis.",
            inputSchema={"type": "object", "properties": {"analysisId": {"type": "string"}}, "required": ["analysisId"]},
        ),
        Tool(
            name="knowgraph_get_gateways",
            description="Get derived conceptual gateways for a persisted analysis.",
            inputSchema={"type": "object", "properties": {"analysisId": {"type": "string"}}, "required": ["analysisId"]},
        ),
        Tool(
            name="knowgraph_get_gaps",
            description="Get structural gap candidates; these are derived opportunities, never sourced facts.",
            inputSchema={"type": "object", "properties": {"analysisId": {"type": "string"}}, "required": ["analysisId"]},
        ),
        Tool(
            name="knowgraph_create_analysis_view",
            description=(
                "Create a candidate KnowGraph Graph View over a persisted analysis. The view declares derived "
                "epistemic level, provider, source scope, canonical references, and producing invocation."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "analysisId": {"type": "string"},
                    "projectId": {"type": "string"},
                    "producingInvocation": {"type": "string"},
                    "parentViewId": {"type": "string"},
                },
                "required": ["analysisId", "projectId", "producingInvocation"],
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
            name="hermes.read_report",
            description=(
                "Hermes only: read the current full durable investigation report for the active native "
                "parentRunId before revising it. The server resolves project and conversation identity; "
                "Main Chat receives only the separate bounded report context."
            ),
            inputSchema={
                "type": "object",
                "properties": {"parentRunId": {"type": "string"}},
                "required": ["parentRunId"],
            },
        ),
        Tool(
            name="hermes.write_report",
            description=(
                "Hermes only: create or revise the one durable human-readable investigation report for "
                "the active project conversation. The server resolves project and conversation "
                "identity from parentRunId; never supply them. Include only real stable "
                "ThinkGraph node ids, KnowGraph refs, and CodeGraph refs. On success, return "
                "the completion metadata exactly; do not repeat the report body to Main Chat."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "parentRunId": {"type": "string"},
                    "reportMarkdown": {"type": "string"},
                    "summary": {"type": "string"},
                    "thinkGraphNodeIds": {"type": "array", "items": {"type": "string"}},
                    "knowGraphRefs": {"type": "array", "items": {"type": "string"}},
                    "codeGraphRefs": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["parentRunId", "reportMarkdown", "summary"],
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
            name="worldsignals.capabilities",
            description="Read the live WorldSignals capability and command manifests.",
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="worldsignals.command",
            description="Run one real command from the live WorldSignals command manifest.",
            inputSchema={
                "type": "object",
                "properties": {"command": {"type": "string"}, "arguments": {"type": "object"}},
                "required": ["command"],
            },
        ),
        Tool(
            name="worldsignals.batch",
            description="Run up to twenty real WorldSignals commands through its batch channel.",
            inputSchema={
                "type": "object",
                "properties": {"commands": {"type": "array", "items": {"type": "object"}, "maxItems": 20}},
                "required": ["commands"],
            },
        ),
        Tool(
            name="worldsignals.poll",
            description="Poll completed command results and pending WorldSignals tasks.",
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="worldsignals.stream_events",
            description="Read a bounded set of real-time events from the WorldSignals SSE channel.",
            inputSchema={
                "type": "object",
                "properties": {"max_events": {"type": "integer", "default": 1}, "timeout_seconds": {"type": "integer", "default": 15}},
                "required": [],
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
    return _chatgpt_main_tools(tools) if CHATGPT_MAIN else tools


# Structural allow-list per tool: unexpected keys are rejected honestly, never
# silently forwarded (prevents smuggling prompts/models/patches through the host).
_ALLOWED_KEYS: dict[str, set[str]] = {
    "run_coder_subagent": {"parentRunId", "projectId", "deckId", "conversationId", "cardId", "adapter", "approvedPrompt", "authority", "graphViewIds"},
    "mag_one.describe_connected_agents": {"projectId", "deckId"},
    "run_mag_one": {"projectId", "deckId", "jobId", "conversationId", "parentContext"},
    "thinkgraph.submit_update": {"projectId", "conversationId", "resources", "relations", "statements"},
    "knowgraph.query": {"projectId", "conversationId", "query", "anchors", "maxResults", "parentViewId"},
    "knowgraph.ingest": {"projectId", "documents", "researchFocus"},
    "knowgraph_analyze_scope": {"request"},
    "knowgraph_get_analysis": {"analysisId"},
    "knowgraph_compare_providers": {"request", "externalProviderPermission", "persist"},
    "knowgraph_get_topics": {"analysisId"},
    "knowgraph_get_gateways": {"analysisId"},
    "knowgraph_get_gaps": {"analysisId"},
    "knowgraph_create_analysis_view": {"analysisId", "projectId", "producingInvocation", "parentViewId"},
    "codegraph.status": set(),
    "codegraph.search": {"query", "limit"},
    "hermes.memory_read": {"projectId", "key"},
    "hermes.memory_write": {"projectId", "key", "value"},
    "hermes.read_report": {"parentRunId"},
    "hermes.write_report": {"parentRunId", "reportMarkdown", "summary", "thinkGraphNodeIds", "knowGraphRefs", "codeGraphRefs"},
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
    "worldsignals.capabilities": set(),
    "worldsignals.command": {"command", "arguments"},
    "worldsignals.batch": {"commands"},
    "worldsignals.poll": set(),
    "worldsignals.stream_events": {"max_events", "timeout_seconds"},
    "main.context": set(),
    "main.invoke_hermes": {"projectId", "conversationId", "requestedOutcome", "focusNodeIds"},
    "main.hermes_status": {"parentRunId"},
}

_BRIDGE_PATHS: dict[str, str] = {
    "run_coder_subagent": "run_coder_subagent",
    "mag_one.describe_connected_agents": "describe_connected_agents",
    "run_mag_one": "run_mag_one",
    "thinkgraph.submit_update": "thinkgraph_submit_update",
    "knowgraph.ingest": "knowgraph_ingest",
    "knowgraph_analyze_scope": "knowgraph_analyze_scope",
    "knowgraph_get_analysis": "knowgraph_get_analysis",
    "knowgraph_compare_providers": "knowgraph_compare_providers",
    "knowgraph_get_topics": "knowgraph_get_topics",
    "knowgraph_get_gateways": "knowgraph_get_gateways",
    "knowgraph_get_gaps": "knowgraph_get_gaps",
    "knowgraph_create_analysis_view": "knowgraph_create_analysis_view",
    "codegraph.status": "codegraph_status",
    "codegraph.search": "codegraph_search",
    "hermes.memory_read": "hermes_memory_read",
    "hermes.memory_write": "hermes_memory_write",
    "hermes.read_report": "hermes_read_report",
    "hermes.write_report": "hermes_write_report",
    "main.invoke_hermes": "main_invoke_hermes",
    "main.hermes_status": "main_hermes_status",
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
    if CHATGPT_MAIN and name not in CHATGPT_MAIN_TOOL_NAMES:
        return [TextContent(type="text", text=json.dumps({"ok": False, "error": f"tool_not_granted_to_chatgpt_main: {name}"}))]
    allowed = _ALLOWED_KEYS.get(name)
    if allowed is None:
        return [TextContent(type="text", text=json.dumps({"ok": False, "error": f"unknown_tool: {name}"}))]
    args = arguments or {}
    if CHATGPT_MAIN and name == "write_mag_one_instructions":
        allowed = {"parentRunId", "runId"}
    elif CHATGPT_MAIN and name == "run_coder_subagent":
        allowed = {"parentRunId", "projectId", "deckId", "conversationId", "cardId", "adapter", "authority", "graphViewIds"}
    extra = [k for k in args.keys() if k not in allowed]
    if extra:
        return [
            TextContent(
                type="text",
                text=json.dumps({"ok": False, "error": f"tool_arguments_rejected: {','.join(sorted(extra))}"}),
            )
        ]
    if CHATGPT_MAIN:
        args = dict(args)
        server_owned_identity = _CHATGPT_MAIN_SERVER_OWNED_IDENTITY.get(name, frozenset())
        for field, env_name in _CHATGPT_MAIN_IDENTITY_ENV:
            if field not in allowed and field not in server_owned_identity:
                continue
            configured = os.environ.get(env_name, "").strip()
            if not configured:
                if field in server_owned_identity:
                    return [TextContent(type="text", text=json.dumps({"ok": False, "error": f"chatgpt_main_{field}_unconfigured"}))]
                continue
            supplied = str(args.get(field) or "").strip()
            if supplied and supplied != configured:
                return [TextContent(type="text", text=json.dumps({"ok": False, "error": f"chatgpt_main_{field}_mismatch"}))]
            args[field] = configured
    if name == "main.context":
        return [TextContent(type="text", text=json.dumps(_chatgpt_main_context()))]
    if CHATGPT_MAIN and name in {"run_coder_subagent", "write_mag_one_instructions"}:
        parent_run_id = str(args.get("parentRunId") or "")
        report_text = await asyncio.to_thread(_bridge_sync, "hermes_read_report", {"parentRunId": parent_run_id})
        try:
            report_payload = json.loads(report_text)
        except json.JSONDecodeError:
            report_payload = {}
        report = report_payload.get("report") if isinstance(report_payload, dict) else None
        report_markdown = report.get("reportMarkdown") if isinstance(report, dict) else None
        if not isinstance(report_markdown, str) or not report_markdown.strip():
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": "active_hermes_report_required"}))]
        args = dict(args)
        if name == "run_coder_subagent":
            args["approvedPrompt"] = report_markdown
        else:
            args = {"runId": str(args.get("runId") or ""), "instructions": report_markdown}
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
                    conversation_id=str(args.get("conversationId") or ""),
                    query=str(args.get("query") or ""),
                    anchors=[str(a) for a in (args.get("anchors") or []) if str(a).strip()],
                    max_results=max_results if isinstance(max_results, int) and max_results > 0 else 12,
                    parent_view_id=str(args.get("parentViewId") or "") or None,
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
    if name.startswith("worldsignals."):
        from app.python_models.worldsignals_client import WorldSignalsClient, WorldSignalsError

        client = WorldSignalsClient()
        try:
            if name == "worldsignals.capabilities":
                result = {"capabilities": client.capabilities(), "tools": client.tools()}
            elif name == "worldsignals.command":
                result = client.command(str(args.get("command") or ""), args.get("arguments") or {})
            elif name == "worldsignals.batch":
                result = client.batch(list(args.get("commands") or []))
            else:
                result = client.stream_events(
                    int(args.get("max_events") or 1),
                    int(args.get("timeout_seconds") or 15),
                ) if name == "worldsignals.stream_events" else client.poll()
            return [TextContent(type="text", text=json.dumps({"ok": True, "result": result}))]
        except WorldSignalsError as err:
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": str(err)}))]
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


async def _run_stdio() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


async def _run_streamable_http() -> None:
    import uvicorn
    from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
    from mcp.server.transport_security import TransportSecuritySettings
    from starlette.applications import Starlette
    from starlette.responses import PlainTextResponse

    session_manager = StreamableHTTPSessionManager(
        app=server,
        json_response=True,
        stateless=True,
        security_settings=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

    async def endpoint(scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("path") != HTTP_MCP_PATH:
            await PlainTextResponse("not_found", status_code=404)(scope, receive, send)
            return
        await session_manager.handle_request(scope, receive, send)

    async def lifespan(_app: Starlette):
        async with session_manager.run():
            yield

    http_app = Starlette(lifespan=lifespan)
    http_app.mount("/", endpoint)
    config = uvicorn.Config(
        http_app,
        host=HTTP_MCP_HOST,
        port=HTTP_MCP_PORT,
        log_level="info",
        timeout_keep_alive=75,
    )
    await uvicorn.Server(config).serve()


async def main() -> None:
    if MCP_TRANSPORT == "stdio":
        await _run_stdio()
        return
    if MCP_TRANSPORT == "streamable-http":
        await _run_streamable_http()
        return
    raise RuntimeError(f"unsupported_mcp_transport: {MCP_TRANSPORT}")


if __name__ == "__main__":
    asyncio.run(main())
