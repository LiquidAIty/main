"""Focused guards for the native AutoGen orchestration boundary."""

import asyncio
from hashlib import sha256

import pytest

from app.python_models.autogen_orchestrator import orchestrate_runtime
from app.python_models.idf import render_content_markdown
from app.python_models.orchestration_contracts import InputDataFile, ProjectSession, RuntimeRequest

MODEL = "deepseek/deepseek-v4-flash-0731"


def test_orchestrate_requires_saved_card_runtime():
    card_context = {
        "cardId": "card:one", "title": "One", "prompt": "",
        "runtimeType": "magentic_one",
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
