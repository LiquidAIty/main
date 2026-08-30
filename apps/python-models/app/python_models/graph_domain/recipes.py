"""Versioned, inspectable recipe manifests for the one graph executor."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


_RECIPES: dict[str, dict[str, Any]] = {
    "think.context.v1": {
        "id": "think.context.v1",
        "tool": "think.context",
        "authority": "ThinkGraph",
        "readOnly": True,
        "steps": [
            {
                "operation": "constellation.context",
                "order": 1,
                "budget": {"tokens": 2_000, "maxDepth": 2, "maxL2": 12},
            },
            {
                "operation": "constellation.inspect",
                "order": 2,
                "branch": "for up to three returned native node IDs",
                "budget": {"maxCalls": 3, "maxDepth": 1, "maxL2": 12},
            },
        ],
    },
    "know.context.v1": {
        "id": "know.context.v1",
        "tool": "know.context",
        "authority": "KnowGraph",
        "readOnly": True,
        "steps": [
            {"operation": "graphiti.search_nodes", "order": 1, "budget": {"maxNodes": 8}},
            {"operation": "graphiti.search_memory_facts", "order": 1, "budget": {"maxFacts": 8}},
            {
                "operation": "graphiti.search_nodes+search_memory_facts",
                "order": 2,
                "branch": "optional bounded expansion around the top native entity",
                "budget": {"maxAdditionalCalls": 2},
            },
            {
                "operation": "graphiti.get_episodes",
                "order": 3,
                "branch": "only when selected facts expose episode UUIDs",
                "budget": {"maxEpisodes": 50, "includeBody": False},
            },
        ],
    },
    "code.context.v1": {
        "id": "code.context.v1",
        "tool": "code.context",
        "authority": "CodeGraph",
        "readOnly": True,
        "steps": [
            {"operation": "cbm.search_graph", "order": 1, "budget": {"maxSymbols": 8}},
            {"operation": "cbm.search_code", "order": 2, "budget": {"maxMatches": 8}},
            {"operation": "cbm.trace_path", "order": 3, "budget": {"maxDepth": 5}},
            {"operation": "cbm.get_code_snippet", "order": 4, "budget": {"maxCalls": 8}},
            {"operation": "cbm.search_graph", "order": 5, "purpose": "exact relationship readback"},
        ],
    },
    "graph.think-know-code.v1": {
        "id": "graph.think-know-code.v1",
        "tool": None,
        "authority": "separate-native-sections",
        "readOnly": True,
        "steps": [
            {"recipe": "think.context.v1", "order": 1},
            {"recipe": "know.context.v1", "order": 2},
            {
                "recipe": "code.context.v1",
                "order": 3,
                "branch": "only when code scope is explicitly requested",
            },
        ],
    },
}


def graph_recipe_manifest(recipe_id: str | None = None) -> dict[str, Any]:
    """Return immutable-by-copy recipe metadata for Script/editor projection."""

    if recipe_id is None:
        return {key: deepcopy(value) for key, value in _RECIPES.items()}
    if recipe_id not in _RECIPES:
        raise ValueError(f"graph_recipe_unknown:{recipe_id}")
    return deepcopy(_RECIPES[recipe_id])
