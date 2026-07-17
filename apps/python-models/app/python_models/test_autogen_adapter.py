"""Focused adapter contract coverage. No network/model call.

Proves: connected agents are passed as plain names, the empty-message branch is
an honest error, app-authored scaffold runtimes stay removed while the real
AutoGen Task Ledger artifact path remains allowed, and card-selected tools are
attached as real AutoGen FunctionTools only when selected (without executing).
"""
import asyncio
import sys
from pathlib import Path

import pytest
from autogen_core.tools import FunctionTool

from app.python_models import magentic_agentchat as mac
from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    CardRuntimeParticipant,
    ContextPack,
    JobHandoff,
    ProjectSession,
)

MODEL = "openai/gpt-5.1-chat"


class _FakeToolClient:
    """Minimal model client: AssistantAgent only checks model_info for tools."""

    model_info = {"function_calling": True}


def _tools_context(tool_ids: list[str]) -> ContextPack:
    card = CardRuntimeConfig(
        cardId="orch", title="Mag One", runtimeType="magentic_one",
        participants=[
            CardRuntimeParticipant(cardId="research", title="Research Agent",
                                   runtimeType="assistant_agent", role="research",
                                   tools=tool_ids, provider="openrouter", providerModelId=MODEL),
            CardRuntimeParticipant(cardId="plain", title="Plain Agent",
                                   runtimeType="assistant_agent", role="other",
                                   tools=[], provider="openrouter", providerModelId=MODEL),
        ],
    )
    return ContextPack(
        session=ProjectSession(
            sessionId="s", projectId="p", turnId="t", route="r",
            modelProvider="openrouter", modelKey="gpt-5.1-chat", providerModelId=MODEL,
            startedAt="now",
        ),
        userText="hi",
        cardRuntime=card,
    )


def _context_pack(user_text: str) -> ContextPack:
    card = CardRuntimeConfig(
        cardId="orch", title="Mag One", runtimeType="magentic_one",
        participants=[
            CardRuntimeParticipant(cardId="r", title="Research Agent", runtimeType="assistant_agent",
                                   provider="openrouter", providerModelId=MODEL),
            CardRuntimeParticipant(cardId="t", title="Trading Agent", runtimeType="assistant_agent",
                                   provider="openrouter", providerModelId=MODEL),
        ],
    )
    return ContextPack(
        session=ProjectSession(
            sessionId="s", projectId="p", turnId="t", route="r",
            modelProvider="openrouter", modelKey="gpt-5.1-chat", providerModelId=MODEL,
            startedAt="now",
        ),
        userText=user_text,
        cardRuntime=card,
    )


def test_connected_agents_are_plain_names_only():
    names = mac.connected_agent_names(_context_pack("hi"))
    assert names == ["Research Agent", "Trading Agent"]


def test_empty_message_is_honest_error_not_a_call():
    res = asyncio.run(mac.run_native_magentic_mission(_context_pack("")))
    assert res.ok is False
    assert res.error == "empty_user_message"
    assert res.finalResponseText == ""


def test_mag_one_is_the_only_prompt_entrypoint_reader(tmp_path: Path):
    workspace = tmp_path / "coder-workspace"
    handoff = workspace / "handoff" / "job_exact"
    handoff.mkdir(parents=True)
    expected = "# finalized Main Chat task\nkeep bytes ✓\n"
    (handoff / "prompt.md").write_bytes(expected.encode("utf-8"))
    context = _context_pack("")
    context.jobHandoff = JobHandoff(workspaceRoot=str(workspace), jobId="job_exact")

    folder, task = mac._read_magentic_handoff_task(context)

    assert folder is not None
    assert task == expected
    assert (workspace / "returns" / "job_exact").is_dir()


def test_app_authored_scaffold_runtime_is_gone_but_real_task_ledger_artifact_allowed():
    # Removed: app-authored scaffold / fake local Task Ledger classes.
    # Allowed: real AutoGen adapter helpers that expose the real taskLedgerArtifact.
    for symbol in [
        "select_final_chat_response",
        "_SCAFFOLD_MARKERS",
        "TASK_LEDGER_STOP",
        "LiquidAItyTaskLedgerOrchestrator",
        "LiquidAItyTaskLedgerGroupChat",
        "_progress_ledger_reference",
        "compile_connected_agents",
    ]:
        assert not hasattr(mac, symbol), f"{symbol} must be removed"
    assert hasattr(mac, "run_native_magentic_mission")


def test_selected_tool_attaches_real_functiontool_to_that_participant():
    participants = mac._build_participants(_tools_context(["retrieve_knowgraph_context"]), _FakeToolClient())
    research, plain = participants[0], participants[1]
    research_tool_names = [tool.name for tool in research._tools]
    assert "retrieve_knowgraph_context" in research_tool_names
    assert all(isinstance(tool, FunctionTool) for tool in research._tools)
    assert plain._tools == []  # unselected participant gets no tools


def test_unknown_tool_id_fails_loudly_not_silently_dropped():
    with pytest.raises(RuntimeError):
        mac._build_participants(_tools_context(["does_not_exist_tool"]), _FakeToolClient())


def test_building_participants_attaches_without_executing_retrieval():
    # Wrapping the adapter in a FunctionTool must not import/run the KnowGraph
    # rails — retrieval only happens when Mag One actually calls the tool.
    sys.modules.pop("hybrid_retrieval", None)
    mac._build_participants(_tools_context(["retrieve_knowgraph_context"]), _FakeToolClient())
    assert "hybrid_retrieval" not in sys.modules


def test_magentic_success_requires_declared_durable_output():
    ok, error = mac._magentic_completion_status(
        "The work is complete.",
        durable_output_required=True,
        returned_files=[],
    )
    assert ok is False
    assert error == "declared_durable_output_missing"


def test_magentic_success_accepts_real_return_file():
    ok, error = mac._magentic_completion_status(
        "The work is complete.",
        durable_output_required=True,
        returned_files=["coder-report.json"],
    )
    assert ok is True
    assert error is None


def test_magentic_success_rejects_only_empty_return_files():
    # PL-1: a file exists but has 0 bytes (failed write). Not durable output.
    ok, error = mac._magentic_completion_status(
        "The work is complete.",
        durable_output_required=True,
        returned_files=["coder-report.json"],
        nonempty_returned_files=[],
    )
    assert ok is False
    assert error == "declared_durable_output_empty"


def test_magentic_success_on_partial_real_output():
    # Some workers wrote real files, some wrote empty ones: the real ones satisfy
    # the durable contract; the empty ones are surfaced via return_status, not ok.
    ok, error = mac._magentic_completion_status(
        "The work is complete.",
        durable_output_required=True,
        returned_files=["a/real.json", "b/empty.txt"],
        nonempty_returned_files=["a/real.json"],
    )
    assert ok is True
    assert error is None


def test_magentic_no_durable_contract_succeeds_on_text():
    # A chat-driven run (no job folder) has no durable contract — the response
    # text IS the deliverable.
    ok, error = mac._magentic_completion_status(
        "Here is the answer.",
        durable_output_required=False,
        returned_files=[],
    )
    assert ok is True
    assert error is None
