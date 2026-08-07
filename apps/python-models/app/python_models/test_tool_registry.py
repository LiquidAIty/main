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


def test_duplicate_registry_identity_is_rejected():
    registry = ToolRegistry()
    spec = ToolSpec(
        name="one_tool",
        description="One test tool.",
        enabled=True,
        inputSchema={"type": "object", "properties": {}, "required": []},
        outputSchema={"type": "string"},
    )
    registry.register(spec, lambda: "one")
    with pytest.raises(RuntimeError, match="card_tool_already_registered: one_tool"):
        registry.register(spec, lambda: "two")


def test_manifest_is_registry_backed_no_duplicate_entries():
    manifest = tool_manifest()
    ids = [m["id"] for m in manifest]
    assert ids == sorted(set(ids))  # one entry per registered tool, deduped
    assert "retrieve_knowgraph_context" not in ids


def test_manifest_publishes_card_runtime_compatibility_from_python_authority():
    manifest = {entry["id"]: entry for entry in tool_manifest()}
    coder = manifest["run_local_coder"]
    assert coder["capability"] == {
        "runtimeCompatibility": ["autogen"],
        "assignableRuntimeBindings": ["local_coder"],
        "assignableRuntimeTypes": ["local_coder"],
        "cardAssignable": True,
    }
    calculator = manifest["calculator"]
    assert calculator["capability"]["assignableRuntimeTypes"] == [
        "magentic_one",
        "assistant_agent",
    ]


def test_manifest_exposes_no_secrets_endpoints_or_db_config():
    blob = json.dumps(tool_manifest()).lower()
    for forbidden in ["password", "bolt://", "neo4j_uri", "12434", "services/knowgraph", "api_key", "secret"]:
        assert forbidden not in blob
