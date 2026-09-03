"""Focused coverage for the deterministic tool registry primitives."""
import json

from app.python_models.tool_registry import (
    ToolRegistry,
    build_default_tool_registry,
    tool_calculator,
    tool_current_datetime,
    tool_manifest,
)
from app.python_models.orchestration_contracts import ToolSpec
import pytest


def test_calculator_evaluates_arithmetic():
    assert tool_calculator("2 + 3 * 4") == "14.0"


def test_registry_never_injects_unselected_reads():
    registry = build_default_tool_registry()
    assert registry.resolve_selected([]) == []
    assert [tool.name for tool in registry.resolve_selected(["calculator"])] == ["calculator"]


def test_current_datetime_returns_iso_like_string():
    value = tool_current_datetime()
    assert isinstance(value, str) and len(value) >= 10


def test_default_registry_exposes_known_tools():
    registry = build_default_tool_registry()
    names = registry.known_names()
    assert isinstance(names, list)
    assert len(names) >= 1


def test_worldsignals_batch_uses_the_native_command_contract():
    registry = build_default_tool_registry()
    spec = registry.spec("worldsignals.batch")
    assert spec is not None
    command = spec.inputSchema["properties"]["commands"]["items"]
    assert command["required"] == ["cmd"]
    assert command["properties"] == {
        "cmd": {"type": "string", "minLength": 1},
        "args": {"type": "object"},
    }
    assert command["additionalProperties"] is False


def test_worldsignals_package_exposes_query_only_and_requires_runtime_scope():
    registry = build_default_tool_registry()
    spec = registry.spec("worldsignals.package")
    assert spec is not None
    assert spec.access == "read"
    assert set(spec.inputSchema["properties"]) == {
        "command", "reason", "arguments", "domains", "sourceRefs",
        "maxAgeSeconds", "limit",
    }
    assert spec.inputSchema["required"] == ["command", "reason"]
    assert "projectId" not in spec.inputSchema["properties"]
    with pytest.raises(RuntimeError, match="worldsignals_package_card_context_required"):
        registry._adapters["worldsignals.package"](
            command="get_summary",
            reason="Read one bounded source result.",
        )


def test_duplicate_registry_identity_is_rejected():
    registry = ToolRegistry()
    spec = ToolSpec(
        name="one_tool",
        description="One test tool.",
        enabled=True,
        access="read",
        inputSchema={"type": "object", "properties": {}, "required": []},
        outputSchema={"type": "string"},
    )
    registry.register(spec, lambda: "one")
    with pytest.raises(RuntimeError, match="card_tool_already_registered: one_tool"):
        registry.register(spec, lambda: "two")


def test_manifest_is_registry_backed_no_duplicate_entries():
    manifest = tool_manifest()
    ids = [m["name"] for m in manifest]
    assert ids == sorted(set(ids))  # one entry per registered tool, deduped
    assert "retrieve_knowgraph_context" not in ids


def test_manifest_publishes_only_factual_private_runtime_contracts():
    manifest = {entry["name"]: entry for entry in tool_manifest()}
    calculator = manifest["calculator"]
    assert calculator["kind"] == "tool"
    assert calculator["sourceId"] == "python_runtime"
    assert calculator["namespace"] == "python"
    assert calculator["nativeName"] == "calculator"
    assert calculator["connectionKind"] == "private-runtime"
    assert calculator["enabled"] is True
    assert calculator["inputSchema"]["type"] == "object"
    assert calculator["outputSchema"]
    assert "capability" not in calculator
    assert "agentCompatibility" not in calculator


def test_manifest_exposes_no_secrets_endpoints_or_db_config():
    blob = json.dumps(tool_manifest()).lower()
    for forbidden in ["password", "bolt://", "neo4j_uri", "12434", "services/knowgraph", "api_key", "secret"]:
        assert forbidden not in blob
