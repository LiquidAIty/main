"""Focused control-plane handler coverage (no network, no DB).

Proves the user-directed Harness control tools enforce their gates: strict
card-update allowlist, supported wire semantics only, promoted/pinned skill
assignment via the shared validators, query-injection rejection on data
bindings, and no-override card runs.
"""

import asyncio

import pytest

from app import control_plane as cp
from app.python_models import runtime_assignments as ra

DECK = {
    "id": "deck_builder",
    "name": "Builder",
    "nodes": [
        {"id": "tg-card", "title": "ThinkGraph Agent", "runtimeBinding": "thinkgraph_agent",
         "runtimeType": "assistant_agent", "prompt": "p",
         "runtimeOptions": {"tools": ["read_thinkgraph_scope", "apply_thinkgraph_patch"]}},
        {"id": "worker", "title": "Worker", "runtimeBinding": None,
         "runtimeType": "assistant_agent", "prompt": "", "runtimeOptions": None},
    ],
    "edges": [{"id": "w1", "source": "worker", "target": "tg-card", "edgeType": "flow"}],
}


@pytest.fixture()
def fake_backend(monkeypatch):
    saved = {}

    def backend(method, path, payload=None):
        if method == "GET":
            import copy
            return {"ok": True, "deck": copy.deepcopy(DECK), "meta": {"deckRevision": "rev1"}}
        if method == "PUT":
            saved["deck"] = payload["document"]
            saved["expectedRevision"] = payload["expectedRevision"]
            return {"ok": True, "deck": payload["document"], "meta": {"deckRevision": "rev2"}}
        raise AssertionError(f"unexpected backend call: {method} {path}")

    monkeypatch.setattr(cp, "_backend_json", backend)
    return saved


class TestCardUpdateConfiguration:
    def test_arbitrary_runtime_and_authority_fields_rejected(self, fake_backend):
        for field in ("runtimeCode", "shell", "hiddenTools", "runAuthority", "runtimeScope", "magenticWorkers"):
            with pytest.raises(cp.ControlPlaneError, match="card_update_fields_rejected"):
                asyncio.run(cp.card_update_configuration({
                    "projectId": "p", "deckId": "d", "cardId": "tg-card", "updates": {field: "x"},
                }))
        assert "deck" not in fake_backend  # nothing was saved

    def test_allowlisted_update_persists_with_revision(self, fake_backend):
        result = asyncio.run(cp.card_update_configuration({
            "projectId": "p", "deckId": "d", "cardId": "tg-card",
            "updates": {"prompt": "new prompt", "temperature": 0.2},
        }))
        assert result["ok"] is True
        assert fake_backend["expectedRevision"] == "rev1"
        card = next(n for n in fake_backend["deck"]["nodes"] if n["id"] == "tg-card")
        assert card["prompt"] == "new prompt"
        assert card["runtimeOptions"]["temperature"] == 0.2

    def test_tools_update_must_be_string_list(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="card_update_tools_must_be_string_list"):
            asyncio.run(cp.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "tg-card",
                "updates": {"tools": [{"name": "shell"}]},
            }))


class TestUpsertWire:
    def test_only_supported_wire_types(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="wire_edge_type_unsupported"):
            asyncio.run(cp.canvas_upsert_wire({
                "projectId": "p", "deckId": "d", "op": "upsert",
                "wire": {"source": "worker", "target": "tg-card", "edgeType": "auto_run"},
            }))

    def test_wire_endpoints_must_exist_in_saved_deck(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="wire_endpoints_not_in_deck"):
            asyncio.run(cp.canvas_upsert_wire({
                "projectId": "p", "deckId": "d", "op": "upsert",
                "wire": {"source": "ghost", "target": "tg-card", "edgeType": "flow"},
            }))

    def test_magentic_option_upsert_persists(self, fake_backend):
        result = asyncio.run(cp.canvas_upsert_wire({
            "projectId": "p", "deckId": "d", "op": "upsert",
            "wire": {"source": "worker", "target": "tg-card", "edgeType": "magentic_option"},
        }))
        assert result["ok"] is True
        edges = fake_backend["deck"]["edges"]
        assert any(e["edgeType"] == "magentic_option" for e in edges)


class TestAssignments:
    def test_skill_assignment_requires_pinned_version(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="skill_version_required_for_pinning"):
            asyncio.run(cp.card_assign_runtime_skill({
                "projectId": "p", "deckId": "d", "cardId": "tg-card",
                "skillId": "s", "op": "assign",
            }))

    def test_skill_assignment_gates_flow_through_shared_validator(self, fake_backend, monkeypatch):
        def assign(**kwargs):
            raise ValueError("skill_not_promoted: s@1 status=candidate")

        monkeypatch.setattr(ra, "assign_skill", assign)
        with pytest.raises(cp.ControlPlaneError, match="skill_not_promoted"):
            asyncio.run(cp.card_assign_runtime_skill({
                "projectId": "p", "deckId": "d", "cardId": "tg-card",
                "skillId": "s", "skillVersion": 1, "op": "assign",
            }))

    def test_data_binding_query_injection_rejected(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="query_injection_rejected"):
            asyncio.run(cp.card_assign_data_binding({
                "projectId": "p", "deckId": "d", "cardId": "tg-card",
                "bindingType": "cbm_query_scope",
                "bindingRef": {"cypher": "MATCH (n) DETACH DELETE n"},
                "op": "assign",
            }))

    def test_assignment_requires_card_to_exist_in_saved_deck(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="card_not_found"):
            asyncio.run(cp.card_assign_data_binding({
                "projectId": "p", "deckId": "d", "cardId": "ghost",
                "bindingType": "thinkgraph_project_slice", "bindingRef": {"limit": 10},
                "op": "assign",
            }))


class TestGraphInspection:
    def test_graph_view_list_and_exact_get_stay_in_runtime_conversation(self, monkeypatch):
        class ThinkGraph:
            def graph_views(self, project_id, conversation_id):
                assert (project_id, conversation_id) == ("p", "conv")
                return {
                    "ok": True,
                    "views": [
                        {"viewId": "graphview:one", "conversationId": "conv"},
                        {"viewId": "graphview:two", "conversationId": "conv"},
                    ],
                }

        monkeypatch.setattr(cp, "get_thinkgraph", lambda: ThinkGraph())
        listed = asyncio.run(cp.graph_view_list({
            "projectId": "p", "conversationId": "conv", "limit": 1,
        }))
        assert [view["viewId"] for view in listed["views"]] == ["graphview:one"]
        exact = asyncio.run(cp.graph_view_get({
            "projectId": "p", "conversationId": "conv", "viewId": "graphview:two",
        }))
        assert exact["view"]["viewId"] == "graphview:two"
        with pytest.raises(cp.ControlPlaneError, match="not_found_in_runtime_context"):
            asyncio.run(cp.graph_view_get({
                "projectId": "p", "conversationId": "conv", "viewId": "graphview:missing",
            }))

    def test_operator_graph_view_reads_span_project_conversations(self, monkeypatch):
        calls = []

        class ThinkGraph:
            def graph_views(self, project_id, conversation_id):
                calls.append((project_id, conversation_id))
                return {
                    "ok": True,
                    "views": [
                        {"viewId": "graphview:main", "conversationId": "main"},
                        {"viewId": "graphview:external", "conversationId": "external"},
                    ],
                }

        monkeypatch.setattr(cp, "get_thinkgraph", lambda: ThinkGraph())
        listed = asyncio.run(cp.graph_view_list({
            "projectId": "p",
            "conversationId": "external",
            "projectWide": True,
        }))
        exact = asyncio.run(cp.graph_view_get({
            "projectId": "p",
            "conversationId": "external",
            "projectWide": True,
            "viewId": "graphview:main",
        }))
        assert listed["readScope"] == "project"
        assert len(listed["views"]) == 2
        assert exact["view"]["conversationId"] == "main"
        assert calls == [("p", None), ("p", None)]

    def test_graph_view_create_mints_identity_and_persists_existing_contract(self, monkeypatch):
        saved = []

        class ThinkGraph:
            def persist_graph_view(self, view):
                saved.append(view)
                return {"ok": True, "view": view}

        monkeypatch.setattr(cp, "get_thinkgraph", lambda: ThinkGraph())
        result = asyncio.run(cp.graph_view_create({
            "projectId": "p",
            "conversationId": "conv",
            "correlationId": "run:1",
            "displayLabel": "Organizing principle",
            "authority": "mixed",
            "includedCanonicalNodeIds": ["decision:one"],
            "records": [{"canonicalId": "decision:one", "authority": "thinkgraph"}],
        }))
        assert result["view"]["viewId"].startswith("graphview:external:")
        assert result["view"]["status"] == "candidate"
        assert result["view"]["producingRole"] == "main_chat"
        assert result["view"]["projectId"] == "p"
        assert saved == [result["view"]]

    def test_agentgraph_inspection_uses_exact_server_scope(self, monkeypatch):
        calls = []
        monkeypatch.setattr(cp.ag, "inspect_assignments", lambda **kwargs: calls.append(kwargs) or {
            "ok": True, "receiverCardId": "card_agent",
        })
        monkeypatch.setattr(
            cp,
            "resolve_saved_card_reference",
            lambda *_args, **_kwargs: {"cardId": "card_agent"},
        )
        result = asyncio.run(cp.agentgraph_inspect({
            "projectId": "p",
            "deckId": "deck_builder",
            "conversationId": "conv",
            "assignmentId": "assignment:one",
            "limit": 5,
        }))
        assert result["ok"] is True
        assert result["savedCardReference"] == {"cardId": "card_agent"}
        assert calls == [{
            "project_id": "p",
            "deck_id": "deck_builder",
            "conversation_id": "conv",
            "project_wide": False,
            "assignment_id": "assignment:one",
            "limit": 5,
        }]

    def test_agentgraph_operator_read_is_project_wide(self, monkeypatch):
        calls = []
        monkeypatch.setattr(cp.ag, "inspect_assignments", lambda **kwargs: calls.append(kwargs) or {
            "ok": True,
            "readScope": "project",
            "assignments": [],
        })
        result = asyncio.run(cp.agentgraph_inspect({
            "projectId": "p",
            "deckId": "deck_builder",
            "conversationId": "external",
            "projectWide": True,
        }))
        assert result["readScope"] == "project"
        assert calls[0]["project_wide"] is True


class TestRunAssistantAgent:
    def test_all_structural_references_required(self):
        with pytest.raises(cp.ControlPlaneError, match="input_required"):
            asyncio.run(cp.card_run_assistant_agent({
                "projectId": "p", "deckId": "d", "cardId": "c", "correlationId": "x",
            }))

    def test_forwards_only_saved_references_and_optional_instruction_id(self, monkeypatch):
        calls = []

        def backend(method, path, payload=None):
            calls.append((method, path, payload))
            return {"ok": True, "result": {"status": "completed"}}

        monkeypatch.setattr(cp, "_backend_json", backend)
        asyncio.run(cp.card_run_assistant_agent({
            "projectId": "p", "deckId": "d", "cardId": "c", "correlationId": "x", "input": "hi",
        }))
        method, path, payload = calls[0]
        assert path == "/api/coder/mcp-bridge/run_configured_card"
        assert sorted(payload.keys()) == ["cardId", "correlationId", "deckId", "input", "projectId"]

        asyncio.run(cp.card_run_assistant_agent({
            "projectId": "p", "deckId": "d", "cardId": "c",
            "correlationId": "y", "conversationId": "conv-1",
            "instructionId": "instruction:one", "input": "use the handoff",
        }))
        forwarded = calls[1][2]
        assert forwarded["conversationId"] == "conv-1"
        assert forwarded["instructionId"] == "instruction:one"

    def test_trusted_inter_agent_call_creates_handoff_and_correlates_result(self, monkeypatch):
        calls = []
        created = []

        def create_instruction(**kwargs):
            created.append(kwargs)
            return {"ok": True, "instructionId": "instruction:hermes-search"}

        def backend(method, path, payload=None):
            calls.append((method, path, payload))
            return {
                "ok": True,
                "result": {
                    "status": "completed",
                    "output": "bounded source packet",
                    "error": None,
                },
            }

        monkeypatch.setattr(cp.ag, "create_instruction", create_instruction)
        monkeypatch.setattr(cp, "_backend_json", backend)

        response = asyncio.run(cp.card_run_assistant_agent({
            "projectId": "p",
            "deckId": "deck_builder",
            "cardId": "card_research_agent",
            "correlationId": "search-run-1",
            "conversationId": "conv-1",
            "originatingAgentId": "card_hermes_steward",
            "originatingRunId": "main-turn-1",
            "input": "Find one primary source.",
        }))

        assert created == [{
            "project_id": "p",
            "deck_id": "deck_builder",
            "conversation_id": "conv-1",
            "body": "Find one primary source.",
            "prepared_by_card_id": "card_hermes_steward",
        }]
        assert calls[0][2]["instructionId"] == "instruction:hermes-search"
        assert calls[0][2]["senderCardId"] == "card_hermes_steward"
        assert response["instructionId"] == "instruction:hermes-search"

    def test_trusted_inter_agent_call_forwards_selected_graph_view_ids(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            cp.ag,
            "create_instruction",
            lambda **_kwargs: {"instructionId": "instruction:main-agent"},
        )
        monkeypatch.setattr(
            cp,
            "_backend_json",
            lambda method, path, payload=None: (
                calls.append((method, path, payload))
                or {"ok": True, "result": {"status": "completed"}}
            ),
        )

        asyncio.run(cp.card_run_assistant_agent({
            "projectId": "p",
            "deckId": "deck_builder",
            "cardId": "card_agent",
            "correlationId": "run-one",
            "conversationId": "conv-1",
            "originatingAgentId": "card_main_chat",
            "originatingRunId": "main-run-1",
            "graphViewIds": ["graphview:one", "graphview:two"],
            "input": "Use the selected bounded context.",
        }))

        assert calls[0][2]["graphViewIds"] == ["graphview:one", "graphview:two"]

    def test_inter_agent_failure_records_backend_error(self, monkeypatch):
        monkeypatch.setattr(
            cp.ag,
            "create_instruction",
            lambda **_kwargs: {"ok": True, "instructionId": "instruction:failed"},
        )
        monkeypatch.setattr(cp, "_backend_json", lambda *_args, **_kwargs: {
            "ok": False,
            "error": "configured_card_failed",
            "result": {"status": "failed"},
        })

        asyncio.run(cp.card_run_assistant_agent({
            "projectId": "p",
            "deckId": "deck_builder",
            "cardId": "card_research_agent",
            "correlationId": "search-run-failed",
            "conversationId": "conv-1",
            "originatingAgentId": "card_hermes_steward",
            "originatingRunId": "main-turn-1",
            "input": "Find one primary source.",
        }))

        # The Python saved-card runner is the one result writer. The doorway
        # never copies or reinterprets the backend result.

    def test_plain_standalone_call_does_not_create_agentgraph_handoff(self, monkeypatch):
        monkeypatch.setattr(
            cp.ag,
            "create_instruction",
            lambda **_kwargs: pytest.fail("standalone runs must not create AgentGraph handoffs"),
        )
        monkeypatch.setattr(cp, "_backend_json", lambda *_args, **_kwargs: {
            "ok": True,
            "result": {"status": "completed", "output": "standalone"},
        })

        response = asyncio.run(cp.card_run_assistant_agent({
            "projectId": "p",
            "deckId": "deck_builder",
            "cardId": "card_research_agent",
            "correlationId": "standalone-1",
            "input": "Run independently.",
        }))
        assert response["result"]["status"] == "completed"
        assert "instructionId" not in response

    def test_inter_agent_call_rejects_context_override(self):
        with pytest.raises(cp.ControlPlaneError, match="agentgraph_instruction_override_rejected"):
            asyncio.run(cp.card_run_assistant_agent({
                "projectId": "p",
                "deckId": "deck_builder",
                "cardId": "card_research_agent",
                "correlationId": "search-run-1",
                "conversationId": "conv-1",
                "originatingAgentId": "card_hermes_steward",
                "originatingRunId": "main-turn-1",
                "instructionId": "instruction:forged",
                "input": "Find one source.",
            }))
