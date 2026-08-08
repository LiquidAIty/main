"""Focused adapter contract coverage. No network/model call.

Proves: connected agents are passed as plain names, the empty-message branch is
an honest error, app-authored scaffold and ledger interception stay removed,
and card-selected tools are attached as real AutoGen FunctionTools only when
selected (without executing).
"""
import asyncio
from types import SimpleNamespace

import pytest
from autogen_agentchat.messages import TextMessage
from autogen_core import CancellationToken
from autogen_core.tools import FunctionTool
from app.python_models import magentic_agentchat as mac
from app.python_models.autogen_provider_env import AutoGenAgentConfig, _build_model_client
from app.python_models.orchestration_contracts import (
    AgentAssignmentRequest,
    CardRuntimeConfig,
    CardRuntimeParticipant,
    ContextPack,
    ProjectSession,
)

MODEL = "deepseek/deepseek-v4-flash-0731"


@pytest.mark.parametrize("max_tokens", [0, -1])
def test_invalid_saved_max_tokens_fails_instead_of_using_provider_default(max_tokens: int):
    with pytest.raises(RuntimeError, match=f"card_max_tokens_invalid: {max_tokens}"):
        _build_model_client(
            AutoGenAgentConfig(
                provider="openrouter",
                provider_model_id=MODEL,
                max_tokens=max_tokens,
            )
        )


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
            modelProvider="openrouter", modelKey="deepseek/deepseek-v4-flash-0731", providerModelId=MODEL,
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
            modelProvider="openrouter", modelKey="deepseek/deepseek-v4-flash-0731", providerModelId=MODEL,
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


def test_mag_one_reads_agentgraph_text_and_native_references_before_model(
    monkeypatch,
):
    events: list[str] = []
    model_configs: list[tuple[str, str, float | None, int | None]] = []
    tasks: list[str] = []
    attached_tools: list[str] = []
    authorities: list[dict[str, str] | None] = []
    context = _context_pack("transport placeholder")
    context.cardRuntime.runtimeOptions = {
        "deckId": "deck_builder",
        "temperature": 0.4,
        "maxTokens": 2400,
    }
    context.cardRuntime.participants[0].providerModelId = "deepseek/deepseek-v4-flash-0731"
    context.cardRuntime.participants[1].providerModelId = "z-ai/glm-5.2"
    context.agentAssignment = AgentAssignmentRequest(
        instructionId="instruction:one",
        senderCardId="card_main_chat",
        receiverCardId="orch",
    )
    monkeypatch.setattr(
        mac.ag,
        "create_assignment",
        lambda **_kwargs: {"assignmentId": "assignment:t"},
    )
    monkeypatch.setattr(
        mac.ag,
        "read_assignment",
        lambda **_kwargs: events.append("read") or {
            "instruction": "Approved task.",
            "contextReferences": [
                {
                    "referenceType": "engraphis",
                    "referenceId": "record:one",
                    "required": True,
                },
                {
                    "referenceType": "cbm",
                    "referenceId": "symbol:two",
                    "required": False,
                },
            ],
        },
    )
    monkeypatch.setattr(
        mac.ag,
        "claim_assignment",
        lambda **_kwargs: events.append("claimed") or {"claimToken": "claim:one"},
    )
    monkeypatch.setattr(mac.ag, "record_assignment_runtime_context", lambda **_kwargs: None)
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

    monkeypatch.setattr(mac, "MagenticOneGroupChat", FakeTeam)
    monkeypatch.setattr(
        mac.ag,
        "finish_assignment",
        lambda **_kwargs: {"artifacts": []},
    )

    response = asyncio.run(mac.run_native_magentic_mission(context))

    assert response.ok is True
    assert events == ["read", "claimed", "model", "model", "model"]
    assert model_configs == [
        ("openrouter", MODEL, 0.4, 2400),
        ("openrouter", "deepseek/deepseek-v4-flash-0731", None, None),
        ("openrouter", "z-ai/glm-5.2", None, None),
    ]
    assert tasks == [
        "[AGENTGRAPH_ASSIGNMENT]\n\n"
        "assignmentId: assignment:t\n\n"
        "instructionId: instruction:one\n\n"
        "Exact instruction:\n\n"
        "Approved task.\n\n"
        "[AGENTGRAPH_CONTEXT_REFERENCES]\n"
        "- engraphis:record:one [required]\n"
        "- cbm:symbol:two"
    ]
    assert attached_tools == []
    assert authorities == [
        {
            "projectId": "p",
            "assignmentId": "assignment:t",
            "receiverCardId": "orch",
        }
    ]
    assert mac.ACTIVE_AGENT_ASSIGNMENT_CONTEXT.get() is None

def test_app_authored_scaffold_and_ledger_interception_are_gone():
    for symbol in [
        "select_final_chat_response",
        "_SCAFFOLD_MARKERS",
        "TASK_LEDGER_STOP",
        "LiquidAItyTaskLedgerOrchestrator",
        "LiquidAItyTaskLedgerGroupChat",
        "_progress_ledger_reference",
        "compile_connected_agents",
        "_CapturingMagenticOneGroupChat",
        "_real_task_ledger_artifact",
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


def test_local_coder_participant_is_an_autogen_runtime_adapter_bound_to_openclaude(
    monkeypatch,
):
    captured: dict = {}

    def fake_post(path: str, payload: dict) -> str:
        captured["path"] = path
        captured["payload"] = payload
        return '{"report":{"status":"succeeded"}}'

    monkeypatch.setitem(
        mac.build_local_coder_tool.__globals__,
        "_post_backend_json_sync",
        fake_post,
    )
    context = _tools_context(["run_local_coder"])
    participant = context.cardRuntime.participants[0]
    participant.runtimeBinding = "local_coder"
    participant.provider = "openrouter"
    participant.providerModelId = "deepseek/deepseek-v4-flash-0731"
    participant.reasoningEffort = "medium"
    participant.innerMcpTools = ["cbm.search_graph"]
    coder = mac._build_participants(context, None)[0]
    assert participant.runtimeType == "assistant_agent"
    assert coder.description == "local_coder"
    response = asyncio.run(
        coder.on_messages(
            [TextMessage(content="Inspect the repository.", source="user")],
            CancellationToken(),
        )
    )
    assert captured["path"] == "/api/coder/localcoder/run"
    assert captured["payload"]["coderPacket"]["modelProvider"] == "openrouter"
    assert captured["payload"]["coderPacket"]["providerModelId"] == (
        "deepseek/deepseek-v4-flash-0731"
    )
    assert captured["payload"]["coderPacket"]["reasoningEffort"] == "medium"
    assert captured["payload"]["coderPacket"]["mcpTools"] == ["cbm.search_graph"]
    assert response.chat_message.content == '{"report":{"status":"succeeded"}}'


def test_local_coder_runtime_rejects_any_outer_tool_contract_other_than_run_local_coder():
    context = _tools_context(["run_local_coder", "calculator"])
    context.cardRuntime.participants[0].runtimeBinding = "local_coder"
    with pytest.raises(RuntimeError, match="local_coder_runtime_tool_contract_invalid"):
        mac._build_participants(context, None)


def test_each_participant_receives_its_own_saved_card_model_client():
    first = _FakeToolClient()
    second = _FakeToolClient()
    research, plain = mac._build_participants(
        _tools_context([]),
        [first, second],
    )
    assert research._model_client is first
    assert plain._model_client is second


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
