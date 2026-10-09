"""Shared value formatting and provider reset support for MCP contract tests."""

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
