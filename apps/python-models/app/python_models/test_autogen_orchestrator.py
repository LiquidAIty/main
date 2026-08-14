"""Focused guards for the native AutoGen orchestration boundary."""

import asyncio

import pytest

from app.python_models.autogen_orchestrator import orchestrate_runtime
from app.python_models.idf import assemble_input_data_file
from app.python_models.orchestration_contracts import InputDataFile, ProjectSession, RuntimeRequest

MODEL = "deepseek/deepseek-v4-flash-0731"


def test_orchestrate_requires_saved_card_runtime():
    context = RuntimeRequest(
        session=ProjectSession(
            sessionId="s", projectId="p", turnId="t", route="r",
            modelProvider="openrouter", modelKey=MODEL, providerModelId=MODEL,
            startedAt="now",
        ),
        idf=InputDataFile.model_validate(assemble_input_data_file(
            project_id="p", deck_id="d", conversation_id="c", run_id="run:one",
            originating_card_id="card:one", system_text="", user_text="hi",
            card_context={
                "cardId": "card:one", "title": "One", "prompt": "",
                "runtimeType": "magentic_one",
            },
        )),
        cardRuntime=None,
    )
    with pytest.raises(RuntimeError, match="card_runtime_missing"):
        asyncio.run(orchestrate_runtime(context))
