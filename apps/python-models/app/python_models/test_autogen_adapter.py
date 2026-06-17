"""Focused adapter contract coverage. No network/model call.

Proves: connected agents are passed as plain names, the empty-message branch is
an honest error, and app-authored scaffold runtimes stay removed while the real
AutoGen Task Ledger artifact path remains allowed.
"""
import asyncio

from app.python_models import magentic_agentchat as mac
from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    CardRuntimeParticipant,
    ContextPack,
    ProjectSession,
)

MODEL = "openai/gpt-5.1-chat"


def _context_pack(user_text: str) -> ContextPack:
    card = CardRuntimeConfig(
        cardId="orch", title="Mag One", runtimeType="magentic_one",
        participants=[
            CardRuntimeParticipant(cardId="r", title="Research Agent", runtimeType="assistant_agent",
                                   role="research", provider="openrouter", providerModelId=MODEL),
            CardRuntimeParticipant(cardId="t", title="Trading Agent", runtimeType="assistant_agent",
                                   role="trading", provider="openrouter", providerModelId=MODEL),
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
