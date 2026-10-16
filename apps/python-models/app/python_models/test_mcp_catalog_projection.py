from __future__ import annotations

import pytest
from mcp.types import Tool

from app import mcp_catalog_projection


def _tool(name: str, description: str) -> Tool:
    return Tool(
        name=name,
        title=name,
        description=description,
        input_schema={"type": "object", "properties": {}},
    )


def test_application_provider_name_collision_fails_instead_of_shadowing() -> None:
    application = _tool("graph.search", "application definition")
    provider = _tool("graph.search", "provider definition")

    with pytest.raises(RuntimeError, match="federated_duplicate_tool_name:graph.search"):
        mcp_catalog_projection.complete_catalog([application], [provider])


def test_distinct_application_and_provider_tools_are_retained() -> None:
    completed = mcp_catalog_projection.complete_catalog(
        [_tool("calculator", "application definition")],
        [_tool("cbm.search_graph", "provider definition")],
    )

    assert [tool.name for tool in completed] == ["calculator", "cbm.search_graph"]
