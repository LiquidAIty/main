"""Focused native Magentic-One/Card-input adapter coverage. No provider calls."""

import asyncio
import inspect
from types import SimpleNamespace

import pytest

from app.python_models import magentic_agentchat as mac
from app.python_models.autogen_provider_env import AutoGenAgentConfig, _build_model_client
from app.python_models.codex_app_server_model_client import (
    CodexAppServerChatCompletionClient,
    CodexAppServerError,
)
from autogen_ext.models.openai import OpenAIChatCompletionClient
from app.python_models.idf import materialize_idf
from app.python_models.orchestration_contracts import (
    ProjectSession,
    RuntimeParticipant,
    RuntimeInputFile,
    RuntimeRequest,
)

MODEL = "gpt-5.6"


def _context() -> RuntimeRequest:
    participants = [
        RuntimeParticipant(
            cardId="coder", title="Coder",
            runtime={"kind": "hermes", "mode": "delegate", "profile": "coder"},
        ),
        RuntimeParticipant(
            cardId="trading", title="Trading",
            runtime={"kind": "autogen", "mode": "assistant"},
        ),
    ]
    reference = {
        "authority": "CodeGraph",
        "nativeId": "project.module.target",
        "nativeKind": "node",
        "reason": "Forward this exact selected symbol.",
        "asOf": "2026-08-24T00:00:00Z",
        "required": True,
        "provenance": {"repository": "C-Projects-LiquidAIty-main"},
        "selectionScope": {"boundedExpansion": 0, "resultLimit": 6},
    }
    materialized = materialize_idf(
        stable={
            "instructions": "saved orchestrator system", "outputContract": "",
            "runtime": {"kind": "autogen", "mode": "magentic_one"},
            "runtimeOptions": {},
            "provider": {
                "accessMode": "openai-api", "provider": "openai",
                "modelKey": MODEL, "providerModelId": MODEL,
            },
        },
        variable={"task": "approved task", "images": []},
        capabilities={
            "enabledTools": [], "toolDefinitions": [], "nativeTools": [],
            "skills": [], "toolsets": [], "mcpConnectionIds": [],
        },
        graph_context="current native graph data",
        native_references=[reference],
        graph_projection={
            "authority": "CodeGraph",
            "nodes": [{
                "id": "project.module.target",
                "authority": "CodeGraph",
                "type": "Function",
                "provenance": {"repository": "C-Projects-LiquidAIty-main"},
            }],
            "edges": [],
        },
    )
    return RuntimeRequest(
        session=ProjectSession(
            sessionId="s", projectId="p", deckId="d", cardId="mag:card",
            conversationId="c", turnId="t",
            runId="mag:one", route="r", orchestrator="magentic_one",
            startedAt="now",
        ),
        idf=materialized.idf,
        inputFile=RuntimeInputFile(
            workspace="test", idfPath="test/in.idf",
            idfSha256=materialized.idf_sha256,
            idfBytes=len(materialized.idf_bytes),
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
    assert mac.connected_agent_names(_context()) == ["Coder", "Trading"]


def test_mag_one_chatgpt_account_selects_only_the_app_server_client(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-be-read-for-this-path")
    client = _build_model_client(
        AutoGenAgentConfig(
            provider="openai",
            provider_model_id="gpt-5.6-sol",
            access_mode="chatgpt-account",
        ),
        runtime_mode="magentic_one",
    )
    assert isinstance(client, CodexAppServerChatCompletionClient)
    asyncio.run(client.close())


def test_arbitrary_autogen_assistant_cannot_use_chatgpt_account():
    with pytest.raises(
        RuntimeError,
        match="autogen_chatgpt_account_not_supported_for_assistant",
    ):
        _build_model_client(
            AutoGenAgentConfig(
                provider="openai",
                provider_model_id="gpt-5.6-sol",
                access_mode="chatgpt-account",
            ),
            runtime_mode="assistant",
        )


def test_existing_openai_api_and_openrouter_paths_remain_selected(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")
    clients = [
        _build_model_client(AutoGenAgentConfig(
            provider="openai",
            provider_model_id="gpt-5.6",
            access_mode="openai-api",
        )),
        _build_model_client(AutoGenAgentConfig(
            provider="openrouter",
            provider_model_id="openai/gpt-5.6",
            access_mode="openrouter-api",
        )),
    ]
    assert all(isinstance(client, OpenAIChatCompletionClient) for client in clients)
    for client in clients:
        asyncio.run(client.close())


@pytest.mark.parametrize(
    ("provider", "access_mode"),
    [
        ("openrouter", "chatgpt-account"),
        ("openai", "openrouter-api"),
    ],
)
def test_invalid_provider_access_mode_combinations_fail(provider, access_mode):
    with pytest.raises(RuntimeError, match="autogen_provider_access_mode_invalid"):
        _build_model_client(
            AutoGenAgentConfig(
                provider=provider,
                provider_model_id="gpt-5.6-sol",
                access_mode=access_mode,
            ),
            runtime_mode="magentic_one",
        )


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
    monkeypatch.setattr(mac, "_build_model_client", lambda _config, **_kwargs: Client())
    monkeypatch.setattr(mac, "_build_participants", lambda *_args, **_kwargs: [
        SimpleNamespace(name="Coder", description="Coder"),
        SimpleNamespace(name="Trading", description="Trading"),
    ])
    monkeypatch.setattr(mac, "MagenticOneGroupChat", Team)
    result = asyncio.run(mac.run_native_magentic_mission(context))

    assert result.ok is True
    assert result.runId == "mag:one"
    assert result.finalResponseText == "native final"
    assert tasks == ["current native graph data\n\napproved task"]


def test_native_mag_one_failure_does_not_echo_secret(monkeypatch, capsys):
    secret = "provider-secret-must-not-escape"
    context = _context()
    context.idf.dynamicContext.task = secret
    monkeypatch.setattr(
        mac,
        "_build_model_client",
        lambda _config, **_kwargs: (_ for _ in ()).throw(RuntimeError(secret)),
    )
    result = asyncio.run(mac.run_native_magentic_mission(context))
    assert result.error == "magentic_run_failed"
    assert secret not in result.model_dump_json()
    captured = capsys.readouterr()
    assert "RuntimeError" in captured.out
    assert secret not in captured.out


def test_native_mag_one_logs_only_stable_app_server_failure_code(monkeypatch, capsys):
    secret = "provider-secret-must-not-escape"
    failure_code = "codex_app_server_turn_failed"
    context = _context()
    context.idf.dynamicContext.task = secret
    monkeypatch.setattr(
        mac,
        "_build_model_client",
        lambda _config, **_kwargs: (_ for _ in ()).throw(
            CodexAppServerError(failure_code)
        ),
    )

    result = asyncio.run(mac.run_native_magentic_mission(context))

    assert result.error == "magentic_run_failed"
    assert result.runtimeEvidence["failure"]["failure_code"] == failure_code
    assert secret not in result.model_dump_json()
    captured = capsys.readouterr()
    assert "CodexAppServerError" in captured.out
    assert failure_code in captured.out
    assert secret not in captured.out


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
        "data_anchors": [{
            "authority": "CodeGraph",
            "nativeId": "project.module.target",
            "reason": "Forward this exact selected symbol.",
            "priority": 0,
            "boundedExpansion": 0,
            "resultLimit": 6,
            "required": True,
        }],
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
    participant_source = inspect.getsource(mac._build_participants)
    assert "McpSavedCardAgent" in participant_source
    assert "AssistantAgent" not in participant_source
    assert "_build_model_client" not in participant_source
    assert "memory" not in participant_source.lower()
