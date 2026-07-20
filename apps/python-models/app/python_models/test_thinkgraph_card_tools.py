"""Focused ThinkGraph card-tool + MCP host coverage. No network/model call.

Proves: the scoped tools fail honestly outside an authorized ThinkGraph card run
(authority never comes from the model and must be the truthful
``thinkgraph_card_run`` kind), both tools resolve through the SAME canonical
registry used by every card, the single-card runtime injects/clears the
authority from the server-authored runtimeScope, and the Python MCP host exposes
exactly the control + bounded-read surface — no model-facing graph-write tool and
no user/assistant pair front door.
"""
import asyncio
import json

from app.python_models import magentic_agentchat as mac
from app.python_models import tool_registry as tr
from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    ContextPack,
    ProjectSession,
)

MODEL = "openai/gpt-5.1-chat"


# --------------------------------------------------------------------------- #
# scoped tool authority — model-supplied authority is impossible by construction
# --------------------------------------------------------------------------- #
class TestThinkGraphToolAuthority:
    def test_read_scope_fails_honestly_without_authority(self):
        result = json.loads(asyncio.run(tr.read_thinkgraph_scope_tool()))
        assert result["ok"] is False
        assert "thinkgraph_authority_missing" in result["error"]

    def test_apply_patch_fails_honestly_without_authority(self):
        result = json.loads(asyncio.run(tr.apply_thinkgraph_patch_tool(resources=[{"id": "x", "label": "X"}])))
        assert result["ok"] is False
        assert "thinkgraph_authority_missing" in result["error"]

    def test_wrong_authority_kind_is_rejected(self):
        token = tr.THINKGRAPH_RUN_AUTHORITY.set({"kind": "other", "projectId": "p"})
        try:
            result = json.loads(asyncio.run(tr.read_thinkgraph_scope_tool()))
            assert result["ok"] is False
            assert "thinkgraph_authority_missing" in result["error"]
        finally:
            tr.THINKGRAPH_RUN_AUTHORITY.reset(token)

    def test_obsolete_pair_authority_kind_is_rejected(self):
        # The old "thinkgraph_pair" kind no longer authorizes anything.
        token = tr.THINKGRAPH_RUN_AUTHORITY.set(
            {"kind": "thinkgraph_pair", "projectId": "p", "cardId": "tg",
             "correlationId": "c", "conversationId": "conv"}
        )
        try:
            result = json.loads(asyncio.run(tr.read_thinkgraph_scope_tool()))
            assert result["ok"] is False
            assert "thinkgraph_authority_missing" in result["error"]
        finally:
            tr.THINKGRAPH_RUN_AUTHORITY.reset(token)

    def test_truthful_card_run_authority_is_accepted_and_reaches_the_bridge(self):
        # The truthful thinkgraph_card_run kind passes the gate; with no backend
        # running in this unit test the call reaches the real read-scope bridge
        # and fails with an honest transport error, NOT an authority rejection.
        token = tr.THINKGRAPH_RUN_AUTHORITY.set(
            {"kind": "thinkgraph_card_run", "projectId": "p", "cardId": "tg",
             "correlationId": "c", "conversationId": "conv"}
        )
        try:
            result = json.loads(asyncio.run(tr.read_thinkgraph_scope_tool()))
            assert "thinkgraph_authority_missing" not in json.dumps(result)
        finally:
            tr.THINKGRAPH_RUN_AUTHORITY.reset(token)

    def test_tools_registered_in_the_one_canonical_registry(self):
        names = tr.DEFAULT_TOOL_REGISTRY.known_names()
        assert "read_thinkgraph_scope" in names
        assert "apply_thinkgraph_patch" in names
        tools = tr.DEFAULT_TOOL_REGISTRY.resolve_selected(
            ["read_thinkgraph_scope", "apply_thinkgraph_patch"]
        )
        assert [t.name for t in tools] == ["read_thinkgraph_scope", "apply_thinkgraph_patch"]


# --------------------------------------------------------------------------- #
# single-card runtime injects + clears the authority from runtimeScope
# --------------------------------------------------------------------------- #
class TestRuntimeScopeAuthorityInjection:
    def test_guard_failure_leaves_no_authority_set(self):
        card = CardRuntimeConfig(
            cardId="tg", title="ThinkGraph Agent", runtimeType="assistant_agent",
            runtimeScope={"kind": "thinkgraph_card_run", "projectId": "p", "cardId": "tg",
                          "correlationId": "c", "conversationId": "conv"},
            participants=[],  # guard fails: participant count 0
        )
        context = ContextPack(
            session=ProjectSession(sessionId="s", projectId="p", turnId="c", route="single_card",
                                   orchestrator="assistant_agent", modelProvider="openrouter",
                                   modelKey="gpt-5.1-chat", providerModelId=MODEL, startedAt="now"),
            userText="hello",
            cardRuntime=card,
        )
        response = asyncio.run(mac.run_configured_card(context))
        assert response.ok is False
        assert tr.THINKGRAPH_RUN_AUTHORITY.get() is None  # never leaked


# --------------------------------------------------------------------------- #
# Python MCP host: exact tool surface + structural argument rejection
# --------------------------------------------------------------------------- #
class TestPythonMcpHost:
    def test_host_exposes_exact_tool_surface(self):
        from app import mcp_host

        tools = asyncio.run(mcp_host.list_tools())
        names = sorted(t.name for t in tools)
        assert names == sorted([
            "run_coder_subagent",
            "mag_one.describe_connected_agents",
            "run_mag_one",
            "write_mag_one_instructions",
            "read_model_results",
            "canvas.inspect",
            "card.update_configuration",
            "canvas.upsert_wire",
            "card.assign_runtime_skill",
            "card.assign_data_binding",
            "card.run_assistant_agent",
            "thinkgraph.get_graph_slice",
            "thinkgraph.submit_update",
            "knowgraph.query",
            "knowgraph.ingest",
            "knowgraph_analyze_scope",
            "knowgraph_get_analysis",
            "knowgraph_compare_providers",
            "knowgraph_get_topics",
            "knowgraph_get_gateways",
            "knowgraph_get_gaps",
            "knowgraph_create_analysis_view",
            "codegraph.status",
            "codegraph.search",
            "web_search",
            "worldsignals.batch",
            "worldsignals.capabilities",
            "worldsignals.command",
            "worldsignals.poll",
            "worldsignals.stream_events",
        ])

    def test_card_run_schema_matches_the_doorway_contract(self):
        from app import mcp_host

        tools = asyncio.run(mcp_host.list_tools())
        card_run = next(t for t in tools if t.name == "card.run_assistant_agent")
        required = set((card_run.inputSchema or {}).get("required") or [])
        assert required == {"cardId", "input"}

    def test_native_thinkgraph_update_schema_exposes_the_required_structural_patch_fields(self):
        from app import mcp_host

        tools = asyncio.run(mcp_host.list_tools())
        update = next(t for t in tools if t.name == "thinkgraph.submit_update")
        schema = update.inputSchema or {}
        assert set(schema.get("required") or []) == {"projectId", "conversationId"}
        properties = schema["properties"]
        assert set(properties["resources"]["items"]["required"]) == {"id", "label"}
        assert set(properties["relations"]["items"]["required"]) == {"a", "b"}
        assert set(properties["statements"]["items"]["required"]) == {
            "id", "subject", "predicateTerm", "object"
        }
        assert "Minimal valid example" in update.description

    def test_host_never_exposes_a_write_tool_or_pair_front_door(self):
        from app import mcp_host

        tools = asyncio.run(mcp_host.list_tools())
        names = {t.name for t in tools}
        for gone in (
            "apply_thinkgraph_patch",
            "read_thinkgraph_scope",
            "thinkgraph.apply_live_patch",
            "thinkgraph.process_conversation_pair",
        ):
            assert gone not in names, f"host regressed: {gone}"
        # No tool accepts a raw patch/prompt/model/task-ledger key.
        for tool in tools:
            allowed = mcp_host._ALLOWED_KEYS[tool.name]
            assert "taskLedger" not in allowed
            assert "prompt" not in allowed
            assert "model" not in allowed
            assert "patch" not in allowed


# --------------------------------------------------------------------------- #
# control-tool structural argument rejection at the host boundary
# --------------------------------------------------------------------------- #
class TestControlToolArgumentRejection:
    def test_card_run_smuggled_arguments_are_rejected(self):
        from app import mcp_host

        result = asyncio.run(
            mcp_host.call_tool(
                "card.run_assistant_agent",
                {"projectId": "p", "deckId": "d", "cardId": "c", "correlationId": "x",
                 "input": "hi", "prompt": "evil", "model": "evil", "tools": ["shell"]},
            )
        )
        text = result[0].text
        assert "tool_arguments_rejected" in text
        assert "prompt" in text and "model" in text and "tools" in text

    def test_unknown_tool_is_rejected(self):
        from app import mcp_host

        unknown = asyncio.run(mcp_host.call_tool("nope", {}))
        assert "unknown_tool" in unknown[0].text

    def test_read_slice_smuggled_arguments_are_rejected(self):
        from app import mcp_host

        result = asyncio.run(
            mcp_host.call_tool(
                "thinkgraph.get_graph_slice",
                {"projectId": "p", "prompt": "evil", "patch": {"nodes": []}},
            )
        )
        text = result[0].text
        assert "tool_arguments_rejected" in text
        assert "prompt" in text and "patch" in text
