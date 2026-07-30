"""Canonical capability ids resolve to this runtime's own implementations."""
import pytest

from app.python_models.orchestration_contracts import ToolSpec
from app.python_models.tool_registry import (
    CANONICAL_TOOL_ALIASES,
    ToolRegistry,
    build_default_tool_registry,
)


def test_canonical_capability_ids_resolve_to_runner_implementations() -> None:
    registry = build_default_tool_registry()
    assert CANONICAL_TOOL_ALIASES == {
        "thinkgraph.get_graph_slice": "read_thinkgraph_scope",
        "thinkgraph.submit_update": "apply_thinkgraph_patch",
    }
    for canonical, runner_name in CANONICAL_TOOL_ALIASES.items():
        tool = registry.resolve_one(canonical)
        assert tool.name == runner_name
        # The alias resolves to the SAME implementation as the runner name.
        assert registry.resolve_one(runner_name).name == runner_name


def test_capabilities_without_a_runner_adapter_stay_loudly_unknown() -> None:
    registry = build_default_tool_registry()
    with pytest.raises(RuntimeError, match="card_tool_unknown: hermes.memory_read"):
        registry.resolve_one("hermes.memory_read")
    with pytest.raises(RuntimeError, match="card_tool_unknown: card.run_assistant_agent"):
        registry.resolve_one("card.run_assistant_agent")


def test_runtime_alias_collisions_fail_during_saved_tool_construction() -> None:
    registry = build_default_tool_registry()
    with pytest.raises(
        RuntimeError,
        match="card_tool_runtime_name_collision: read_thinkgraph_scope",
    ):
        registry.resolve_selected(
            ["thinkgraph.get_graph_slice", "read_thinkgraph_scope"]
        )


def test_duplicate_registry_identity_is_rejected() -> None:
    registry = ToolRegistry()
    spec = ToolSpec(
        name="one_tool",
        description="One test tool.",
        enabled=True,
        inputSchema={"type": "object", "properties": {}, "required": []},
        outputSchema={"type": "string"},
    )
    registry.register(spec, lambda: "one")
    with pytest.raises(RuntimeError, match="card_tool_already_registered: one_tool"):
        registry.register(spec, lambda: "two")
