"""Focused adapter contract coverage. No network/model call.

Proves: connected agents are passed as plain names, the empty-message branch is
an honest error, app-authored scaffold runtimes stay removed while the real
AutoGen Task Ledger artifact path remains allowed, and card-selected tools are
attached as real AutoGen FunctionTools only when selected (without executing).
"""
import asyncio
import sys
from types import SimpleNamespace

import pytest
from autogen_core.tools import FunctionTool

from app.python_models import magentic_agentchat as mac
from app.python_models.orchestration_contracts import (
    AgentAssignmentRequest,
    CardRuntimeConfig,
    CardRuntimeParticipant,
    ContextPack,
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


def test_mag_one_without_agentgraph_assignment_fails_before_a_model_call():
    res = asyncio.run(mac.run_native_magentic_mission(_context_pack("")))
    assert res.ok is False
    assert res.error == "agentgraph_assignment_required"
    assert res.finalResponseText == ""


def test_mag_one_hydrates_agentgraph_context_before_model_and_scopes_optional_tool(
    monkeypatch,
):
    events: list[str] = []
    tasks: list[str] = []
    attached_tools: list[str] = []
    context = _context_pack("transport placeholder")
    context.cardRuntime.runtimeScope = {"deckId": "deck_builder"}
    context.agentAssignment = AgentAssignmentRequest(
        instructionId="instruction:one",
        senderCardId="card_main_chat",
        receiverCardId="orch",
    )
    optional = mac.rq.QueryBinding(
        project_id="p",
        card_id="orch",
        binding_id="optional_detail",
        query_id="agentgraph.detail",
        query_version=1,
        delivery_mode="optional",
        parameters={},
    )
    monkeypatch.setattr(
        mac.ag,
        "create_assignment",
        lambda **_kwargs: {"assignmentId": "assignment:t"},
    )

    def hydrate(**kwargs):
        events.append("hydrated")
        return mac.rq.HydratedAssignmentContext(
            instruction="Approved task.",
            claim_token="claim:one",
            optional_bindings=(optional,),
            model_context="Approved task.\n\ngraphview:query:one",
        )

    monkeypatch.setattr(mac.rq, "hydrate_assignment_context", hydrate)
    monkeypatch.setattr(
        mac,
        "_build_model_client",
        lambda _config: (events.append("model") or SimpleNamespace()),
    )

    def build(_context, _client, *, extra_tools=None):
        attached_tools.extend(tool.name for tool in (extra_tools or []))
        return [SimpleNamespace()]

    monkeypatch.setattr(mac, "_build_participants", build)

    class FakeTeam:
        orchestrator_instance = None

        def __init__(self, **_kwargs):
            pass

        async def run_stream(self, *, task):
            tasks.append(task)
            yield SimpleNamespace(
                messages=[SimpleNamespace(content="done")],
                stop_reason="complete",
            )

    monkeypatch.setattr(mac, "_CapturingMagenticOneGroupChat", FakeTeam)
    monkeypatch.setattr(
        mac.ag,
        "finish_assignment",
        lambda **_kwargs: {"artifacts": []},
    )

    response = asyncio.run(mac.run_native_magentic_mission(context))

    assert response.ok is True
    assert events == ["hydrated", "model"]
    assert tasks == ["Approved task.\n\ngraphview:query:one"]
    assert attached_tools == []

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
    assert [tool.name for tool in plain._tools] == []


def test_unknown_tool_id_fails_loudly_not_silently_dropped():
    with pytest.raises(RuntimeError):
        mac._build_participants(_tools_context(["does_not_exist_tool"]), _FakeToolClient())


def test_building_participants_attaches_without_executing_retrieval():
    # Wrapping the adapter in a FunctionTool must not import/run the KnowGraph
    # rails — retrieval only happens when Mag One actually calls the tool.
    sys.modules.pop("hybrid_retrieval", None)
    mac._build_participants(_tools_context(["retrieve_knowgraph_context"]), _FakeToolClient())
    assert "hybrid_retrieval" not in sys.modules


def test_magentic_success_requires_a_model_result():
    ok, error = mac._magentic_completion_status("Here is the answer.")
    assert ok is True
    assert error is None

    ok, error = mac._magentic_completion_status("")
    assert ok is False
    assert error == "no_model_output"
