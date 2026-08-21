"""Focused single-Card runtime coverage. No provider calls."""

import asyncio
from types import SimpleNamespace

from app.python_models import magentic_agentchat as mac
from app.python_models.idf import materialize_idf
from app.python_models.orchestration_contracts import ProjectSession, RuntimeRequest

MODEL = "deepseek/deepseek-v4-flash-0731"


def _context(
    *,
    user_text: str = "run",
    runtime_mode: str = "assistant",
    orchestrator: str = "assistant_agent",
    enabled_tools: list[str] | None = None,
) -> RuntimeRequest:
    tools = ["calculator"] if enabled_tools is None else enabled_tools
    return RuntimeRequest(
        session=ProjectSession(
            sessionId="s", projectId="p", deckId="d", cardId="card:one",
            conversationId="c", turnId="turn:one", runId="run:one",
            route="single_card", orchestrator=orchestrator, startedAt="now",
        ),
        idf=materialize_idf(
            system_prompt="saved system",
            dynamic_input=user_text,
            context_markdown="bounded context",
            runtime={"kind": "autogen", "mode": runtime_mode},
            provider={
                "accessMode": "openrouter-api", "provider": "openrouter",
                "modelKey": MODEL, "providerModelId": MODEL,
            },
            enabled_tools=tools,
            tool_definitions=[{"name": name} for name in tools],
            native_references=[{
                "authority": "knowgraph", "nativeId": "node:1",
                "reason": "bounded runtime context",
                "asOf": "2026-08-14T00:00:00Z", "required": True,
            }],
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
    assert observed[0]["system_message"] == context.idf.systemPrompt
    attached_names = {tool.name for tool in observed[0]["tools"]}
    assert "web_search" in attached_names
    assert "calculator" in attached_names
    assert observed[1] == {"task": context.idf.message}
    assert context.idf.message == "bounded context\n\nrun"
    assert "card:one" not in context.idf.message


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
    assert context.idf.enabledTools == []


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
