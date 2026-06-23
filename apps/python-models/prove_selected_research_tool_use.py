# Deterministic event-path probe for the selected research workflow.
#
# Drives a REAL AutoGen tool-call through the real agent event path using a
# scripted (replay) model client — no live model, no fake tool. The attached
# registered FunctionTool executes for real against local Neo4j + local
# EmbeddingGemma over the RDW/SpaceX fixture. Proves: attached id -> FunctionTool
# set, real ToolCallRequestEvent + ToolCallExecutionEvent, bounded source-backed
# result, result returns to model context for reasoning, no graph writes, and
# detach removes the tool. Exits 0 only when all checks pass.
#
#   apps/python-models/.venv/Scripts/python.exe prove_selected_research_tool_use.py
import ast
import asyncio
import json
import sys
from pathlib import Path

from autogen_agentchat.agents import AssistantAgent
from autogen_core import FunctionCall
from autogen_core.models import CreateResult, FunctionExecutionResultMessage, ModelFamily, RequestUsage
from autogen_ext.models.replay import ReplayChatCompletionClient

from app.python_models import magentic_agentchat as mac
from app.python_models.tool_registry import DEFAULT_TOOL_REGISTRY
from app.python_models.knowgraph_research_fixture import (
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

# Bounded retrieval request Mag One would emit for this selected task.
REQUEST_ARGS = {
    "project_id": PROJECT_ID,
    "query": "Redwire RDW SpaceX source-backed evidence and contradictions",
    "anchors": ["Redwire Corporation", "RDW", "SpaceX"],
    "max_results": 8,
    "max_hops": 1,
}


def _parse_tool_payload(text: str) -> dict | None:
    """AutoGen FunctionTool serializes a dict return via str() (Python repr), so
    parse with json first, then ast.literal_eval."""
    text = text or ""
    for loader in (json.loads, ast.literal_eval):
        try:
            value = loader(text)
            if isinstance(value, dict):
                return value
        except Exception:
            continue
    return None


def _tool_call_completion() -> CreateResult:
    return CreateResult(
        finish_reason="function_calls",
        content=[FunctionCall(id="call-1", name=TOOL_ID, arguments=json.dumps(REQUEST_ARGS))],
        usage=RequestUsage(prompt_tokens=0, completion_tokens=0),
        cached=False,
    )


def _knowgraph_count() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    kg = str(repo_root / "services" / "knowgraph")
    if kg not in sys.path:
        sys.path.insert(0, kg)
    import assertion_vectors as av
    driver, config = av._connect_live()
    try:
        return av.count_assertions(driver, PROJECT_ID, database=config["database"])
    finally:
        driver.close()


async def main() -> int:
    checks: list[tuple[str, bool]] = []

    # 1. Advisory workflow instructions preserve Mag One choice (no forced/route logic).
    instr = SELECTED_RESEARCH_WORKFLOW_INSTRUCTIONS.lower()
    advisory = ("deliberately" in instr and "do not call it merely because it is attached" in instr
                and "always call" not in instr)
    checks.append(("selected workflow instructions are advisory (Mag One chooses)", advisory))

    # 2. Attached id reaches the real runtime workflow tool set; detached does not.
    attached = mac._build_participants(
        build_selected_research_context(provider=PROVIDER, provider_model_id=MODEL, tools=[TOOL_ID]),
        ReplayChatCompletionClient([_tool_call_completion()], model_info=MODEL_INFO))
    research = attached[0]
    research_tool_names = [t.name for t in getattr(research, "_tools", [])]
    checks.append(("attached tool reaches the workflow participant tool set", TOOL_ID in research_tool_names))

    detached = mac._build_participants(
        build_selected_research_context(provider=PROVIDER, provider_model_id=MODEL, tools=[]),
        ReplayChatCompletionClient(["unused"], model_info=MODEL_INFO))
    checks.append(("detached tool is absent from the workflow tool set",
                   TOOL_ID not in [t.name for t in getattr(detached[0], "_tools", [])]))

    before = _knowgraph_count()

    # 3. Run the REAL runtime-built research agent through the real tool-call event
    # path (scripted to emit one tool call). reflect_on_tool_use defaults False, so
    # the bounded result returns as the agent's ToolCallSummaryMessage.
    tool_request_seen = False
    tool_result: dict | None = None
    summary_carries_result = False
    events = []
    async for item in research.run_stream(task=RESEARCH_TASK):
        events.append(item)
        name = type(item).__name__
        if name == "ToolCallRequestEvent":
            content = getattr(item, "content", []) or []
            if any(getattr(call, "name", "") == TOOL_ID for call in content):
                tool_request_seen = True
        elif name == "ToolCallExecutionEvent":
            content = getattr(item, "content", []) or []
            for fer in content:
                parsed = _parse_tool_payload(getattr(fer, "content", ""))
                if isinstance(parsed, dict) and "retrieval_modes" in parsed:
                    tool_result = parsed
                    break
        elif name == "ToolCallSummaryMessage":
            text = getattr(item, "content", "") or ""
            summary_carries_result = "source_ref" in text or "retrieval_modes" in text

    after = _knowgraph_count()

    assertions = (tool_result or {}).get("assertions", [])
    modes = (tool_result or {}).get("retrieval_modes", {})
    outcomes = {a.get("outcome") for a in assertions}

    checks.append(("real ToolCallRequestEvent for the attached tool", tool_request_seen))
    checks.append(("real ToolCallExecutionEvent carried a KnowGraph result", tool_result is not None))
    checks.append(("result is bounded (<= max_results)", len(assertions) <= REQUEST_ARGS["max_results"]))
    checks.append(("exact + full-text + vector modes present",
                   bool(modes.get("exact")) and bool(modes.get("fulltext")) and modes.get("vector") == "available"))
    checks.append(("supported + contradicted + uncertain preserved",
                   {"supported", "contradicted", "uncertain"}.issubset(outcomes)))
    checks.append(("every result keeps sourceRef + title + URL",
                   bool(assertions) and all(a.get("source_ref") and a.get("source_title") and a.get("source_url")
                                            for a in assertions)))
    checks.append(("tool result returned to the run output (summary carries it)", summary_carries_result))
    checks.append(("no Neo4j writes (assertion count unchanged)", before == after and before > 0))

    # 4. Result returns to MODEL CONTEXT for subsequent reasoning: a reflecting agent
    # makes a 2nd model call whose messages include the tool result.
    reflect_replay = ReplayChatCompletionClient(
        [_tool_call_completion(), "Final source-backed research summary with sourceRefs."],
        model_info=MODEL_INFO)
    reflect_agent = AssistantAgent(
        name="Research_Agent", model_client=reflect_replay,
        tools=[DEFAULT_TOOL_REGISTRY.resolve_one(TOOL_ID)],
        reflect_on_tool_use=True, system_message=SELECTED_RESEARCH_WORKFLOW_INSTRUCTIONS)
    await reflect_agent.run(task=RESEARCH_TASK)
    second_call_messages = reflect_replay.create_calls[1]["messages"] if len(reflect_replay.create_calls) > 1 else []
    result_in_context = any(
        isinstance(m, FunctionExecutionResultMessage)
        and any("source_ref" in str(getattr(r, "content", "")) for r in (getattr(m, "content", []) or []))
        for m in second_call_messages
    )
    checks.append(("tool result re-entered model context for reasoning", result_in_context))

    print(f"[prove] modes={modes} assertions={len(assertions)} outcomes={sorted(o for o in outcomes if o)}")
    for a in assertions:
        print(f"  [{a.get('outcome')}] {a.get('subject')} {a.get('predicate')} {a.get('object')}  "
              f"ref={a.get('source_ref')} url={a.get('source_url')}")
    print(f"[prove] event types: {sorted({type(e).__name__ for e in events})}")
    print(f"[prove] knowgraph assertion count before={before} after={after}")
    for name, ok in checks:
        print(f"[prove] verify: {'PASS' if ok else 'FAIL'}  {name}")

    if all(ok for _, ok in checks):
        print("RESULT=DETERMINISTIC_EVENT_PATH_PROVEN")
        return 0
    print("RESULT=PARTIAL_BLOCKED (see FAIL lines)")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
