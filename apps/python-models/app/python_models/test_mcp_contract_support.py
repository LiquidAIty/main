"""Test-owned value formatting and provider reset support for MCP contracts."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: MCP Host
# Relationship: This file supplies shared result formatting and provider-reset fixtures that isolate authenticated Streamable HTTP and dispatch contract tests.

import json

import pytest


def tool_result_wire_text(result) -> str:
    if hasattr(result, "model_dump"):
        value = result.model_dump(by_alias=True, exclude_none=True)
    elif isinstance(result, list):
        value = [
            item.model_dump(by_alias=True, exclude_none=True)
            if hasattr(item, "model_dump") else item
            for item in result
        ]
    else:
        value = result
    return json.dumps(value, default=str)


@pytest.fixture
def clear_live_provider_operations():
    try:
        yield
    finally:
        from app.python_models.tool_registry import replace_discovered_external_operations

        replace_discovered_external_operations("cbm", [])
        replace_discovered_external_operations("graphiti", [])
        replace_discovered_external_operations("openstudio", [])
