"""Focused adapter contract coverage. No network/model call.

Proves: connected agents are passed as plain names, the empty-message branch is
an honest error, app-authored scaffold runtimes stay removed while the real
AutoGen Task Ledger artifact path remains allowed, and card-selected tools are
attached as real AutoGen FunctionTools only when selected (without executing).
"""
import asyncio
from types import SimpleNamespace

import pytest
from autogen_core.tools import FunctionTool
from autogen_agentchat.messages import TextMessage
from autogen_core import CancellationToken

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
    model_configs: list[tuple[str, str, float | None, int | None]] = []
    tasks: list[str] = []
    attached_tools: list[str] = []
    authorities: list[dict[str, str] | None] = []
    context = _context_pack("transport placeholder")
    context.cardRuntime.runtimeScope = {"deckId": "deck_builder"}
    context.cardRuntime.runtimeOptions = {"temperature": 0.4, "maxTokens": 2400}
    context.cardRuntime.participants[0].providerModelId = "openai/gpt-5.6-luna"
    context.cardRuntime.participants[1].providerModelId = "openai/gpt-5.6-sol"
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
    def build_model(config):
        events.append("model")
        model_configs.append(
            (
                config.provider,
                config.provider_model_id,
                config.temperature,
                config.max_tokens,
            )
        )
        return SimpleNamespace()

    monkeypatch.setattr(mac, "_build_model_client", build_model)

    def build(_context, participant_clients, *, extra_tools=None):
        assert len(participant_clients) == 2
        attached_tools.extend(tool.name for tool in (extra_tools or []))
        return [SimpleNamespace()]

    monkeypatch.setattr(mac, "_build_participants", build)

    class FakeTeam:
        orchestrator_instance = None

        def __init__(self, **_kwargs):
            pass

        async def run_stream(self, *, task):
            tasks.append(task)
            authorities.append(
                mac.ACTIVE_AGENT_ASSIGNMENT_CONTEXT.get()
            )
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
    assert events == ["hydrated", "model", "model", "model"]
    assert model_configs == [
        ("openrouter", MODEL, 0.4, 2400),
        ("openrouter", "openai/gpt-5.6-luna", None, None),
        ("openrouter", "openai/gpt-5.6-sol", None, None),
    ]
    assert tasks == ["Approved task.\n\ngraphview:query:one"]
    assert attached_tools == []
    assert authorities == [
        {
            "projectId": "p",
            "assignmentId": "assignment:t",
            "receiverCardId": "orch",
        }
    ]
    assert mac.ACTIVE_AGENT_ASSIGNMENT_CONTEXT.get() is None

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
    participants = mac._build_participants(_tools_context(["calculator"]), _FakeToolClient())
    research, plain = participants[0], participants[1]
    research_tool_names = [tool.name for tool in research._tools]
    assert "calculator" in research_tool_names
    assert all(isinstance(tool, FunctionTool) for tool in research._tools)
    assert [tool.name for tool in plain._tools] == []


def test_each_participant_receives_its_own_saved_card_model_client():
    first = _FakeToolClient()
    second = _FakeToolClient()
    research, plain = mac._build_participants(
        _tools_context([]),
        [first, second],
    )
    assert research._model_client is first
    assert plain._model_client is second


def test_codex_app_server_participant_uses_the_saved_external_card_boundary(monkeypatch):
    card = CardRuntimeConfig(
        cardId="orch", title="Mag One", runtimeType="magentic_one",
        runtimeScope={"deckId": "deck_builder"},
        participants=[CardRuntimeParticipant(
            cardId="card_openai_coder", title="OpenAI Coder",
            runtimeType="codex_app_server", runtimeBinding="openai_coder",
            tools=[], provider="openai", providerModelId="gpt-5.6-sol",
        )],
    )
    context = ContextPack(
        session=ProjectSession(
            sessionId="s", projectId="p", turnId="t", route="r",
            modelProvider="openrouter", modelKey=MODEL, providerModelId=MODEL,
            startedAt="now",
        ),
        userText="question",
        cardRuntime=card,
    )
    calls = []

    def post(path, payload, timeout):
        calls.append((path, payload, timeout))
        if path.endswith("/start"):
            return {"ok": True, "started": {"turnId": "turn_1"}}
        return {
            "ok": True,
            "receipt": {"status": "completed", "result": {"finalText": "exact evidence"}},
        }

    monkeypatch.setattr(mac, "_post_codex_backend", post)
    participants = mac._build_participants(context, [None])
    assert len(participants) == 1
    response = asyncio.run(participants[0].on_messages(
        [TextMessage(content="bounded task", source="MagenticOneOrchestrator")],
        CancellationToken(),
    ))
    assert response.chat_message.content == "exact evidence"
    assert calls == [
        (
            "/api/coder/codex-app-server/cards/card_openai_coder/start",
            {"projectId": "p", "assignment": "bounded task"},
            15,
        ),
        (
            "/api/coder/codex-app-server/cards/card_openai_coder/await",
            {"projectId": "p", "turnId": "turn_1"},
            125,
        ),
    ]


def test_participant_model_client_count_mismatch_fails_loudly():
    with pytest.raises(RuntimeError, match="participant_model_count_mismatch"):
        mac._build_participants(_tools_context([]), [_FakeToolClient()])


def test_unknown_tool_id_fails_loudly_not_silently_dropped():
    with pytest.raises(RuntimeError):
        mac._build_participants(_tools_context(["does_not_exist_tool"]), _FakeToolClient())

def test_magentic_success_requires_a_model_result():
    ok, error = mac._magentic_completion_status("Here is the answer.")
    assert ok is True
    assert error is None

    ok, error = mac._magentic_completion_status("")
    assert ok is False
    assert error == "no_model_output"
