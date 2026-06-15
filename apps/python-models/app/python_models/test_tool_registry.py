"""T001 ToolSpec / ToolRegistry tests.

Proves: selected enabled schema-complete tools resolve to real FunctionTools;
unknown, empty, disabled, unselected, and schema-missing tools fail loudly;
current_datetime and calculator keep real FunctionTool behavior; no fallback
or substitution occurs.
"""

from __future__ import annotations

import asyncio
import inspect
from datetime import datetime

import pytest
from pydantic import ValidationError

from autogen_core import CancellationToken
from autogen_core.tools import FunctionTool

from app.python_models.orchestration_contracts import ToolSpec
from app.python_models.tool_registry import (
    DEFAULT_TOOL_REGISTRY,
    ToolRegistry,
    _post_console_task,
    build_default_tool_registry,
    build_compact_coder_prompt,
    coder_console_task,
    reset_current_coder_dispatch_future,
    reset_current_coder_tool_context,
    set_current_coder_dispatch_future,
    set_current_coder_tool_context,
    tool_calculator,
    tool_current_datetime,
)


def _valid_spec(**overrides) -> ToolSpec:
    payload = {
        "name": "sample_tool",
        "description": "A sample tool.",
        "enabled": True,
        "inputSchema": {"type": "object", "properties": {}, "required": []},
        "outputSchema": {"type": "string"},
    }
    payload.update(overrides)
    return ToolSpec(**payload)


# ---------------------------------------------------------------------------
# ToolSpec contract validation.
# ---------------------------------------------------------------------------


def test_toolspec_rejects_empty_name():
    with pytest.raises(ValidationError):
        _valid_spec(name="   ")


def test_toolspec_rejects_missing_input_schema():
    with pytest.raises(ValidationError):
        ToolSpec(
            name="sample_tool",
            description="A sample tool.",
            enabled=True,
            outputSchema={"type": "string"},
        )


def test_toolspec_rejects_missing_output_schema():
    with pytest.raises(ValidationError):
        ToolSpec(
            name="sample_tool",
            description="A sample tool.",
            enabled=True,
            inputSchema={"type": "object"},
        )


def test_toolspec_rejects_empty_schema():
    with pytest.raises(ValidationError, match="tool_schema_missing"):
        _valid_spec(inputSchema={})


def test_toolspec_rejects_schema_incomplete():
    with pytest.raises(ValidationError, match="tool_schema_incomplete"):
        _valid_spec(inputSchema={"properties": {}})


# ---------------------------------------------------------------------------
# ToolRegistry resolution.
# ---------------------------------------------------------------------------


def test_resolves_current_datetime_as_real_function_tool():
    tools = DEFAULT_TOOL_REGISTRY.resolve_selected(["current_datetime"])
    assert len(tools) == 1
    assert isinstance(tools[0], FunctionTool)
    assert tools[0].name == "current_datetime"
    value = asyncio.run(tools[0].run_json({}, CancellationToken()))
    # ISO-8601 parseable timestamp from the real adapter.
    datetime.fromisoformat(tools[0].return_value_as_string(value))


def test_resolves_calculator_with_real_function_tool_behavior():
    tools = DEFAULT_TOOL_REGISTRY.resolve_selected(["calculator"])
    assert len(tools) == 1
    assert tools[0].name == "calculator"
    value = asyncio.run(tools[0].run_json({"expression": "2+3*4"}, CancellationToken()))
    assert tools[0].return_value_as_string(value) == "14.0"


def test_unknown_tool_fails_loudly():
    with pytest.raises(RuntimeError, match="card_tool_unknown: nonexistent_tool"):
        DEFAULT_TOOL_REGISTRY.resolve_selected(["nonexistent_tool"])


def test_empty_tool_name_fails_loudly():
    with pytest.raises(RuntimeError, match="card_tool_name_empty"):
        DEFAULT_TOOL_REGISTRY.resolve_selected(["   "])


def test_disabled_tool_fails_loudly():
    registry = ToolRegistry()
    registry.register(_valid_spec(name="off_tool", enabled=False), lambda: "x")
    with pytest.raises(RuntimeError, match="card_tool_disabled: off_tool"):
        registry.resolve_selected(["off_tool"])


def test_registered_but_unselected_tool_cannot_resolve():
    tools = DEFAULT_TOOL_REGISTRY.resolve_selected(["calculator"])
    assert [tool.name for tool in tools] == ["calculator"]
    # current_datetime is registered but was not selected: it must not appear.
    assert "current_datetime" not in {tool.name for tool in tools}


def test_invalid_selection_aborts_without_fallback_or_substitution():
    with pytest.raises(RuntimeError, match="card_tool_unknown"):
        DEFAULT_TOOL_REGISTRY.resolve_selected(["calculator", "bogus_tool"])


def test_empty_selection_resolves_no_tools():
    assert DEFAULT_TOOL_REGISTRY.resolve_selected([]) == []


def test_duplicate_registration_fails_loudly():
    registry = build_default_tool_registry()
    with pytest.raises(RuntimeError, match="card_tool_already_registered: calculator"):
        registry.register(
            _valid_spec(name="calculator"),
            tool_calculator,
        )


def test_non_callable_adapter_fails_loudly():
    registry = ToolRegistry()
    with pytest.raises(RuntimeError, match="card_tool_adapter_missing"):
        registry.register(_valid_spec(name="broken_tool"), "not-callable")  # type: ignore[arg-type]


def test_mutated_schema_cannot_resolve():
    registry = build_default_tool_registry()
    # Bypass pydantic validation to simulate a corrupted spec at resolve time.
    object.__setattr__(registry._specs["calculator"], "inputSchema", {})
    with pytest.raises(RuntimeError, match="card_tool_schema_missing: calculator"):
        registry.resolve_selected(["calculator"])


# ---------------------------------------------------------------------------
# Real adapters preserved.
# ---------------------------------------------------------------------------


def test_tool_current_datetime_returns_iso_utc():
    parsed = datetime.fromisoformat(tool_current_datetime())
    assert parsed.tzinfo is not None


def test_tool_calculator_behavior_preserved():
    assert tool_calculator("2+3*4") == "14.0"
    assert tool_calculator("(1+1)**3") == "8.0"
    with pytest.raises(ValueError, match="calculator_unsupported_expression"):
        tool_calculator("__import__('os')")


# ---------------------------------------------------------------------------
# Runtime integration: build_card_tools resolves through the typed registry.
# ---------------------------------------------------------------------------


def test_build_card_tools_uses_typed_registry():
    from app.python_models.magentic_runtime import build_card_tools

    tools = build_card_tools(["current_datetime", "calculator"])
    assert [tool.name for tool in tools] == ["current_datetime", "calculator"]
    assert all(isinstance(tool, FunctionTool) for tool in tools)


def test_build_card_tools_unknown_message_preserved():
    from app.python_models.magentic_runtime import build_card_tools

    with pytest.raises(RuntimeError, match="card_tool_unknown"):
        build_card_tools(["nonexistent_tool"])


# ---------------------------------------------------------------------------
# T001 runtime smoke: the real cross-layer path.
#
# backend payload shape (proven by apps/backend/src/cards/runtime.spec.ts
# "known enabled tools pass through unchanged") -> ContextPack contract ->
# graph compiler -> typed ToolRegistry -> real FunctionTool execution.
#
# The only layer not exercised is the paid model-client exchange itself; tool
# travel and execution are real end to end. No fake finalOutput exists on this
# path: outputs come from actually running the tools.
# ---------------------------------------------------------------------------

_SMOKE_PROVIDER = "openai"
_SMOKE_MODEL_ID = "gpt-5.1-chat-latest"


def _smoke_payload(selected_tools: list[str]) -> dict:
    """Exactly the buildPythonAutoGenCardRuntimePayload shape the backend emits."""
    return {
        "session": {
            "sessionId": "smoke-s1",
            "projectId": "smoke-p1",
            "turnId": "smoke-t1",
            "route": "deck_runtime",
            "orchestrator": "magentic_one",
            "modelProvider": _SMOKE_PROVIDER,
            "modelKey": _SMOKE_MODEL_ID,
            "providerModelId": _SMOKE_MODEL_ID,
            "startedAt": "2026-06-12T00:00:00Z",
        },
        "userText": "What time is it, and what is 2+3*4?",
        "cardRuntime": {
            "cardId": "mag1",
            "title": "Orchestrator",
            "runtimeType": "magentic_one",
            "graph": {
                "nodes": [
                    {
                        "cardId": "mag1",
                        "title": "Orchestrator",
                        "runtimeType": "magentic_one",
                        "prompt": "Coordinate.",
                        "provider": _SMOKE_PROVIDER,
                        "providerModelId": _SMOKE_MODEL_ID,
                    },
                    {
                        "cardId": "agentA",
                        "title": "Agent A",
                        "runtimeType": "assistant_agent",
                        "prompt": "Use your tools.",
                        "tools": selected_tools,
                        "provider": _SMOKE_PROVIDER,
                        "providerModelId": _SMOKE_MODEL_ID,
                    },
                ],
                "edges": [
                    {
                        "id": "mo-agentA",
                        "source": "mag1",
                        "target": "agentA",
                        "edgeType": "magentic_option",
                    }
                ],
            },
            "participants": [
                {
                    "cardId": "agentA",
                    "title": "Agent A",
                    "runtimeType": "assistant_agent",
                    "tools": selected_tools,
                    "provider": _SMOKE_PROVIDER,
                    "providerModelId": _SMOKE_MODEL_ID,
                }
            ],
        },
    }


def test_smoke_selected_tools_travel_payload_to_real_execution():
    from app.python_models.graph_compiler import compile_card_graph
    from app.python_models.magentic_runtime import build_card_tools
    from app.python_models.orchestration_contracts import ContextPack

    pack = ContextPack.model_validate(_smoke_payload(["current_datetime", "calculator"]))
    card = pack.cardRuntime
    assert card is not None

    # The graph compiler accepts the payload and the worker node keeps its
    # Tools-tab selection.
    compiled = compile_card_graph(card)
    assert "agentA" in compiled.participant_ids
    node = next(n for n in card.graph.nodes if n.cardId == "agentA")
    assert node.tools == ["current_datetime", "calculator"]

    # The same selection resolves through the typed ToolRegistry into real
    # FunctionTools, which then actually execute.
    tools = build_card_tools(list(node.tools))
    assert [tool.name for tool in tools] == ["current_datetime", "calculator"]

    by_name = {tool.name: tool for tool in tools}
    token = CancellationToken()

    datetime_value = asyncio.run(by_name["current_datetime"].run_json({}, token))
    parsed = datetime.fromisoformat(
        by_name["current_datetime"].return_value_as_string(datetime_value)
    )
    assert parsed.tzinfo is not None

    calc_value = asyncio.run(by_name["calculator"].run_json({"expression": "2+3*4"}, token))
    assert by_name["calculator"].return_value_as_string(calc_value) == "14.0"


def test_smoke_unknown_tool_in_payload_fails_loudly_at_resolution():
    from app.python_models.graph_compiler import compile_card_graph
    from app.python_models.magentic_runtime import build_card_tools
    from app.python_models.orchestration_contracts import ContextPack

    pack = ContextPack.model_validate(_smoke_payload(["made_up_tool"]))
    card = pack.cardRuntime
    assert card is not None
    compile_card_graph(card)
    node = next(n for n in card.graph.nodes if n.cardId == "agentA")

    with pytest.raises(RuntimeError, match="card_tool_unknown: made_up_tool"):
        build_card_tools(list(node.tools))


def test_smoke_unselected_tool_never_reaches_the_worker():
    from app.python_models.magentic_runtime import build_card_tools
    from app.python_models.orchestration_contracts import ContextPack

    pack = ContextPack.model_validate(_smoke_payload(["calculator"]))
    card = pack.cardRuntime
    assert card is not None
    node = next(n for n in card.graph.nodes if n.cardId == "agentA")

    tools = build_card_tools(list(node.tools))
    assert [tool.name for tool in tools] == ["calculator"]
    assert "current_datetime" not in {tool.name for tool in tools}


# ---------------------------------------------------------------------------
# Coder Console tool.
# ---------------------------------------------------------------------------


def _coder_context(
    target_root: str,
    *,
    user_text: str = "Plan and execute a read-only coder task to inspect the repo code.",
    include_local_coder: bool = True,
    include_codegraph: bool = True,
) -> dict:
    participants = []
    nodes = [
        {
            "cardId": "mag",
            "title": "Magentic-One",
            "runtimeType": "magentic_one",
        }
    ]
    edges = []
    if include_codegraph:
        participants.append(
            {
                "cardId": "codegraph",
                "title": "CodeGraph Agent",
                "runtimeType": "assistant_agent",
                "runtimeBinding": "codegraph_agent",
                "role": "codegraph",
                "provider": "openai",
                "providerModelId": "gpt-5.1-chat-latest",
            }
        )
        nodes.append(
            {
                "cardId": "codegraph",
                "title": "CodeGraph Agent",
                "runtimeType": "assistant_agent",
                "role": "codegraph",
            }
        )
        edges.append(
            {
                "id": "edge-codegraph",
                "source": "mag",
                "target": "codegraph",
                "edgeType": "magentic_option",
            }
        )
    if include_local_coder:
        participants.append(
            {
                "cardId": "coder",
                "title": "Local Coder",
                "runtimeType": "assistant_agent",
                "runtimeBinding": "local_coder",
                "role": "local_coder",
                "tools": ["coder_console_task"],
                "provider": "openai",
                "providerModelId": "gpt-5.1-chat-latest",
            }
        )
        nodes.append(
            {
                "cardId": "coder",
                "title": "Local Coder",
                "runtimeType": "local_coder",
                "role": "local_coder",
                "tools": ["coder_console_task"],
            }
        )
        edges.append(
            {
                "id": "edge-coder",
                "source": "mag",
                "target": "coder",
                "edgeType": "magentic_option",
            }
        )
    return {
        "session": {
            "sessionId": "session-1",
            "projectId": "project-1",
            "turnId": "turn-1",
            "route": "deck_runtime",
            "orchestrator": "magentic_one",
            "modelProvider": "openai",
            "modelKey": "gpt-5.1-chat-latest",
            "providerModelId": "gpt-5.1-chat-latest",
            "startedAt": "2026-06-14T00:00:00Z",
        },
        "userText": user_text,
        "workspaceObjectContext": {"repoPath": target_root, "workspaceRoot": target_root},
        "cardRuntime": {
            "cardId": "mag",
            "title": "Magentic-One",
            "runtimeType": "magentic_one",
            "graph": {"nodes": nodes, "edges": edges},
            "participants": participants,
        },
    }


def test_coder_console_task_is_registered_with_required_schema():
    spec = DEFAULT_TOOL_REGISTRY._specs["coder_console_task"]
    properties = spec.inputSchema["properties"]
    assert {"project_id", "target_root", "goal", "prompt", "edit_mode", "session_id"} <= set(
        properties
    )
    assert spec.inputSchema["required"] == ["project_id", "target_root", "goal"]
    assert spec.outputSchema["type"] == "object"
    assert spec.outputSchema["properties"]["status"]["enum"] == [
        "started",
        "queued",
        "running",
        "completed",
        "failed",
        "blocked",
    ]


def test_compact_coder_prompt_contains_required_fields(tmp_path):
    prompt = build_compact_coder_prompt(
        target_root=str(tmp_path),
        goal="Inspect the console bridge.",
        prompt="Report the implementing files. Do not edit.",
    )
    assert f"Target root: {tmp_path}" in prompt
    assert "User goal: Inspect the console bridge." in prompt
    assert "Current state summary:" in prompt
    assert "Constraints:" in prompt
    assert "Read first:" in prompt
    assert "Edit mode: read_only" in prompt
    assert "Expected proof:" in prompt
    assert "Expected result format:" in prompt
    assert "gRPC" in prompt
    assert "vendored localcoder/" in prompt


def test_coder_console_task_calls_owned_typescript_route_and_returns_status(monkeypatch, tmp_path):
    from app.python_models.orchestration_contracts import ContextPack

    captured: dict = {}

    def fake_post(payload: dict):
        captured.update(payload)
        return 200, {
            "routed": True,
            "codingRun": {"id": "coding_run_123"},
            "session": {
                "id": "occ_123",
                "targetRoot": str(tmp_path),
                "provider": "openrouter",
                "model": "kimi-k2-thinking",
                "transportMode": "pipe",
            },
        }

    monkeypatch.setattr("app.python_models.tool_registry._post_console_task", fake_post)
    context = ContextPack.model_validate(_coder_context(str(tmp_path)))
    loop = asyncio.new_event_loop()
    dispatch_future = loop.create_future()
    dispatch_token = set_current_coder_dispatch_future(dispatch_future)
    token = set_current_coder_tool_context(context)
    try:
        result = loop.run_until_complete(
            coder_console_task(
                project_id="project-1",
                target_root=str(tmp_path),
                goal="Inspect the console bridge.",
                prompt="Report implementing files. Do not edit.",
            )
        )
    finally:
        reset_current_coder_tool_context(token)
        reset_current_coder_dispatch_future(dispatch_token)
        loop.close()

    assert result["status"] == "started"
    assert result["status"] != "completed"
    assert result["session_id"] == "occ_123"
    assert result["provider"] == "openrouter"
    assert result["model"] == "kimi-k2-thinking"
    assert result["transport"] == "pipe"
    assert result["watch_surface"] == "Code Console"
    assert result["delivery_status"] == "accepted"
    assert result["coding_run_id"] == "coding_run_123"
    assert result["result_status_url"] == "/api/coder/openclaude/console/runs/coding_run_123"
    assert dispatch_future.result() == result
    assert "Watch the terminal in Code Console" in result["message"]
    assert "Coding run: coding_run_123" in result["message"]
    assert captured["projectId"] == "project-1"
    assert captured["repoPath"] == str(tmp_path)
    assert captured["editMode"] == "read_only"
    assert captured["explicitApproval"] is True
    assert captured["generatedSpec"] == captured["task"]
    assert captured["userGoal"] == "Inspect the console bridge."
    assert any(card["runtimeType"] == "local_coder" for card in captured["cards"])
    assert "COMPACT CODER TASK" in captured["task"]


@pytest.mark.parametrize(
    ("include_local_coder", "include_codegraph", "expected"),
    [
        (False, True, "Local Coder"),
        (True, False, "CodeGraph Agent"),
    ],
)
def test_coder_console_task_blocks_disconnected_required_participants(
    monkeypatch,
    tmp_path,
    include_local_coder,
    include_codegraph,
    expected,
):
    from app.python_models.orchestration_contracts import ContextPack

    post = lambda payload: pytest.fail(f"unexpected route call: {payload}")
    monkeypatch.setattr("app.python_models.tool_registry._post_console_task", post)
    context = ContextPack.model_validate(
        _coder_context(
            str(tmp_path),
            include_local_coder=include_local_coder,
            include_codegraph=include_codegraph,
        )
    )
    token = set_current_coder_tool_context(context)
    try:
        result = asyncio.run(
            coder_console_task("project-1", str(tmp_path), "Inspect code.")
        )
    finally:
        reset_current_coder_tool_context(token)
    assert result["status"] == "blocked"
    assert result["delivery_status"] == "blocked"
    assert expected in result["blocker"]





def test_coder_console_tool_missing_fails_with_required_code(monkeypatch):
    from app.python_models.magentic_runtime import build_card_tools

    monkeypatch.delitem(DEFAULT_TOOL_REGISTRY._specs, "coder_console_task")
    with pytest.raises(RuntimeError, match="MAGONE_CODER_CONSOLE_TOOL_NOT_REGISTERED"):
        build_card_tools(["coder_console_task"])


def test_coder_console_transport_is_http_route_not_grpc():
    source = inspect.getsource(_post_console_task)
    assert "/api/coder/openclaude/console/task" in source
    assert "grpc" not in source.lower()
