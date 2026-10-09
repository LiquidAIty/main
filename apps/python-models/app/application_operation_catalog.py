"""Ordered catalog composition for application-owned operations."""

from __future__ import annotations

from app.agent_canvas_card_operations import (
    agentgraph_operation_definitions,
    canvas_card_operation_definitions,
)
from app.mag_one_operation import mag_one_operation_definitions
from app.main_worldview_operations import main_worldview_operation_definitions
from app.python_models.operation_definition import OperationDefinition
from app.saved_graph_specialist_operations import (
    saved_graph_specialist_operation_definitions,
)


def application_operation_definitions() -> list[OperationDefinition]:
    external = frozenset({"internal-plugin", "external-mcp"})
    internal = frozenset({"internal-plugin"})
    return [
        *main_worldview_operation_definitions(external, internal),
        *agentgraph_operation_definitions(external),
        *mag_one_operation_definitions(external),
        *saved_graph_specialist_operation_definitions(internal),
        *canvas_card_operation_definitions(external),
    ]
