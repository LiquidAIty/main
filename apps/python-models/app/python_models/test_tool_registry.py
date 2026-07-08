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


def test_hermes_review_tool_registered_resolves_and_reviews():
    registry = build_default_tool_registry()
    assert "hermes_review_coder_report" in registry.known_names()
    tool = registry.resolve_one("hermes_review_coder_report")
    assert isinstance(tool, FunctionTool)

    from app.python_models.tool_registry import hermes_review_coder_report_tool

    report = {
        "coderPacketId": "packet_x",
        "status": "blocked",
        "summary": "s",
        "specComparison": [],
        "filesChanged": [],
        "proofCommands": [],
        "proofResults": [],
        "failedCommands": [],
        "blockers": ["graph readback returned 0 nodes"],
        "assumptions": [],
        "outOfScopeFindings": [],
        "nextRecommendedTask": "",
        "rawOutput": "...",
    }
    result = json.loads(
        asyncio.run(
            hermes_review_coder_report_tool(
                coder_report_json=json.dumps(report), feature_id="feature.x"
            )
        )
    )
    assert result["ok"] is True
    assert result["review"]["verdict"] == "blocked"
    # The returned patch is ready for apply_thinkgraph_patch (the ONLY write path).
    assert {r["kind"] for r in result["thinkgraphPatch"]["resources"]} == {
        "RunRecord",
        "Blocker",
        "Pattern",
    }


def test_hermes_review_tool_rejects_non_json_honestly():
    from app.python_models.tool_registry import hermes_review_coder_report_tool

    result = json.loads(
        asyncio.run(
            hermes_review_coder_report_tool(
                coder_report_json="not json at all {", feature_id="feature.x"
            )
        )
    )
    assert result["ok"] is False
    assert "hermes_argument_not_json" in result["error"]


def test_manifest_exposes_hermes_review_for_assistant_agent_cards():
    manifest = tool_manifest()
    entry = next((m for m in manifest if m["id"] == "hermes_review_coder_report"), None)
    assert entry is not None
    assert entry["displayName"] == "Hermes CoderReport Review"
    assert entry["agentCompatibility"] == ["assistant_agent"]
    assert "coder_report_json" in entry["inputSchemaSummary"]


def test_manifest_is_registry_backed_no_duplicate_entries():
    manifest = tool_manifest()
    ids = [m["id"] for m in manifest]
    assert ids == sorted(set(ids))  # one entry per registered tool, deduped
    assert "retrieve_knowgraph_context" in ids


def test_manifest_exposes_no_secrets_endpoints_or_db_config():
    blob = json.dumps(tool_manifest()).lower()
    for forbidden in ["password", "bolt://", "neo4j_uri", "12434", "services/knowgraph", "api_key", "secret"]:
        assert forbidden not in blob
