"""Focused native Magentic-One/Card-input adapter coverage. No provider calls."""

import asyncio
import inspect
from types import SimpleNamespace

import pytest

from app.python_models import magentic_agentchat as mac
from app.python_models.autogen_provider_env import AutoGenAgentConfig, _build_model_client
from app.python_models.icf import materialize_input_pair
from app.python_models.orchestration_contracts import (
    ProjectSession,
    RuntimeParticipant,
    RuntimeInputFiles,
    RuntimeRequest,
)

MODEL = "gpt-5.6"


def _context() -> RuntimeRequest:
    participants = [
        RuntimeParticipant(
            cardId="signals", title="WorldSignals",
            runtime={"kind": "autogen", "mode": "assistant"},
        ),
        RuntimeParticipant(
            cardId="trading", title="Trading",
            runtime={"kind": "autogen", "mode": "assistant"},
        ),
    ]
    pair = materialize_input_pair(
        owner={"kind": "test", "runId": "mag:one"},
        stable={
            "instructions": "saved orchestrator system", "outputContract": "",
            "runtime": {"kind": "autogen", "mode": "magentic_one"},
            "provider": {
                "accessMode": "openai-api", "provider": "openai",
                "modelKey": MODEL, "providerModelId": MODEL,
            },
        },
        variable={"task": "approved task", "selectedNativeReferences": [], "images": []},
        capabilities={
            "enabledTools": [], "toolDefinitions": [], "nativeTools": [],
            "skills": [], "toolsets": [], "mcpConnectionIds": [],
        },
        allocation={"runtimeOptions": {}},
        graph_context="current native graph data",
        native_references=[],
        graph_projection={"authority": "", "nodes": [], "edges": []},
    )
    return RuntimeRequest(
        session=ProjectSession(
            sessionId="s", projectId="p", deckId="d", cardId="mag:card",
            conversationId="c", turnId="t",
            runId="mag:one", route="r", orchestrator="magentic_one",
            startedAt="now",
        ),
        icf=pair.icf,
        igf=pair.igf,
        inputFiles=RuntimeInputFiles(
            workspace="test", icfPath="test/in.icf", igfPath="test/in.igf",
            icfSha256=pair.icf_sha256, igfSha256=pair.igf_sha256,
            icfBytes=len(pair.icf_bytes), igfBytes=len(pair.igf_bytes),
        ),
        participants=participants,
    )


@pytest.mark.parametrize("max_tokens", [0, -1])
def test_invalid_saved_max_tokens_fails_instead_of_provider_default(max_tokens):
    with pytest.raises(RuntimeError, match=f"card_max_tokens_invalid: {max_tokens}"):
        _build_model_client(AutoGenAgentConfig(
            provider="openai", provider_model_id=MODEL, max_tokens=max_tokens,
        ))


def test_connected_agents_are_saved_display_names():
    assert mac.connected_agent_names(_context()) == ["WorldSignals", "Trading"]


def test_native_mag_one_consumes_canonical_card_input_and_returns_native_ids(monkeypatch):
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
    assert result.finalResponseText == "native final"
    assert tasks == ["current native graph data\n\napproved task"]


def test_native_mag_one_failure_does_not_echo_secret(monkeypatch):
    secret = "provider-secret-must-not-escape"
    context = _context()
    context.icf.variable["task"] = secret
    monkeypatch.setattr(
        mac,
        "_build_model_client",
        lambda _config: (_ for _ in ()).throw(RuntimeError(secret)),
    )
    result = asyncio.run(mac.run_native_magentic_mission(context))
    assert result.error == "magentic_run_failed"
    assert secret not in result.model_dump_json()


def test_saved_card_worker_uses_official_mcp_and_returns_native_output(monkeypatch):
    context = _context()
    agent = mac.McpSavedCardAgent(
        name="WorldSignals", description="autogen/assistant", context=context,
        card_id="signals", outer_run_id="mag:one",
    )

    calls = []

    async def run(**kwargs):
        calls.append(kwargs)
        return {"ok": True, "result": {
            "status": "completed",
            "output": "worker result",
            "correlationId": "child-run-1",
        }}

    monkeypatch.setattr(mac, "call_saved_card_via_mcp", run)
    response = asyncio.run(agent.on_messages(
        [SimpleNamespace(content="subtask", source="orchestrator")],
        mac.CancellationToken(),
    ))
    assert response.chat_message.content == "worker result"
    assert response.chat_message.metadata == {
        "cardId": "signals",
        "childRunId": "child-run-1",
        "originatingRunId": "mag:one",
    }
    assert calls == [{
        "project_id": "p",
        "deck_id": "d",
        "conversation_id": "c",
        "parent_run_id": "mag:one",
        "caller_card_id": "mag:card",
        "caller_runtime_kind": "autogen",
        "caller_runtime_mode": "magentic_one",
        "target_card_id": "signals",
        "input_text": "[orchestrator]\nsubtask",
    }]


def test_native_mag_one_wraps_every_saved_worker_without_worker_model_clients():
    participants = mac._build_participants(
        _context(), outer_run_id="mag:one",
    )
    assert [type(agent) for agent in participants] == [
        mac.McpSavedCardAgent,
        mac.McpSavedCardAgent,
    ]
    source = inspect.getsource(mac.McpSavedCardAgent.on_messages)
    assert "call_saved_card_via_mcp" in source
    assert "control_plane.card_run_assistant_agent" not in source
