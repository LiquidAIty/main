"""Focused coverage for the deterministic tool registry primitives."""
import json

from app.python_models.tool_registry import (
    build_default_tool_registry,
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


def test_manifest_exposes_thinkgraph_tools_for_assistant_agent_cards():
    """The card Tools tab filters by agentCompatibility, so the two scoped
    ThinkGraph tools must be attachable on assistant_agent cards (and never on
    the Mag One orchestrator card)."""
    manifest = tool_manifest()
    for tool_id in ("read_thinkgraph_scope", "apply_thinkgraph_patch"):
        entry = next((m for m in manifest if m["id"] == tool_id), None)
        assert entry is not None, f"{tool_id} missing from manifest"
        assert entry["agentCompatibility"] == ["assistant_agent"]
        assert entry["description"]


def test_manifest_is_registry_backed_no_duplicate_entries():
    manifest = tool_manifest()
    ids = [m["id"] for m in manifest]
    assert ids == sorted(set(ids))  # one entry per registered tool, deduped
    assert "retrieve_knowgraph_context" not in ids


def test_manifest_exposes_no_secrets_endpoints_or_db_config():
    blob = json.dumps(tool_manifest()).lower()
    for forbidden in ["password", "bolt://", "neo4j_uri", "12434", "services/knowgraph", "api_key", "secret"]:
        assert forbidden not in blob
