"""dev_agent_harness — the DEV-ONLY MCP server for coding agents.

NOT part of the product runtime. This is the developer test harness (SPEC:
dev-only agent call telemetry / test harness): a stdio MCP server that
Codex/Fable/Terra/other coding agents register locally to inspect and probe
the real agent system. It is never launched by product code (the gRPC Harness
launches only mcp_host.py), never exposed to browsers, and refuses to start
when NODE_ENV=production. Every tool is thin transport to the backend's
/api/dev/agent-harness/* routes, which themselves 403 in production — the
backend stays the single authority.

Register (example, Claude Code):
  claude mcp add dev_agent_harness -- \
    C:/Projects/main/apps/python-models/.venv/Scripts/python.exe \
    C:/Projects/main/apps/python-models/app/dev_agent_harness_mcp.py

Safety: probes default to dry_run (no model call, no graph write). A live
single-card call requires mode="live_single_call" AND allowLive=true; a
disconnected card additionally requires allowDisconnected=true (labeled
dev-only override). probe_frontdoor never runs Mag One.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

BACKEND = os.environ.get("LIQUIDAITY_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")
HARNESS_BASE = f"{BACKEND}/api/dev/agent-harness"

server = Server("dev_agent_harness")


def _http_sync(method: str, url: str, payload: dict[str, Any] | None = None) -> str:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(url, data=data, headers={"Content-Type": "application/json"}, method=method)
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


async def _get(path: str, params: dict[str, Any]) -> list[TextContent]:
    query = urlencode({k: v for k, v in params.items() if v not in (None, "")})
    text = await asyncio.to_thread(_http_sync, "GET", f"{HARNESS_BASE}/{path}?{query}")
    return [TextContent(type="text", text=text)]


async def _post(path: str, payload: dict[str, Any]) -> list[TextContent]:
    text = await asyncio.to_thread(_http_sync, "POST", f"{HARNESS_BASE}/{path}", payload)
    return [TextContent(type="text", text=text)]


_PROJECT_DECK = {
    "projectId": {"type": "string"},
    "deckId": {"type": "string", "description": "optional; defaults to the canonical Agent Canvas deck"},
}


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="describe_system",
            description=(
                "The system map a coding agent starts from: active project/deck cards with "
                "runtime binding, provider/model (resolved through the REAL runtime resolvers), "
                "tools, connected vs disconnected (bus edges are the only activation signal), "
                "orchestrator, graph endpoints, and the instrumented run stages."
            ),
            inputSchema={"type": "object", "properties": dict(_PROJECT_DECK), "required": ["projectId"]},
        ),
        Tool(
            name="describe_card",
            description=(
                "One saved card in full: persisted prompt (source of truth), provider/model, "
                "tools, runtime binding, connectivity, what can invoke it, and which graphs its "
                "tools can read/write. A card whose config would fail the real run reports the "
                "exact runtime resolution error."
            ),
            inputSchema={
                "type": "object",
                "properties": {**_PROJECT_DECK, "cardId": {"type": "string"}},
                "required": ["projectId", "cardId"],
            },
        ),
        Tool(
            name="probe_frontdoor",
            description=(
                "Pretend to be the user at the Main Chat front door — dry_run ONLY. Returns the "
                "RunIntent, what would be called, connected participants, disconnected "
                "exclusions, and blocked reasons. Set includePreflight=true to also run the REAL "
                "read-only Hermes preflight (ThinkGraph/KnowGraph availability + Run Packet "
                "draft). Never runs Mag One and never calls a model."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    **_PROJECT_DECK,
                    "conversationId": {"type": "string"},
                    "testUserMessage": {"type": "string"},
                    "includePreflight": {"type": "boolean"},
                },
                "required": ["projectId", "testUserMessage"],
            },
        ),
        Tool(
            name="probe_card",
            description=(
                "Pretend to be the caller/parent agent at ONE card boundary. dry_run (default): "
                "resolve the card's real config/prompt/tools with no model or Python call. "
                "mode='live_single_call' PLUS allowLive=true runs ONE real single-card call "
                "through the canonical executor (real model call, telemetry recorded); a "
                "disconnected card additionally requires allowDisconnected=true (dev-only "
                "override, no graph authority is minted)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    **_PROJECT_DECK,
                    "cardId": {"type": "string"},
                    "testInput": {"type": "string"},
                    "mode": {"type": "string", "enum": ["dry_run", "live_single_call"]},
                    "allowLive": {"type": "boolean"},
                    "allowDisconnected": {"type": "boolean"},
                },
                "required": ["projectId", "cardId", "testInput"],
            },
        ),
        Tool(
            name="get_run_trace",
            description=(
                "Every telemetry event sharing one runId/correlationId: stages, card calls, "
                "graph reads/writes, errors, timings, and real/dry-run/probe/blocked modes."
            ),
            inputSchema={
                "type": "object",
                "properties": {"correlationId": {"type": "string"}},
                "required": ["correlationId"],
            },
        ),
        Tool(
            name="list_recent_agent_events",
            description="Recent agent telemetry events from the dev ring buffer (newest last).",
            inputSchema={"type": "object", "properties": {"limit": {"type": "integer"}}, "required": []},
        ),
        Tool(
            name="run_pipeline_probe",
            description=(
                "Run the checked-in non-live POC pipeline probe (scripts/poc-pipeline-probe.ts) "
                "and return structured PASS/FAIL/SKIP stages. The live Mag One stage is always "
                "gated off on this path."
            ),
            inputSchema={"type": "object", "properties": dict(_PROJECT_DECK), "required": ["projectId"]},
        ),
        Tool(
            name="list_coder_jobs",
            description=(
                "List coding jobs from the canonical job folder (handoff/<jobId>/prompt.md is the "
                "job contract; returns/<jobId>/ is the result surface): id, prompt size, claim "
                "(which execution adapter took it), and returned-file count."
            ),
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="get_coder_job",
            description=(
                "Read one coding job: the exact prompt.md contract bytes (bounded), the claim, "
                "and the real files under returns/<jobId>/."
            ),
            inputSchema={
                "type": "object",
                "properties": {"jobId": {"type": "string"}},
                "required": ["jobId"],
            },
        ),
        Tool(
            name="claim_coder_job",
            description=(
                "Announce which execution adapter is taking a job (external_coder | mcp_coder | "
                "plugin_coder | openclaude_api_coder) plus the adapter identity (e.g. "
                "'claude-code', 'codex', 'openclaude') and model identity when the adapter "
                "exposes one. The claim never redefines the job — the Coder card/job stays the "
                "source of truth. A second claim requires force=true."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "jobId": {"type": "string"},
                    "adapter": {"type": "string"},
                    "executionMode": {
                        "type": "string",
                        "enum": ["external_coder", "mcp_coder", "plugin_coder", "openclaude_api_coder"],
                    },
                    "model": {"type": "string"},
                    "force": {"type": "boolean"},
                },
                "required": ["jobId", "adapter", "executionMode"],
            },
        ),
        Tool(
            name="get_coder_run",
            description="Get the active Claude Code run identity, approved prompt hash, invocation mode, repository, target card, and status.",
            inputSchema={"type": "object", "properties": {"runId": {"type": "string"}}, "required": ["runId"]},
        ),
        Tool(
            name="get_coder_context",
            description="Get only the approved bounded context for one Claude Code run: repository, allowed/denied paths, and proof requirements.",
            inputSchema={"type": "object", "properties": {"runId": {"type": "string"}}, "required": ["runId"]},
        ),
        Tool(
            name="emit_coder_event",
            description="Emit one bounded structured progress event for an active Claude Code run.",
            inputSchema={"type": "object", "properties": {"runId": {"type": "string"}, "type": {"type": "string"}, "text": {"type": "string"}}, "required": ["runId", "type"]},
        ),
        Tool(
            name="submit_coder_report",
            description=(
                "Submit a CoderReport with its claims for DETERMINISTIC evidence verification "
                "against real runtime telemetry + filesystem facts (no LLM classification). "
                "claims: {traceIds, filesChanged, tests, cardCalls, graphWrites, provider, "
                "model, postflight}. Returns SUPPORTED/UNSUPPORTED/CONTRADICTED/MISSING_PROOF "
                "per claim plus an overall verdict — attach your telemetry correlation ids or "
                "your work stays unproven."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "runId": {"type": "string"},
                    "adapter": {"type": "string"},
                    "promptHash": {"type": "string"},
                    "report": {"type": "object"},
                    "claims": {"type": "object"},
                },
                "required": ["runId", "adapter", "promptHash", "report"],
            },
        ),
        Tool(
            name="verify_coder_report",
            description=(
                "Re-run deterministic evidence verification for a previously submitted "
                "CoderReport (telemetry may have arrived since submission)."
            ),
            inputSchema={
                "type": "object",
                "properties": {"submissionId": {"type": "string"}},
                "required": ["submissionId"],
            },
        ),
        Tool(
            name="get_coder_report_verification",
            description="Fetch a prior CoderReport submission with its latest verification result.",
            inputSchema={
                "type": "object",
                "properties": {"submissionId": {"type": "string"}},
                "required": ["submissionId"],
            },
        ),
        Tool(
            name="get_card_drift",
            description=(
                "Deterministic card config/prompt drift report for the live deck: removed-tool "
                "references in live prompts, unknown tool references, model resolution failures, "
                "connected-but-not-callable and connected-but-disabled cards. Advisory only — "
                "never mutates a card."
            ),
            inputSchema={"type": "object", "properties": dict(_PROJECT_DECK), "required": ["projectId"]},
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    args = arguments or {}
    if name == "describe_system":
        return await _get("system", {"projectId": args.get("projectId"), "deckId": args.get("deckId")})
    if name == "describe_card":
        return await _get(
            "card",
            {"projectId": args.get("projectId"), "deckId": args.get("deckId"), "cardId": args.get("cardId")},
        )
    if name == "probe_frontdoor":
        return await _post("probe-frontdoor", args)
    if name == "probe_card":
        return await _post("probe-card", args)
    if name == "get_run_trace":
        correlation_id = str(args.get("correlationId") or "").strip()
        text = await asyncio.to_thread(_http_sync, "GET", f"{HARNESS_BASE}/trace/{correlation_id}")
        return [TextContent(type="text", text=text)]
    if name == "list_recent_agent_events":
        return await _get("events", {"limit": args.get("limit")})
    if name == "run_pipeline_probe":
        return await _post("run-pipeline-probe", args)
    if name == "list_coder_jobs":
        return await _get("coder-jobs", {})
    if name == "get_coder_job":
        job_id = str(args.get("jobId") or "").strip()
        text = await asyncio.to_thread(_http_sync, "GET", f"{HARNESS_BASE}/coder-jobs/{job_id}")
        return [TextContent(type="text", text=text)]
    if name == "claim_coder_job":
        job_id = str(args.get("jobId") or "").strip()
        payload = {k: v for k, v in args.items() if k != "jobId"}
        return await _post(f"coder-jobs/{job_id}/claim", payload)
    if name == "get_coder_run":
        run_id = str(args.get("runId") or "").strip()
        text = await asyncio.to_thread(_http_sync, "GET", f"{HARNESS_BASE}/coder-runs/{run_id}")
        return [TextContent(type="text", text=text)]
    if name == "get_coder_context":
        run_id = str(args.get("runId") or "").strip()
        text = await asyncio.to_thread(_http_sync, "GET", f"{HARNESS_BASE}/coder-runs/{run_id}/context")
        return [TextContent(type="text", text=text)]
    if name == "emit_coder_event":
        run_id = str(args.get("runId") or "").strip()
        return await _post(f"coder-runs/{run_id}/events", {k: v for k, v in args.items() if k != "runId"})
    if name == "submit_coder_report":
        run_id = str(args.get("runId") or "").strip()
        return await _post(f"coder-runs/{run_id}/report", {k: v for k, v in args.items() if k != "runId"})
    if name == "verify_coder_report":
        submission_id = str(args.get("submissionId") or "").strip()
        return await _post(f"coder-reports/{submission_id}/verify", {})
    if name == "get_coder_report_verification":
        submission_id = str(args.get("submissionId") or "").strip()
        text = await asyncio.to_thread(_http_sync, "GET", f"{HARNESS_BASE}/coder-reports/{submission_id}")
        return [TextContent(type="text", text=text)]
    if name == "get_card_drift":
        return await _get("drift", {"projectId": args.get("projectId"), "deckId": args.get("deckId")})
    return [TextContent(type="text", text=json.dumps({"ok": False, "error": f"unknown_tool: {name}"}))]


async def main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    if os.environ.get("NODE_ENV", "").strip().lower() == "production":
        print("dev_agent_harness_mcp refuses to start in production", file=sys.stderr)
        raise SystemExit(1)
    asyncio.run(main())
