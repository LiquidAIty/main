"""Ordered catalog composition for application-owned operations."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Tool Catalog
# Relationship: This file composes feature-owned operation definitions into the one ordered code-owned catalog consumed by registration and publication.

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.agent_canvas_card_operations import (
    agentgraph_operation_definitions,
    canvas_card_operation_definitions,
)
from app.main_worldview_operations import main_worldview_operation_definitions
from app.project_graph_operations import project_graph_operation_definitions
from app.python_models.operation_definition import OperationDefinition

# Entity: Building Modeling
# Relationship: Loads the domain-owned MCP definitions into the existing catalog, not another provider or runtime.
_modeling_path = Path(__file__).resolve().parents[3] / 'agent-products/nrgsim/services/modeling_tools.py'
_modeling_spec = importlib.util.spec_from_file_location('building_model_tools', _modeling_path)
_modeling_tools = importlib.util.module_from_spec(_modeling_spec)
_modeling_spec.loader.exec_module(_modeling_tools)


def application_operation_definitions() -> list[OperationDefinition]:
    external = frozenset({"internal-plugin", "external-mcp"})
    internal = frozenset({"internal-plugin"})
    return [
        *main_worldview_operation_definitions(external, internal),
        *agentgraph_operation_definitions(external),
        *project_graph_operation_definitions(external),
        *canvas_card_operation_definitions(external),
        *_modeling_tools.operation_definitions(external),
    ]
