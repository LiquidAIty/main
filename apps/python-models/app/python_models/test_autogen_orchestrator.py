"""Focused guards for the native AutoGen orchestration boundary."""

import asyncio
from hashlib import sha256

import pytest

from app.python_models import autogen_orchestrator
from app.python_models.autogen_orchestrator import orchestrate_runtime
from app.python_models.idf import render_content_markdown
from app.python_models.orchestration_contracts import InputDataFile, ProjectSession, RuntimeRequest

MODEL = "deepseek/deepseek-v4-flash-0731"


def _runtime_request(runtime_type: str) -> RuntimeRequest:
    card_runtime = {
        "cardId": "card:one",
        "title": "One",
        "runtimeType": runtime_type,
        "prompt": "Saved prompt",
        "provider": "openrouter",
        "accessMode": "openrouter-api",
        "modelKey": MODEL,
        "providerModelId": MODEL,
        "runtimeOptions": {},
        "participants": [],
    }
    content = render_content_markdown(
        system_text="Saved prompt",
        user_text="exact outer assignment",
        card_context=card_runtime,
        dynamic_context_markdown="",
        native_references=[],
    )
    return RuntimeRequest(
        session=ProjectSession(
            sessionId="s", projectId="p", turnId="t", route="r",
            orchestrator="magentic_one" if runtime_type == "magentic_one" else "assistant_agent",
            modelProvider="openrouter", modelKey=MODEL, providerModelId=MODEL,
            startedAt="now",
        ),
        idf=InputDataFile(
            idfId="idf:one", projectId="p", deckId="d", conversationId="c",
            runId="run:one", originatingCardId="card:one", version=1,
            systemText="Saved prompt", userText="exact outer assignment",
            cardContext=card_runtime, dynamicContextMarkdown="", nativeReferences=[],
            modelInputMarkdown=content, contentMarkdown=content,
            contentSha256=sha256(content.encode("utf-8")).hexdigest(),
            createdAt="2026-08-17T00:00:00Z",
        ),
        cardRuntime=card_runtime,
    )


def test_dispatch_selects_single_assistant_inside_python() -> None:
    context = _runtime_request("assistant_agent")
    assert autogen_orchestrator._configured_runtime_handler(
        context.cardRuntime,
    ) is autogen_orchestrator.run_configured_card


def test_dispatch_selects_mag_one_inside_python() -> None:
    context = _runtime_request("magentic_one")
    assert autogen_orchestrator._configured_runtime_handler(
        context.cardRuntime,
    ) is autogen_orchestrator.orchestrate_runtime


def test_orchestrate_requires_saved_card_runtime():
    card_context = {
        "cardId": "card:one", "title": "One", "prompt": "",
        "runtimeType": "magentic_one",
        "accessMode": "openrouter-api",
    }
    content = render_content_markdown(
        system_text="", user_text="hi", card_context=card_context,
        dynamic_context_markdown="", native_references=[],
    )
    context = RuntimeRequest(
        session=ProjectSession(
            sessionId="s", projectId="p", turnId="t", route="r",
            modelProvider="openrouter", modelKey=MODEL, providerModelId=MODEL,
            startedAt="now",
        ),
        idf=InputDataFile(
            idfId="idf:one", projectId="p", deckId="d", conversationId="c",
            runId="run:one", originatingCardId="card:one", version=1,
            systemText="", userText="hi", cardContext=card_context,
            dynamicContextMarkdown="", nativeReferences=[],
            modelInputMarkdown=content, contentMarkdown=content,
            contentSha256=sha256(content.encode("utf-8")).hexdigest(),
            createdAt="2026-08-14T00:00:00Z",
        ),
        cardRuntime=None,
    )
    with pytest.raises(RuntimeError, match="card_runtime_missing"):
        asyncio.run(orchestrate_runtime(context))
