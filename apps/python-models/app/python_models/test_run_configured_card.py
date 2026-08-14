"""Focused canonical-IDF single-card runtime coverage. No provider calls."""

import asyncio
from types import SimpleNamespace

import pytest

from app.python_models import magentic_agentchat as mac
from app.python_models.idf import assemble_input_data_file
from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    CardRuntimeParticipant,
    InputDataFile,
    ProjectSession,
    RuntimeRequest,
)

MODEL = "deepseek/deepseek-v4-flash-0731"


def _context(*, user_text: str = "run", runtime_type: str = "assistant_agent",
             participants: list[CardRuntimeParticipant] | None = None,
             orchestrator: str = "assistant_agent") -> RuntimeRequest:
    document = InputDataFile.model_validate(assemble_input_data_file(
        project_id="p", deck_id="d", conversation_id="c", run_id="run:one",
        originating_card_id="card:one", system_text="saved system",
        user_text=user_text, dynamic_context_markdown="bounded context",
        native_references=[{"authority": "knowgraph", "nativeId": "node:1", "required": True}],
        idf_id="idf:one", created_at="2026-08-14T00:00:00Z",
    ))
    card = CardRuntimeConfig(
        cardId="card:one", title="One", runtimeType=runtime_type,
        participants=participants if participants is not None else [
            CardRuntimeParticipant(
                cardId="card:one", title="One", runtimeType="assistant_agent",
                provider="openrouter", providerModelId=MODEL,
            )
        ],
    )
    return RuntimeRequest(
        session=ProjectSession(
            sessionId="s", projectId="p", turnId="turn:one", runId="run:one",
            route="single_card", orchestrator=orchestrator,
            modelProvider="openrouter", modelKey=MODEL, providerModelId=MODEL,
            startedAt="now",
        ),
        idf=document,
        cardRuntime=card,
    )


@pytest.mark.parametrize(
    ("context", "error"),
    [
        (_context(runtime_type="magentic_one"), "single_card_runtime_invalid"),
        (_context(orchestrator="magentic_one"), "single_card_orchestrator_invalid"),
        (_context(participants=[]), "single_card_participant_count_invalid: 0"),
        (_context(participants=[_context().cardRuntime.participants[0]] * 2), "single_card_participant_count_invalid: 2"),
    ],
)
def test_structural_guard_rejects_invalid_runtime_without_model(context, error):
    assert error in str(mac._validate_single_card_context(context))


def test_single_card_consumes_exact_idf_model_input(monkeypatch):
    observed: list[str] = []

    class Agent:
        async def run(self, *, task):
            observed.append(task)
            return SimpleNamespace(messages=[SimpleNamespace(content="native answer")])

    class Client:
        async def close(self):
            return None

    context = _context()
    monkeypatch.setattr(mac, "_build_model_client", lambda _config: Client())
    monkeypatch.setattr(mac, "_build_participants", lambda *_args, **_kwargs: [Agent()])
    result = asyncio.run(mac.run_configured_card(context))

    assert result.ok is True
    assert result.runId == "run:one"
    assert result.idfId == "idf:one"
    assert observed == [context.idf.modelInputMarkdown]
    assert "bounded context" in observed[0]
    assert "knowgraph:node:1" in observed[0]


def test_single_card_error_never_echoes_idf_secret(monkeypatch):
    secret = "sk-secret-value-that-must-not-escape"
    context = _context(user_text=secret)

    class Agent:
        async def run(self, *, task):
            raise RuntimeError(task)

    monkeypatch.setattr(mac, "_build_model_client", lambda _config: object())
    monkeypatch.setattr(mac, "_build_participants", lambda *_args, **_kwargs: [Agent()])
    result = asyncio.run(mac.run_configured_card(context))
    assert result.error == "single_card_run_failed"
    assert secret not in result.model_dump_json()


def test_unknown_saved_tool_fails_loudly():
    participant = _context().cardRuntime.participants[0].model_copy(
        update={"tools": ["not-a-real-tool"]}
    )
    with pytest.raises(Exception, match="not-a-real-tool"):
        mac._build_participants(_context(participants=[participant]), object())
