"""Focused single-Card runtime coverage. No provider calls."""

import asyncio
from types import SimpleNamespace

from app.python_models import magentic_agentchat as mac
from app.python_models.idf import materialize_idf
from app.python_models.orchestration_contracts import (
    ProjectSession,
    RuntimeInputFile,
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
    materialized = materialize_idf(
        stable={
            "instructions": "saved system",
            "outputContract": "",
            "runtime": {"kind": "autogen", "mode": runtime_mode},
            "runtimeOptions": {},
            "provider": {
                "accessMode": "openai-api", "provider": "openai",
                "modelKey": MODEL, "providerModelId": MODEL,
            },
        },
        variable={"task": user_text, "images": []},
        capabilities={
            "enabledTools": tools,
            "toolDefinitions": [{"name": name} for name in tools],
            "nativeTools": [], "skills": [], "toolsets": [], "mcpConnectionIds": [],
        },
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
        idf=materialized.idf,
        inputFile=RuntimeInputFile(
            workspace="test", idfPath="test/in.idf",
            idfSha256=materialized.idf_sha256,
            idfBytes=len(materialized.idf_bytes),
        ),
    )


def test_structural_guard_rejects_invalid_runtime_without_model() -> None:
    assert "single_card_runtime_invalid" in str(
        mac._validate_single_card_context(_context(runtime_mode="magentic_one"))
    )
    assert "single_card_orchestrator_invalid" in str(
        mac._validate_single_card_context(_context(orchestrator="magentic_one"))
    )


def test_single_card_consumes_graph_first_idf(monkeypatch) -> None:
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
    monkeypatch.setattr(mac, "_build_model_client", lambda _config, **_kwargs: Client())
    monkeypatch.setattr(mac, "AssistantAgent", Agent)
    result = asyncio.run(mac.run_configured_card(context))

    assert result.ok is True
    assert result.runId == "run:one"
    assert observed[0]["system_message"] == context.idf.stableSavedCardContext.instructions
    attached_names = {tool.name for tool in observed[0]["tools"]}
    assert "web_search" not in attached_names
    assert "calculator" in attached_names
    assert attached_names == {"calculator"}
    assert observed[1] == {"task": "current native graph data\n\nrun"}
    assert context.idf.dynamicContext.task == "run"


def test_single_card_with_no_selected_tools_gets_no_global_read_tools(monkeypatch) -> None:
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
    monkeypatch.setattr(mac, "_build_model_client", lambda _config, **_kwargs: Client())
    monkeypatch.setattr(mac, "AssistantAgent", Agent)
    result = asyncio.run(mac.run_configured_card(context))

    assert result.ok is True
    attached_names = {tool.name for tool in observed[0].get("tools", [])}
    assert "web_search" not in attached_names
    assert attached_names == set()
    assert context.idf.selectedToolsAndGrants.enabledTools == []


def test_single_card_error_never_echoes_dynamic_input(monkeypatch) -> None:
    secret = "sk-secret-value-that-must-not-escape"
    context = _context(user_text=secret)
    monkeypatch.setattr(
        mac,
        "_build_model_client",
        lambda _config, **_kwargs: (_ for _ in ()).throw(RuntimeError(secret)),
    )
    result = asyncio.run(mac.run_configured_card(context))
    assert result.error == "single_card_run_failed"
    assert secret not in result.model_dump_json()


def test_unknown_saved_tool_fails_loudly_without_provider_call(monkeypatch) -> None:
    context = _context(enabled_tools=["not-a-real-tool"])
    monkeypatch.setattr(mac, "_build_model_client", lambda _config, **_kwargs: object())
    result = asyncio.run(mac.run_configured_card(context))
    assert result.error == "single_card_run_failed"
