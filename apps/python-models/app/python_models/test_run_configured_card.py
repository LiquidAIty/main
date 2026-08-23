"""Focused single-Card runtime coverage. No provider calls."""

import asyncio
from types import SimpleNamespace

from app.python_models import magentic_agentchat as mac
from app.python_models.icf import materialize_input_pair
from app.python_models.orchestration_contracts import (
    ProjectSession,
    RuntimeInputFiles,
    RuntimeRequest,
)

MODEL = "gpt-5.6"


def _context(
    *,
    user_text: str = "run",
    runtime_mode: str = "assistant",
    orchestrator: str = "assistant_agent",
    enabled_tools: list[str] | None = None,
) -> RuntimeRequest:
    tools = ["calculator"] if enabled_tools is None else enabled_tools
    pair = materialize_input_pair(
        owner={"kind": "test", "runId": "run:one"},
        stable={
            "instructions": "saved system",
            "outputContract": "",
            "runtime": {"kind": "autogen", "mode": runtime_mode},
            "provider": {
                "accessMode": "openai-api", "provider": "openai",
                "modelKey": MODEL, "providerModelId": MODEL,
            },
        },
        variable={"task": user_text, "selectedNativeReferences": [], "images": []},
        capabilities={
            "enabledTools": tools,
            "toolDefinitions": [{"name": name} for name in tools],
            "nativeTools": [], "skills": [], "toolsets": [], "mcpConnectionIds": [],
        },
        allocation={"runtimeOptions": {}},
        graph_context="current native graph data",
        native_references=[],
        graph_projection={"authority": "", "nodes": [], "edges": []},
    )
    return RuntimeRequest(
        session=ProjectSession(
            sessionId="s", projectId="p", deckId="d", cardId="card:one",
            conversationId="c", turnId="turn:one", runId="run:one",
            route="single_card", orchestrator=orchestrator, startedAt="now",
        ),
        icf=pair.icf,
        igf=pair.igf,
        inputFiles=RuntimeInputFiles(
            workspace="test", icfPath="test/in.icf", igfPath="test/in.igf",
            icfSha256=pair.icf_sha256, igfSha256=pair.igf_sha256,
            icfBytes=len(pair.icf_bytes), igfBytes=len(pair.igf_bytes),
        ),
    )


def test_structural_guard_rejects_invalid_runtime_without_model() -> None:
    assert "single_card_runtime_invalid" in str(
        mac._validate_single_card_context(_context(runtime_mode="magentic_one"))
    )
    assert "single_card_orchestrator_invalid" in str(
        mac._validate_single_card_context(_context(orchestrator="magentic_one"))
    )


def test_single_card_consumes_one_python_materialization(monkeypatch) -> None:
    observed: list[dict] = []

    class Agent:
        def __init__(self, **kwargs):
            observed.append(kwargs)

        async def run(self, *, task):
            observed.append({"task": task})
            return SimpleNamespace(messages=[SimpleNamespace(content="native answer")])

    class Client:
        async def close(self):
            return None

    context = _context()
    monkeypatch.setattr(mac, "_build_model_client", lambda _config: Client())
    monkeypatch.setattr(mac, "AssistantAgent", Agent)
    result = asyncio.run(mac.run_configured_card(context))

    assert result.ok is True
    assert result.runId == "run:one"
    assert observed[0]["system_message"] == context.icf.stable["instructions"]
    attached_names = {tool.name for tool in observed[0]["tools"]}
    assert "web_search" in attached_names
    assert "calculator" in attached_names
    assert observed[1] == {"task": "current native graph data\n\nrun"}
    assert context.icf.variable["task"] == "run"
    assert "card:one" not in context.icf.variable["task"]


def test_single_card_gets_idd_reads_without_copying_them_into_card_tools(
    monkeypatch,
) -> None:
    observed: list[dict] = []

    class Agent:
        def __init__(self, **kwargs):
            observed.append(kwargs)

        async def run(self, *, task):
            return SimpleNamespace(messages=[SimpleNamespace(content="native answer")])

    class Client:
        async def close(self):
            return None

    context = _context(enabled_tools=[])
    monkeypatch.setattr(mac, "_build_model_client", lambda _config: Client())
    monkeypatch.setattr(mac, "AssistantAgent", Agent)

    result = asyncio.run(mac.run_configured_card(context))

    assert result.ok is True
    attached_names = {tool.name for tool in observed[0]["tools"]}
    assert "web_search" in attached_names
    assert context.icf.capabilities["enabledTools"] == []


def test_single_card_error_never_echoes_dynamic_input(monkeypatch) -> None:
    secret = "sk-secret-value-that-must-not-escape"
    context = _context(user_text=secret)
    monkeypatch.setattr(
        mac,
        "_build_model_client",
        lambda _config: (_ for _ in ()).throw(RuntimeError(secret)),
    )
    result = asyncio.run(mac.run_configured_card(context))
    assert result.error == "single_card_run_failed"
    assert secret not in result.model_dump_json()


def test_unknown_saved_tool_fails_loudly_without_provider_call(monkeypatch) -> None:
    context = _context(enabled_tools=["not-a-real-tool"])
    monkeypatch.setattr(mac, "_build_model_client", lambda _config: object())
    result = asyncio.run(mac.run_configured_card(context))
    assert result.error == "single_card_run_failed"
