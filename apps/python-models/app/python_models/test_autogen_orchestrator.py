"""Focused guards for the native AutoGen orchestration boundary."""

import asyncio

import pytest

from app.python_models import autogen_orchestrator
from app.python_models.autogen_orchestrator import orchestrate_runtime
from app.python_models.idf import materialize_idf
from app.python_models.orchestration_contracts import ProjectSession, RuntimeRequest

MODEL = "deepseek/deepseek-v4-flash-0731"


def _runtime_request(runtime_mode: str) -> RuntimeRequest:
    return RuntimeRequest(
        session=ProjectSession(
            sessionId="s", projectId="p", deckId="d", cardId="card:one",
            conversationId="c", turnId="t", route="r",
            orchestrator=(
                "magentic_one" if runtime_mode == "magentic_one"
                else "assistant_agent"
            ),
            startedAt="now",
        ),
        idf=materialize_idf(
            system_prompt="Saved prompt",
            dynamic_input="exact outer assignment",
            runtime={"kind": "autogen", "mode": runtime_mode},
            provider={
                "accessMode": "openrouter-api", "provider": "openrouter",
                "modelKey": MODEL, "providerModelId": MODEL,
            },
            enabled_tools=[],
            tool_definitions=[],
        ),
    )


def test_dispatch_selects_single_assistant_inside_python() -> None:
    context = _runtime_request("assistant")
    assert autogen_orchestrator._configured_runtime_handler(
        context.idf.runtime,
    ) is autogen_orchestrator.run_configured_card


def test_dispatch_selects_mag_one_inside_python() -> None:
    context = _runtime_request("magentic_one")
    assert autogen_orchestrator._configured_runtime_handler(
        context.idf.runtime,
    ) is autogen_orchestrator.orchestrate_runtime


def test_orchestrate_rejects_non_magentic_materialization() -> None:
    with pytest.raises(RuntimeError, match="orchestrator_card_required"):
        asyncio.run(orchestrate_runtime(_runtime_request("assistant")))
