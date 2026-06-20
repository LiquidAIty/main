"""Focused coverage for the deterministic tool registry primitives."""
import asyncio
import json
import sys

from autogen_core.tools import FunctionTool

from app.python_models.tool_registry import (
    build_default_tool_registry,
    retrieve_knowgraph_context_tool,
    tool_calculator,
    tool_current_datetime,
    tool_manifest,
)


def test_calculator_evaluates_arithmetic():
    assert tool_calculator("2 + 3 * 4") == "14.0"


def test_current_datetime_returns_iso_like_string():
    value = tool_current_datetime()
    assert isinstance(value, str) and len(value) >= 10


def test_default_registry_exposes_known_tools():
    registry = build_default_tool_registry()
    names = registry.known_names()
    assert isinstance(names, list)
    assert len(names) >= 1


def test_knowgraph_retrieval_tool_registered_but_not_executed():
    # Building the registry only stores the spec+adapter; it must not import the
    # KnowGraph rails, connect to Neo4j, or invoke the tool.
    sys.modules.pop("hybrid_retrieval", None)
    registry = build_default_tool_registry()
    assert "retrieve_knowgraph_context" in registry.known_names()
    assert registry._adapters["retrieve_knowgraph_context"] is retrieve_knowgraph_context_tool
    assert asyncio.iscoroutinefunction(retrieve_knowgraph_context_tool)
    # The capability module is loaded lazily inside the adapter, never at registration.
    assert "hybrid_retrieval" not in sys.modules


def test_knowgraph_retrieval_tool_resolves_to_function_tool():
    registry = build_default_tool_registry()
    tool = registry.resolve_one("retrieve_knowgraph_context")
    assert isinstance(tool, FunctionTool)
    assert tool.name == "retrieve_knowgraph_context"


def test_knowgraph_retrieval_tool_only_present_when_selected():
    registry = build_default_tool_registry()
    selected = registry.resolve_selected(["calculator"])
    assert "retrieve_knowgraph_context" not in [tool.name for tool in selected]


def test_manifest_includes_knowgraph_retrieval_with_display_name():
    manifest = tool_manifest()
    entry = next((m for m in manifest if m["id"] == "retrieve_knowgraph_context"), None)
    assert entry is not None
    assert entry["displayName"] == "KnowGraph Hybrid Retrieval"
    assert "magentic_one" in entry["agentCompatibility"]
    assert entry["description"]
    assert "project_id" in entry["inputSchemaSummary"]


def test_manifest_is_registry_backed_no_duplicate_entries():
    manifest = tool_manifest()
    ids = [m["id"] for m in manifest]
    assert ids == sorted(set(ids))  # one entry per registered tool, deduped
    assert "retrieve_knowgraph_context" in ids


def test_manifest_exposes_no_secrets_endpoints_or_db_config():
    blob = json.dumps(tool_manifest()).lower()
    for forbidden in ["password", "bolt://", "neo4j_uri", "12434", "services/knowgraph", "api_key", "secret"]:
        assert forbidden not in blob
