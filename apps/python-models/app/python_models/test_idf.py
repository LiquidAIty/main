from __future__ import annotations

import inspect

from app.python_models.idf import Idf, materialize_idf


def test_materializer_combines_only_card_state_and_current_input() -> None:
    result = materialize_idf(
        system_prompt="saved system prompt",
        dynamic_input="current assignment",
        runtime={"kind": "hermes", "mode": "kanban", "profile": "helper"},
        provider={
            "accessMode": "chatgpt-account", "provider": "openai-codex",
            "modelKey": "gpt-5.6-luna", "providerModelId": "gpt-5.6-luna",
        },
        runtime_options={"reasoningEffort": "medium"},
        context_markdown="selected native context",
        output_requirements="return a bounded answer",
        enabled_tools=["graphiti.search_nodes"],
        tool_definitions=[{
            "name": "graphiti.search_nodes",
            "description": "Search KnowGraph",
            "inputSchema": {"type": "object"},
        }],
        native_tools=["memory"],
        skills=["research"],
        toolsets=["kanban"],
        mcp_connection_ids=["official"],
        native_references=[{
            "authority": "KnowGraph",
            "nativeId": "node-one",
            "reason": "selected by the caller",
        }],
    )

    assert result == Idf(
        systemPrompt="saved system prompt",
        message=(
            "selected native context\n\n"
            "current assignment\n\n"
            "Output requirements:\nreturn a bounded answer"
        ),
        runtime={"kind": "hermes", "mode": "kanban", "profile": "helper"},
        provider={
            "accessMode": "chatgpt-account", "provider": "openai-codex",
            "modelKey": "gpt-5.6-luna", "providerModelId": "gpt-5.6-luna",
        },
        runtimeOptions={"reasoningEffort": "medium"},
        enabledTools=["graphiti.search_nodes"],
        toolDefinitions=[{
            "name": "graphiti.search_nodes",
            "description": "Search KnowGraph",
            "inputSchema": {"type": "object"},
        }],
        nativeTools=["memory"],
        skills=["research"],
        toolsets=["kanban"],
        mcpConnectionIds=["official"],
        nativeReferences=[{
            "authority": "KnowGraph",
            "nativeId": "node-one",
            "reason": "selected by the caller",
        }],
        images=[],
    )


def test_materializer_does_not_add_card_run_receipt_or_persistence_data() -> None:
    result = materialize_idf(
        system_prompt="stable",
        dynamic_input="dynamic",
        runtime={"kind": "autogen", "mode": "assistant"},
        provider={
            "accessMode": "openrouter-api", "provider": "openrouter",
            "modelKey": "model", "providerModelId": "model",
        },
        enabled_tools=[],
        tool_definitions=[],
    ).model_dump()

    assert result == {
        "systemPrompt": "stable",
        "message": "dynamic",
        "runtime": {"kind": "autogen", "mode": "assistant"},
        "provider": {
            "accessMode": "openrouter-api", "provider": "openrouter",
            "modelKey": "model", "providerModelId": "model",
        },
        "runtimeOptions": {},
        "enabledTools": [],
        "toolDefinitions": [],
        "nativeTools": [],
        "skills": [],
        "toolsets": [],
        "mcpConnectionIds": [],
        "nativeReferences": [],
        "images": [],
    }
    source = inspect.getsource(materialize_idf)
    for forbidden in (
        "cardId", "runId", "receipt", "hash", "revision", "approve", "persist",
    ):
        assert forbidden not in source


def test_empty_dynamic_model_input_is_rejected() -> None:
    try:
        materialize_idf(
            system_prompt="stable",
            dynamic_input="   ",
            runtime={"kind": "autogen", "mode": "assistant"},
            provider={
                "accessMode": "openrouter-api", "provider": "openrouter",
                "modelKey": "model", "providerModelId": "model",
            },
            enabled_tools=[],
            tool_definitions=[],
        )
    except ValueError:
        pass
    else:
        raise AssertionError("empty model input was accepted")
