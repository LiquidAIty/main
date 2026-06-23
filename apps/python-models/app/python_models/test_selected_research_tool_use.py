"""Offline coverage for the selected research workflow tool-use path.

No live Neo4j / EmbeddingGemma / model: a scripted ReplayChatCompletionClient
drives the real AutoGen agent tool-call event path, and a stub FunctionTool
named ``retrieve_knowgraph_context`` returns a canned bounded source-backed
result so the event mechanics + result preservation are proven deterministically.
Live + real-tool proof lives in prove_selected_research_tool_use.py (deterministic)
and smoke_selected_research_tool_use.py (real model).
"""

from __future__ import annotations

import ast
import asyncio
import json

from autogen_agentchat.agents import AssistantAgent
from autogen_core import FunctionCall
from autogen_core.models import CreateResult, ModelFamily, RequestUsage
from autogen_core.tools import FunctionTool
from autogen_ext.models.replay import ReplayChatCompletionClient

from app.python_models import magentic_agentchat as mac
from app.python_models.knowgraph_research_fixture import (
    CODE_ONLY_TASK,
    PROJECT_ID,
    RESEARCH_TASK,
    SELECTED_RESEARCH_WORKFLOW_INSTRUCTIONS,
    build_selected_research_context,
)

TOOL_ID = "retrieve_knowgraph_context"
PROVIDER = "openrouter"
MODEL = "openai/gpt-5.1-chat"
MODEL_INFO = {"vision": False, "function_calling": True, "json_output": True,
              "family": ModelFamily.UNKNOWN, "structured_output": False}


class _FakeToolClient:
    model_info = {"function_calling": True}


CANNED_RESULT = {
    "project_id": PROJECT_ID,
    "retrieval_modes": {"exact": True, "fulltext": True, "vector": "available"},
    "assertions": [
        {"id": "a-rdw", "subject": "Redwire Corporation", "predicate": "has_ticker_symbol",
         "object": "RDW", "outcome": "supported", "source_ref": "s1",
         "source_title": "Redwire (RDW) Stock Quote", "source_url": "https://finance.yahoo.com/quote/RDW",
         "retrieval_reasons": ["exact_anchor_match", "semantic_match"]},
        {"id": "a-rwe", "subject": "Redwire Corporation", "predicate": "has_ticker_symbol",
         "object": "RWE", "outcome": "contradicted", "source_ref": "s2",
         "source_title": "Redwire trades as RWE", "source_url": "https://example.com/redwire-rwe",
         "retrieval_reasons": ["fulltext_match", "contradiction"]},
        {"id": "a-sx", "subject": "SpaceX", "predicate": "has_current_valuation",
         "object": "unknown", "outcome": "uncertain", "source_ref": "s3",
         "source_title": "SpaceX valuation news", "source_url": "https://forgeglobal.com/spacex",
         "retrieval_reasons": ["semantic_match", "uncertainty"]},
    ],
}


async def _stub_retrieve(project_id: str, query: str = "", anchors: list[str] | None = None) -> dict:
    return CANNED_RESULT


def _stub_tool() -> FunctionTool:
    return FunctionTool(_stub_retrieve, name=TOOL_ID, description="stub KnowGraph retrieval")


def _tool_call_completion(args: dict) -> CreateResult:
    return CreateResult(
        finish_reason="function_calls",
        content=[FunctionCall(id="c1", name=TOOL_ID, arguments=json.dumps(args))],
        usage=RequestUsage(prompt_tokens=0, completion_tokens=0),
        cached=False,
    )


def _parse_payload(text: str) -> dict | None:
    for loader in (json.loads, ast.literal_eval):
        try:
            value = loader(text or "")
            if isinstance(value, dict):
                return value
        except Exception:
            continue
    return None


# --------------------------------------------------------------------------- #
# wiring: attached reaches the workflow tool set, detached does not
# --------------------------------------------------------------------------- #
def test_attached_tool_reaches_selected_workflow_tool_set():
    ctx = build_selected_research_context(provider=PROVIDER, provider_model_id=MODEL, tools=[TOOL_ID])
    research = mac._build_participants(ctx, _FakeToolClient())[0]
    assert TOOL_ID in [t.name for t in research._tools]


def test_detached_tool_absent_from_workflow_tool_set():
    ctx = build_selected_research_context(provider=PROVIDER, provider_model_id=MODEL, tools=[])
    research = mac._build_participants(ctx, _FakeToolClient())[0]
    assert research._tools == []


def test_workflow_instructions_preserve_choice_not_a_route():
    text = SELECTED_RESEARCH_WORKFLOW_INSTRUCTIONS.lower()
    assert "deliberately" in text
    assert "do not call it merely because it is attached" in text
    assert "always call" not in text  # no forced rule
    assert "do not invent" in text and "ticker" in text


# --------------------------------------------------------------------------- #
# event path: real ToolCallRequest/Execution + source-backed result preservation
# --------------------------------------------------------------------------- #
async def _drive_toolcall_events():
    replay = ReplayChatCompletionClient(
        [_tool_call_completion({"project_id": PROJECT_ID, "query": "RDW SpaceX", "anchors": ["RDW", "SpaceX"]})],
        model_info=MODEL_INFO)
    agent = AssistantAgent(name="Research_Agent", model_client=replay, tools=[_stub_tool()],
                           system_message=SELECTED_RESEARCH_WORKFLOW_INSTRUCTIONS)

    request_seen = False
    result = None
    summary_text = ""
    async for item in agent.run_stream(task=RESEARCH_TASK):
        name = type(item).__name__
        if name == "ToolCallRequestEvent":
            request_seen = request_seen or any(getattr(c, "name", "") == TOOL_ID for c in (item.content or []))
        elif name == "ToolCallExecutionEvent":
            for fer in item.content or []:
                parsed = _parse_payload(getattr(fer, "content", ""))
                if isinstance(parsed, dict) and "retrieval_modes" in parsed:
                    result = parsed
        elif name == "ToolCallSummaryMessage":
            summary_text = item.content or ""

    return request_seen, result, summary_text


def test_controlled_workflow_drives_toolcall_events_and_preserves_evidence():
    request_seen, result, summary_text = asyncio.run(_drive_toolcall_events())
    assert request_seen  # real ToolCallRequestEvent for the attached tool
    assert result is not None  # real ToolCallExecutionEvent carried the result
    outcomes = {a["outcome"] for a in result["assertions"]}
    assert {"supported", "contradicted", "uncertain"}.issubset(outcomes)  # separation preserved
    assert all(a["source_ref"] and a["source_url"] for a in result["assertions"])  # sourceRefs survive
    assert result["retrieval_modes"] == {"exact": True, "fulltext": True, "vector": "available"}
    assert "source_ref" in summary_text  # result returned to the run output


async def _drive_code_only():
    # The model returns plain text (no FunctionCall); an attached tool must not fire.
    replay = ReplayChatCompletionClient(["Renamed `tmp` to `buffer`. No research needed."],
                                        model_info=MODEL_INFO)
    agent = AssistantAgent(name="Research_Agent", model_client=replay, tools=[_stub_tool()],
                           system_message=SELECTED_RESEARCH_WORKFLOW_INSTRUCTIONS)
    tool_events = []
    async for item in agent.run_stream(task=CODE_ONLY_TASK):
        if type(item).__name__ in ("ToolCallRequestEvent", "ToolCallExecutionEvent"):
            tool_events.append(item)
    return tool_events


def test_code_only_task_does_not_call_tool_even_though_attached():
    assert asyncio.run(_drive_code_only()) == []  # attached but not called
