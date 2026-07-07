"""Focused single-card runtime coverage. No network/model call.

Proves: the structural guard is honest (magentic runtime rejected, orchestrator
mismatch rejected, participant count enforced, empty task rejected), a guard
failure produces zero Task Ledger output, and the single participant is built
through the SAME shared builder the Mag One path uses (same tool registry with
loud unknown-tool failure — never silently dropped).
"""
import asyncio

import pytest

from app.python_models import magentic_agentchat as mac
from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    CardRuntimeParticipant,
    ContextPack,
    ProjectSession,
    ResultFolder,
)

MODEL = "openai/gpt-5.1-chat"


class _FakeToolClient:
    """Minimal model client: AssistantAgent only checks model_info for tools."""

    model_info = {"function_calling": True}


def _session(orchestrator: str = "assistant_agent") -> ProjectSession:
    return ProjectSession(
        sessionId="s", projectId="p", turnId="corr-1", route="single_card",
        orchestrator=orchestrator, modelProvider="openrouter",
        modelKey="gpt-5.1-chat", providerModelId=MODEL, startedAt="now",
    )


def _participant(tools: list[str] | None = None) -> CardRuntimeParticipant:
    return CardRuntimeParticipant(
        cardId="tg", title="ThinkGraph Agent", runtimeType="assistant_agent",
        role="thinkgraph", tools=tools or [], provider="openrouter", providerModelId=MODEL,
    )


def _context(
    user_text: str = "run",
    runtime_type: str = "assistant_agent",
    participants: list[CardRuntimeParticipant] | None = None,
    orchestrator: str = "assistant_agent",
) -> ContextPack:
    card = CardRuntimeConfig(
        cardId="tg", title="ThinkGraph Agent", runtimeType=runtime_type,
        participants=[_participant()] if participants is None else participants,
    )
    return ContextPack(session=_session(orchestrator), userText=user_text, cardRuntime=card)


# --------------------------------------------------------------------------- #
# structural guard — pure, honest, no model construction
# --------------------------------------------------------------------------- #
class TestSingleCardGuard:
    def test_valid_single_card_context_passes(self):
        assert mac._validate_single_card_context(_context()) is None

    def test_magentic_runtime_type_is_rejected(self):
        err = mac._validate_single_card_context(_context(runtime_type="magentic_one"))
        assert err is not None and "single_card_runtime_invalid" in err

    def test_orchestrator_mismatch_is_rejected(self):
        err = mac._validate_single_card_context(_context(orchestrator="magentic_one"))
        assert err is not None and "single_card_orchestrator_invalid" in err

    def test_zero_participants_rejected(self):
        err = mac._validate_single_card_context(_context(participants=[]))
        assert err is not None and "single_card_participant_count_invalid: 0" in err

    def test_two_participants_rejected(self):
        err = mac._validate_single_card_context(
            _context(participants=[_participant(), _participant()])
        )
        assert err is not None and "single_card_participant_count_invalid: 2" in err

    def test_empty_task_rejected(self):
        err = mac._validate_single_card_context(_context(user_text="   "))
        assert err is not None and err == "empty_user_message"


# --------------------------------------------------------------------------- #
# guard failure path — honest error, zero Task Ledger, no model client built
# --------------------------------------------------------------------------- #
class TestGuardFailureResponse:
    def test_guard_failure_returns_honest_error_and_no_task_ledger(self):
        response = asyncio.run(mac.run_configured_card(_context(participants=[])))
        assert response.ok is False
        assert "single_card_participant_count_invalid" in (response.error or "")
        assert response.finalResponseText == ""
        assert response.taskLedgerArtifact is None
        assert response.session.turnId == "corr-1"  # correlation preserved

    def test_invalid_result_folder_fails_honestly_before_any_model_call(self):
        # A standalone run assigned a returns folder it cannot resolve fails honestly
        # (never silently writes elsewhere). This runs before the model client is built.
        ctx = _context()
        ctx.resultFolder = ResultFolder(workspaceRoot="C:/does/not/exist/xyz123", runId="run_x")
        response = asyncio.run(mac.run_configured_card(ctx))
        assert response.ok is False
        assert "result_folder_unresolved" in (response.error or "")


# --------------------------------------------------------------------------- #
# shared builder reuse — the SAME code path Mag One participants use
# --------------------------------------------------------------------------- #
class TestSharedBuilderReuse:
    def test_single_participant_built_via_shared_builder(self):
        agents = mac._build_participants(_context(), _FakeToolClient())
        assert len(agents) == 1
        assert agents[0].name == "ThinkGraph_Agent"

    def test_unknown_tool_fails_loudly_never_silently_dropped(self):
        ctx = _context(participants=[_participant(tools=["not_a_real_tool"])])
        with pytest.raises(RuntimeError):
            mac._build_participants(ctx, _FakeToolClient())
