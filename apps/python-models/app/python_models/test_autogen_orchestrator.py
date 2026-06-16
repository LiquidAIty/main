"""Focused coverage for the orchestrate_context_pack runtime boundary guards.

These assert the strict card requirements without any model/network call.
"""
import asyncio

import pytest

from app.python_models.autogen_orchestrator import orchestrate_context_pack
from app.python_models.orchestration_contracts import ContextPack, ProjectSession

MODEL = "openai/gpt-5.1-chat"


def _session() -> ProjectSession:
    return ProjectSession(
        sessionId="s", projectId="p", turnId="t", route="r",
        modelProvider="openrouter", modelKey="gpt-5.1-chat", providerModelId=MODEL,
        startedAt="now",
    )


def test_orchestrate_requires_card_runtime():
    ctx = ContextPack(session=_session(), userText="hi", cardRuntime=None)
    with pytest.raises(RuntimeError, match="card_runtime_missing"):
        asyncio.run(orchestrate_context_pack(ctx))
