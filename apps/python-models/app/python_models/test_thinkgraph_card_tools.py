"""Focused ThinkGraph card-tool + MCP host coverage. No network/model call.

Proves: the scoped tools fail honestly outside an authorized ThinkGraph card run
(authority never comes from the model), both tools resolve through the SAME
canonical registry used by every card, the single-card runtime injects/clears the
authority from the server-authored runtimeScope, and the Python MCP host exposes
exactly the two migrated tools plus the ThinkGraph front door with structural
argument rejection.
"""
import asyncio
import json

from app.python_models import magentic_agentchat as mac
from app.python_models import tool_registry as tr
from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    CardRuntimeParticipant,
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
            runtimeScope={"kind": "thinkgraph_pair", "projectId": "p", "cardId": "tg",
                          "correlationId": "c", "conversationId": "conv",
                          "userMessageId": "u", "assistantMessageId": "a"},
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
            "describe_agent_fabric",
            "execute_visible_flow",
            "thinkgraph.process_conversation_pair",
            "canvas.inspect",
            "card.update_configuration",
            "canvas.upsert_wire",
            "card.assign_runtime_skill",
            "card.assign_data_binding",
            "card.run_assistant_agent",
            "thinkgraph.get_graph_slice",
            "thinkgraph.apply_live_patch",
        ])

    def test_host_never_exposes_the_old_bare_write_names_or_task_ledger_authority(self):
        from app import mcp_host

        tools = asyncio.run(mcp_host.list_tools())
        names = {t.name for t in tools}
        assert "apply_thinkgraph_patch" not in names
        assert "read_thinkgraph_scope" not in names
        for tool in tools:
            allowed = mcp_host._ALLOWED_KEYS[tool.name]
            assert "taskLedger" not in allowed
            assert "prompt" not in allowed  # raw prompt smuggling impossible
            assert "model" not in allowed
            if tool.name != "thinkgraph.apply_live_patch":
                assert "patch" not in allowed


# --------------------------------------------------------------------------- #
# thinkgraph.apply_live_patch — the one scoped live-write tool. Gated by a
# trusted thinkgraph_live_agent_turn authority the model never sees, chooses,
# or reuses. No userMessageId/assistantMessageId — this is not the old
# completed-pair shape.
# --------------------------------------------------------------------------- #
class TestThinkGraphApplyLivePatch:
    def _authority(self, **overrides):
        base = {
            "kind": "thinkgraph_live_agent_turn",
            "projectId": "20ac92da-01fd-4cf6-97cc-0672421e751a",
            "conversationId": "main",
            "liveTurnId": "turn-1",
            "agentRunId": "run-1",
            "writerCardId": "card_thinkgraph_agent",
            "issuedAt": "1000",
            "expiresAt": str(__import__("time").time() + 900),
        }
        base.update(overrides)
        return base

    def test_rejects_missing_authority(self):
        from app import mcp_host

        result = asyncio.run(mcp_host.call_tool("thinkgraph.apply_live_patch", {"resources": []}))
        parsed = json.loads(result[0].text)
        assert parsed["ok"] is False
        assert "thinkgraph_live_authority_missing" in parsed["error"]

    def test_rejects_model_supplied_wrong_kind_authority(self):
        from app import mcp_host

        forged = self._authority(kind="thinkgraph_pair")  # the OLD, obsolete kind
        result = asyncio.run(
            mcp_host.call_tool("thinkgraph.apply_live_patch", {"resources": [], "authority": forged})
        )
        parsed = json.loads(result[0].text)
        assert parsed["ok"] is False
        assert "thinkgraph_live_authority_missing" in parsed["error"]

    def test_rejects_expired_authority(self):
        from app import mcp_host

        expired = self._authority(expiresAt="1")  # long past
        result = asyncio.run(
            mcp_host.call_tool("thinkgraph.apply_live_patch", {"resources": [], "authority": expired})
        )
        parsed = json.loads(result[0].text)
        assert parsed["ok"] is False
        assert "thinkgraph_live_authority_expired" in parsed["error"]

    def test_rejects_incomplete_authority_missing_project(self):
        from app import mcp_host

        incomplete = self._authority(projectId="")
        result = asyncio.run(
            mcp_host.call_tool("thinkgraph.apply_live_patch", {"resources": [], "authority": incomplete})
        )
        parsed = json.loads(result[0].text)
        assert parsed["ok"] is False
        assert "thinkgraph_live_authority_incomplete" in parsed["error"]

    def test_rejects_incomplete_authority_missing_conversation(self):
        from app import mcp_host

        incomplete = self._authority(conversationId="")
        result = asyncio.run(
            mcp_host.call_tool("thinkgraph.apply_live_patch", {"resources": [], "authority": incomplete})
        )
        parsed = json.loads(result[0].text)
        assert parsed["ok"] is False
        assert "thinkgraph_live_authority_incomplete" in parsed["error"]

    def test_rejects_incomplete_authority_missing_writer_card(self):
        from app import mcp_host

        incomplete = self._authority(writerCardId="")
        result = asyncio.run(
            mcp_host.call_tool("thinkgraph.apply_live_patch", {"resources": [], "authority": incomplete})
        )
        parsed = json.loads(result[0].text)
        assert parsed["ok"] is False
        assert "thinkgraph_live_authority_incomplete" in parsed["error"]

    def test_accepts_valid_live_authority_and_reaches_the_real_bridge(self):
        # No backend running in this focused unit test — proves the authority
        # gate passes and the call reaches the real thinkgraph_apply_patch
        # bridge (honest backend_unreachable, not an authority rejection).
        from app import mcp_host

        valid = self._authority()
        result = asyncio.run(
            mcp_host.call_tool("thinkgraph.apply_live_patch", {"resources": [], "authority": valid})
        )
        parsed = json.loads(result[0].text)
        assert "thinkgraph_live_authority" not in json.dumps(parsed)

    def test_control_tool_smuggled_arguments_are_rejected_reprise(self):
        # Sanity: the write tool's own structural allowlist still rejects a
        # smuggled raw prompt/model attempt alongside a forged authority.
        from app import mcp_host

        result = asyncio.run(
            mcp_host.call_tool(
                "thinkgraph.apply_live_patch",
                {"resources": [], "prompt": "evil", "model": "evil"},
            )
        )
        text = result[0].text
        assert "tool_arguments_rejected" in text

    def test_control_tool_smuggled_arguments_are_rejected(self):
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

    def test_unknown_tool_and_smuggled_arguments_are_rejected(self):
        from app import mcp_host

        unknown = asyncio.run(mcp_host.call_tool("nope", {}))
        assert "unknown_tool" in unknown[0].text

        smuggled = asyncio.run(
            mcp_host.call_tool(
                "thinkgraph.process_conversation_pair",
                {"projectId": "p", "conversationId": "c", "userMessageId": "u",
                 "assistantMessageId": "a", "correlationId": "x",
                 "prompt": "evil", "modelKey": "evil", "patch": {"nodes": []}},
            )
        )
        text = smuggled[0].text
        assert "tool_arguments_rejected" in text
        assert "prompt" in text and "modelKey" in text and "patch" in text
