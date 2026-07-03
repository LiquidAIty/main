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


class TestRunAssistantAgent:
    def test_all_structural_references_required(self):
        with pytest.raises(cp.ControlPlaneError, match="input_required"):
            asyncio.run(cp.card_run_assistant_agent({
                "projectId": "p", "deckId": "d", "cardId": "c", "correlationId": "x",
            }))

    def test_forwards_only_the_five_saved_references(self, monkeypatch):
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
