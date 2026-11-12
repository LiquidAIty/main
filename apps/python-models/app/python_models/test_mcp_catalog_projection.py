# Entity: Tool Catalog
# Relationship: This file verifies application and provider catalogs reject identity collisions while retaining distinct canonical operations.
# Entity: MCP Host
# Relationship: This file verifies provider operations can join the host publication surface only under noncolliding canonical names.

from __future__ import annotations

from copy import deepcopy
import pytest
from mcp.types import Tool

from app import mcp_catalog_projection


def _tool(name: str, description: str) -> Tool:
    schema = {"type": "object", "properties": {}, "additionalProperties": False}
    return Tool(
        name=name,
        title=name,
        description=description,
        input_schema=schema,
        _meta={"liquidaitySource": {"canonicalInputSchema": deepcopy(schema), "serverInjectedArguments": []}},
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


def test_missing_projection_metadata_is_not_accepted_as_an_application_tool():
    tool = Tool(name="calculator", input_schema={"type": "object", "properties": {}})
    with pytest.raises(RuntimeError, match="mcp_tool_projection_metadata_missing:calculator"):
        mcp_catalog_projection.complete_catalog([tool], [])


def test_model_visible_schema_cannot_widen_the_canonical_operation():
    tool = _tool("calculator", "application definition")
    tool.input_schema["properties"]["forgedScope"] = {"type": "string"}
    with pytest.raises(RuntimeError, match="mcp_tool_pre_projection_schema_mismatch:calculator"):
        mcp_catalog_projection.complete_catalog([tool], [])
