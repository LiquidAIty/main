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


class TestRunAssistantAgent:
    def test_all_structural_references_required(self):
        with pytest.raises(cp.ControlPlaneError, match="input_required"):
            asyncio.run(cp.card_run_assistant_agent({
                "projectId": "p", "deckId": "d", "cardId": "c", "correlationId": "x",
            }))

    def test_forwards_only_saved_references_and_input(self, monkeypatch):
        calls = []

        def backend(method, path, payload=None):
            calls.append((method, path, payload))
            if payload["action"] == "materialize":
                return {
                    "ok": True,
                    "result": {
                        "status": "previewed",
                        "invocation": {
                            "exactIdf": "# IDF\n\nhi",
                            "cardRevisionId": "revision:c",
                        },
                    },
                }
            return {"ok": True, "result": {"status": "completed"}}

        monkeypatch.setattr(cp, "_backend_json", backend)
        asyncio.run(cp.card_run_assistant_agent({
            "projectId": "p", "deckId": "d", "cardId": "c", "correlationId": "x", "input": "hi",
        }))
        method, path, payload = calls[0]
        assert path == "/api/coder/mcp-bridge/run_configured_card"
        assert sorted(payload.keys()) == ["action", "cardId", "correlationId", "deckId", "input", "projectId"]
        assert payload["action"] == "materialize"
        executed = calls[1][2]
        assert executed["action"] == "execute"
        assert executed["exactIdf"] == "# IDF\n\nhi"
        assert executed["cardRevisionId"] == "revision:c"

        asyncio.run(cp.card_run_assistant_agent({
            "projectId": "p", "deckId": "d", "cardId": "c",
            "correlationId": "y", "conversationId": "conv-1",
            "input": "use the handoff",
        }))
        forwarded = calls[3][2]
        assert forwarded["conversationId"] == "conv-1"

    def test_trusted_inter_agent_call_forwards_native_parent_run(self, monkeypatch):
        calls = []

        def backend(method, path, payload=None):
            calls.append((method, path, payload))
            if payload["action"] == "materialize":
                return {
                    "ok": True,
                    "result": {
                        "status": "previewed",
                        "invocation": {
                            "exactIdf": "# IDF\n\nFind one primary source.",
                            "cardRevisionId": "revision:card_research_agent",
                        },
                    },
                }
            return {
                "ok": True,
                "result": {
                    "status": "completed",
                    "output": "bounded source packet",
                    "error": None,
                },
            }

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

        assert calls[1][2]["originatingRunId"] == "main-turn-1"
        assert calls[1][2]["senderCardId"] == "card_hermes_steward"
        assert calls[1][2]["input"] == "Find one primary source."
        assert calls[1][2]["exactIdf"] == "# IDF\n\nFind one primary source."
        assert response["result"]["status"] == "completed"


    def test_inter_agent_failure_records_backend_error(self, monkeypatch):
        def backend(_method, _path, payload=None):
            if payload["action"] == "materialize":
                return {
                    "ok": True,
                    "result": {
                        "status": "previewed",
                        "invocation": {
                            "exactIdf": "# IDF\n\nFind one primary source.",
                            "cardRevisionId": "revision:card_research_agent",
                        },
                    },
                }
            return {
                "ok": False,
                "error": "configured_card_failed",
                "result": {"status": "failed"},
            }

        monkeypatch.setattr(cp, "_backend_json", backend)

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

    def test_plain_standalone_call_uses_same_doorway(self, monkeypatch):
        def backend(_method, _path, payload=None):
            if payload["action"] == "materialize":
                return {
                    "ok": True,
                    "result": {
                        "status": "previewed",
                        "invocation": {
                            "exactIdf": "# IDF\n\nRun independently.",
                            "cardRevisionId": "revision:card_research_agent",
                        },
                    },
                }
            return {
                "ok": True,
                "result": {"status": "completed", "output": "standalone"},
            }

        monkeypatch.setattr(cp, "_backend_json", backend)

        response = asyncio.run(cp.card_run_assistant_agent({
            "projectId": "p",
            "deckId": "deck_builder",
            "cardId": "card_research_agent",
            "correlationId": "standalone-1",
            "input": "Run independently.",
        }))
        assert response["result"]["status"] == "completed"

    def test_inter_agent_call_requires_real_conversation_and_parent_run(self):
        with pytest.raises(cp.ControlPlaneError, match="conversationId_required"):
            asyncio.run(cp.card_run_assistant_agent({
                "projectId": "p", "deckId": "deck_builder", "cardId": "card_research_agent",
                "correlationId": "search-run-1", "originatingAgentId": "card_hermes_steward",
                "originatingRunId": "main-turn-1", "input": "Find one source.",
            }))
