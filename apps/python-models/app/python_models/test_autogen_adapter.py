"""Focused native Magentic-One/IDF adapter coverage. No provider calls."""

import asyncio
from types import SimpleNamespace

import pytest

from app.python_models import magentic_agentchat as mac
from app.python_models.autogen_provider_env import AutoGenAgentConfig, _build_model_client
from app.python_models.idf import assemble_input_data_file
from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    CardRuntimeParticipant,
    InputDataFile,
    ProjectSession,
    RuntimeRequest,
)

MODEL = "deepseek/deepseek-v4-flash-0731"


def _context() -> RuntimeRequest:
    idf = InputDataFile.model_validate(assemble_input_data_file(
        project_id="p", deck_id="d", conversation_id="c", run_id="mag:one",
        originating_card_id="mag:card", system_text="saved orchestrator system",
        user_text="approved task", dynamic_context_markdown="native context",
        idf_id="idf:mag", created_at="2026-08-14T00:00:00Z",
    ))
    participants = [
        CardRuntimeParticipant(
            cardId="research", title="Research Agent", runtimeType="assistant_agent",
            runtimeBinding="hermes_steward", provider="openrouter", providerModelId=MODEL,
        ),
        CardRuntimeParticipant(
            cardId="coder", title="Coder", runtimeType="assistant_agent",
            runtimeBinding="local_coder", provider="openrouter", providerModelId=MODEL,
        ),
    ]
    return RuntimeRequest(
        session=ProjectSession(
            sessionId="s", projectId="p", turnId="t", runId="mag:one", route="r",
            orchestrator="magentic_one", modelProvider="openrouter", modelKey=MODEL,
            providerModelId=MODEL, startedAt="now",
        ),
        idf=idf,
        cardRuntime=CardRuntimeConfig(
            cardId="mag:card", title="Mag One", runtimeType="magentic_one",
            runtimeOptions={"deckId": "d"}, participants=participants,
        ),
    )


@pytest.mark.parametrize("max_tokens", [0, -1])
def test_invalid_saved_max_tokens_fails_instead_of_provider_default(max_tokens):
    with pytest.raises(RuntimeError, match=f"card_max_tokens_invalid: {max_tokens}"):
        _build_model_client(AutoGenAgentConfig(
            provider="openrouter", provider_model_id=MODEL, max_tokens=max_tokens,
        ))


def test_connected_agents_are_saved_display_names():
    assert mac.connected_agent_names(_context()) == ["Research Agent", "Coder"]


def test_native_mag_one_consumes_exact_idf_and_returns_native_ids(monkeypatch):
    tasks: list[str] = []

    class Client:
        async def close(self):
            return None

    class Team:
        def __init__(self, **kwargs):
            assert len(kwargs["participants"]) == 2

        async def run_stream(self, *, task):
            tasks.append(task)
            yield SimpleNamespace(source="Research_Agent", content="working")
            yield SimpleNamespace(
                messages=[SimpleNamespace(content="native final")], stop_reason="done"
            )

    context = _context()
    monkeypatch.setattr(mac, "_build_model_client", lambda _config: Client())
    monkeypatch.setattr(mac, "_build_participants", lambda *_args, **_kwargs: [object(), object()])
    monkeypatch.setattr(mac, "MagenticOneGroupChat", Team)
    result = asyncio.run(mac.run_native_magentic_mission(context))

    assert result.ok is True
    assert result.runId == "mag:one"
    assert result.idfId == "idf:mag"
    assert result.finalResponseText == "native final"
    assert tasks == [context.idf.modelInputMarkdown]


def test_native_mag_one_failure_does_not_echo_secret(monkeypatch):
    secret = "provider-secret-must-not-escape"
    context = _context()
    context.idf.modelInputMarkdown = secret
    monkeypatch.setattr(mac, "_build_model_client", lambda _config: (_ for _ in ()).throw(RuntimeError(secret)))
    result = asyncio.run(mac.run_native_magentic_mission(context))
    assert result.error == "magentic_run_failed"
    assert secret not in result.model_dump_json()


def test_saved_hermes_worker_returns_native_output_and_id_metadata(monkeypatch):
    context = _context()
    agent = mac.SavedHermesCardAgent(
        name="Research_Agent", description="hermes_steward", context=context,
        card_id="research", outer_run_id="mag:one",
    )

    async def run(_args):
        return {"ok": True, "result": {"status": "completed", "output": "worker result"}}

    monkeypatch.setattr(mac.control_plane, "card_run_assistant_agent", run)
    response = asyncio.run(agent.on_messages(
        [SimpleNamespace(content="subtask", source="orchestrator")],
        mac.CancellationToken(),
    ))
    assert response.chat_message.content == "worker result"
    assert response.chat_message.metadata == {
        "cardId": "research", "originatingRunId": "mag:one", "idfId": "idf:mag"
    }
