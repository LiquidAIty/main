"""T001 ToolSpec / ToolRegistry tests.

Proves: selected enabled schema-complete tools resolve to real FunctionTools;
unknown, empty, disabled, unselected, and schema-missing tools fail loudly;
current_datetime and calculator keep real FunctionTool behavior; no fallback
or substitution occurs.
"""

from __future__ import annotations

import asyncio
from datetime import datetime

import pytest
from pydantic import ValidationError

from autogen_core import CancellationToken
from autogen_core.tools import FunctionTool

from app.python_models.orchestration_contracts import ToolSpec
from app.python_models.tool_registry import (
    DEFAULT_TOOL_REGISTRY,
    ToolRegistry,
    build_default_tool_registry,
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
