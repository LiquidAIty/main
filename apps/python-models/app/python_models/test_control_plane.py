"""Focused control-plane handler coverage (no network, no DB).

Proves the user-directed Harness control tools enforce their gates: strict
card-update allowlist, supported wire semantics, and no-override card runs.
"""

import asyncio

import pytest

from app import control_plane as cp

DECK = {
    "id": "deck_builder",
    "name": "Builder",
    "nodes": [
        {"id": "signals-card", "title": "WorldSignals", "runtimeBinding": "world_signals",
         "runtimeType": "assistant_agent", "prompt": "p",
         "runtimeOptions": {"tools": ["worldsignals.capabilities", "worldsignals.command"]}},
        {"id": "worker", "title": "Worker", "runtimeBinding": None,
         "runtimeType": "assistant_agent", "prompt": "", "runtimeOptions": None},
    ],
    "edges": [{"id": "w1", "source": "worker", "target": "signals-card", "edgeType": "flow"}],
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


def test_saved_card_role_falls_back_to_its_runtime_binding() -> None:
    reference = cp.resolve_saved_card_reference(
        "project-one",
        "deck_builder",
        "signals-card",
        deck=DECK,
    )

    assert reference["runtimeBinding"] == "world_signals"
    assert reference["role"] == "world_signals"


def test_canvas_inspect_returns_only_the_bounded_public_projection(fake_backend) -> None:
    result = asyncio.run(cp.canvas_inspect({"projectId": "p", "deckId": "d"}))

    assert result["deckRevision"] == "rev1"
    assert result["cards"][0] == {
        "id": "signals-card",
        "title": "WorldSignals",
        "runtimeBinding": "world_signals",
        "runtimeType": "assistant_agent",
        "tools": ["worldsignals.capabilities", "worldsignals.command"],
    }
    assert all("prompt" not in card for card in result["cards"])
    assert result["wires"] == [
        {"id": "w1", "source": "worker", "target": "signals-card", "edgeType": "flow"}
    ]


class TestCardUpdateConfiguration:
    def test_arbitrary_runtime_and_authority_fields_rejected(self, fake_backend):
        for field in ("runtimeCode", "shell", "hiddenTools", "runAuthority", "magenticWorkers"):
            with pytest.raises(cp.ControlPlaneError, match="card_update_fields_rejected"):
                asyncio.run(cp.card_update_configuration({
                    "projectId": "p", "deckId": "d", "cardId": "signals-card", "updates": {field: "x"},
                }))
        assert "deck" not in fake_backend  # nothing was saved

    def test_allowlisted_update_persists_with_revision(self, fake_backend):
        result = asyncio.run(cp.card_update_configuration({
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "updates": {"prompt": "new prompt", "reasoningEffort": "medium", "temperature": 0.2},
        }))
        assert result["ok"] is True
        assert fake_backend["expectedRevision"] == "rev1"
        card = next(n for n in fake_backend["deck"]["nodes"] if n["id"] == "signals-card")
        assert card["prompt"] == "new prompt"
        assert card["runtimeOptions"]["reasoningEffort"] == "medium"
        assert card["runtimeOptions"]["temperature"] == 0.2

    def test_reasoning_effort_must_be_supported_or_null(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="card_update_reasoning_effort_invalid"):
            asyncio.run(cp.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "updates": {"reasoningEffort": "extreme"},
            }))
    def test_tools_update_must_be_string_list(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="card_update_tools_must_be_string_list"):
            asyncio.run(cp.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "updates": {"tools": [{"name": "shell"}]},
            }))


class TestUpsertWire:
    def test_only_supported_wire_types(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="wire_edge_type_unsupported"):
            asyncio.run(cp.canvas_upsert_wire({
                "projectId": "p", "deckId": "d", "op": "upsert",
                "wire": {"source": "worker", "target": "signals-card", "edgeType": "auto_run"},
            }))

    def test_wire_endpoints_must_exist_in_saved_deck(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="wire_endpoints_not_in_deck"):
            asyncio.run(cp.canvas_upsert_wire({
                "projectId": "p", "deckId": "d", "op": "upsert",
                "wire": {"source": "ghost", "target": "signals-card", "edgeType": "flow"},
            }))

    def test_magentic_option_upsert_persists(self, fake_backend):
        result = asyncio.run(cp.canvas_upsert_wire({
            "projectId": "p", "deckId": "d", "op": "upsert",
            "wire": {"source": "worker", "target": "signals-card", "edgeType": "magentic_option"},
        }))
        assert result["ok"] is True
        edges = fake_backend["deck"]["edges"]
        assert any(e["edgeType"] == "magentic_option" for e in edges)


class TestGraphInspection:
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
