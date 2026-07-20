"""Canonical capability ids resolve to this runtime's own implementations."""
import pytest

from app.python_models.tool_registry import CANONICAL_TOOL_ALIASES, build_default_tool_registry


def test_canonical_capability_ids_resolve_to_runner_implementations() -> None:
    registry = build_default_tool_registry()
    assert CANONICAL_TOOL_ALIASES == {
        "thinkgraph.get_graph_slice": "read_thinkgraph_scope",
        "thinkgraph.submit_update": "apply_thinkgraph_patch",
        "knowgraph.query": "retrieve_knowgraph_context",
    }
    for canonical, runner_name in CANONICAL_TOOL_ALIASES.items():
        tool = registry.resolve_one(canonical)
        assert tool.name == runner_name
        # The alias resolves to the SAME implementation as the runner name.
        assert registry.resolve_one(runner_name).name == runner_name


def test_capabilities_without_a_runner_adapter_stay_loudly_unknown() -> None:
    registry = build_default_tool_registry()
    with pytest.raises(RuntimeError, match="card_tool_unknown: unsupported.future_planner"):
        registry.resolve_one("unsupported.future_planner")
    with pytest.raises(RuntimeError, match="card_tool_unknown: card.run_assistant_agent"):
        registry.resolve_one("card.run_assistant_agent")
