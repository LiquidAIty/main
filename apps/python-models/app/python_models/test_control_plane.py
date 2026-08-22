"""Focused control-plane handler coverage (no network, no DB).

Proves the user-directed Harness control tools enforce their gates: strict
Card creation and update, supported wire semantics, and no-override card runs.
"""

import asyncio

import pytest

from app import control_plane as cp

DECK = {
    "id": "deck_builder",
    "name": "Builder",
    "nodes": [
        {"id": "signals-card", "title": "WorldSignals",
         "runtime": {"kind": "autogen", "mode": "assistant"}, "prompt": "p",
         "runtimeOptions": {"tools": ["worldsignals.capabilities", "worldsignals.command"]}},
        {"id": "worker", "title": "Worker",
         "runtime": {"kind": "autogen", "mode": "assistant"},
         "prompt": "", "runtimeOptions": None},
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


def test_saved_card_reference_exposes_explicit_runtime() -> None:
    reference = cp.resolve_saved_card_reference(
        "project-one",
        "deck_builder",
        "signals-card",
        deck=DECK,
    )

    assert reference["runtime"] == {"kind": "autogen", "mode": "assistant"}
    assert reference["role"] == ""


def test_canvas_inspect_returns_only_the_bounded_public_projection(fake_backend) -> None:
    result = asyncio.run(cp.canvas_inspect({"projectId": "p", "deckId": "d"}))

    assert result["deckRevision"] == "rev1"
    assert result["cards"][0] == {
        "id": "signals-card",
        "title": "WorldSignals",
        "runtime": {"kind": "autogen", "mode": "assistant"},
        "tools": ["worldsignals.command"],
        "savedWriteTools": ["worldsignals.command"],
        "legacyReadableSelections": ["worldsignals.capabilities"],
        "unknownConfiguredTools": [],
    }
    assert "worldsignals.capabilities" in result["effectiveReadTools"]
    assert all("prompt" not in card for card in result["cards"])
    assert result["wires"] == [
        {"id": "w1", "source": "worker", "target": "signals-card", "edgeType": "flow"}
    ]


@pytest.mark.parametrize(
    ("target_id", "runtime"),
    [
        ("coder", {"kind": "hermes", "mode": "delegate", "profile": "coder"}),
        ("mag-one", {"kind": "autogen", "mode": "magentic_one"}),
    ],
)
def test_one_grounded_staging_path_loads_coder_or_mag_one_without_running(
    monkeypatch, target_id, runtime,
) -> None:
    import copy

    deck = copy.deepcopy(DECK)
    deck["nodes"].extend([
        {
            "id": "coder", "title": "Coder",
            "runtime": {"kind": "hermes", "mode": "delegate", "profile": "coder"},
            "runtimeOptions": {"tools": []},
        },
        {
            "id": "mag-one", "title": "Magentic-One",
            "runtime": {"kind": "autogen", "mode": "magentic_one"},
            "runtimeOptions": {
                "provider": "openrouter", "modelKey": "orchestrator",
                "providerModelId": "provider/orchestrator", "tools": [],
            },
        },
    ])
    deck["nodes"].append({
        "id": "helper", "title": "Helper",
        "runtime": {"kind": "hermes", "mode": "kanban", "profile": "helper"},
        "runtimeOptions": {"tools": ["write_mag_one_instructions"]},
    })
    calls = []

    def backend(method, _path, payload=None):
        calls.append((method, payload))
        assert method == "GET"
        return {"ok": True, "deck": copy.deepcopy(deck), "meta": {"deckRevision": "rev-mag"}}

    monkeypatch.setattr(cp, "_backend_json", backend)
    materializations = []

    def materialize(request):
        materializations.append(copy.deepcopy(request))
        return {
            "projectId": "p", "deckId": "deck_builder", "ephemeral": True,
            "cardRevisionId": f"revision-{target_id}", "cardRevision": 1,
            "cardRevisionSha256": "sha", "runtimeOwner": runtime["kind"],
            "cardIdentity": {"cardId": target_id, "title": target_id},
            "resolvedNativeReads": [{
                "authority": "KnowGraph", "nativeId": "episode-1",
            }],
            "resolvedGraphProjection": {
                "schemaVersion": "native-card-context.v1", "authority": "knowgraph",
                "projectId": "p", "nodes": [{"id": "episode-1"}], "edges": [],
                "counts": {"nodes": 1, "edges": 0},
            },
            "idf": {
                "runtime": runtime, "enabledTools": [], "provider": {},
            },
        }

    monkeypatch.setattr("app.python_models.card_domain.materialize_invocation", materialize)
    result = asyncio.run(cp.write_mag_one_instructions({
        "projectId": "p",
        "deckId": "deck_builder",
        "targetCardId": target_id,
        "mission": "  Research one bounded public question.\nKeep citations.  ",
        "dataAnchors": [{
            "authority": "KnowGraph", "nativeId": "episode-1",
            "reason": "Current sourced evidence", "priority": 0,
            "boundedExpansion": 1, "resultLimit": 8,
        }],
        "_sourceCardId": "helper",
    }))

    assert result["targetCardId"] == target_id
    assert result["sourceCardId"] == "helper"
    assert result["mission"] == "Research one bounded public question.\nKeep citations."
    assert result["dataAnchors"][0]["required"] is True
    assert result["invocation"]["resolvedGraphProjection"]["nodes"] == [{"id": "episode-1"}]
    assert result["ready"] is True
    assert result["persisted"] is False
    assert result["started"] is False
    assert materializations == [{
        "projectId": "p", "deckId": "deck_builder", "cardId": target_id,
        "assignment": "Research one bounded public question.\nKeep citations.",
        "dataAnchors": [{
            "authority": "KnowGraph", "nativeId": "episode-1",
            "reason": "Current sourced evidence", "priority": 0,
            "boundedExpansion": 1, "resultLimit": 8, "required": True,
        }],
    }]
    assert [method for method, _payload in calls] == ["GET"]


def test_grounded_staging_requires_source_card_write_grant(monkeypatch, fake_backend) -> None:
    with pytest.raises(cp.ControlPlaneError, match="write_mag_one_instructions_not_granted"):
        asyncio.run(cp.write_mag_one_instructions({
            "projectId": "p", "deckId": "d", "targetCardId": "worker",
            "mission": "bounded", "dataAnchors": [{"nativeId": "one"}],
            "_sourceCardId": "signals-card",
        }))


def test_grounded_staging_rejects_a_non_kanban_source_even_with_the_tool(monkeypatch) -> None:
    import copy

    deck = copy.deepcopy(DECK)
    source = deck["nodes"][0]
    source["runtime"] = {"kind": "hermes", "mode": "main", "profile": "main"}
    source["runtimeOptions"]["tools"] = ["write_mag_one_instructions"]
    monkeypatch.setattr(
        cp,
        "_backend_json",
        lambda *_args, **_kwargs: {"ok": True, "deck": deck, "meta": {}},
    )

    with pytest.raises(cp.ControlPlaneError, match="grounded_staging_source_must_be_kanban"):
        asyncio.run(cp.write_mag_one_instructions({
            "projectId": "p", "deckId": "d", "targetCardId": "worker",
            "mission": "bounded", "dataAnchors": [{"nativeId": "one"}],
            "_sourceCardId": "signals-card",
        }))


def test_card_graph_reference_handler_uses_the_one_card_domain_owner(monkeypatch) -> None:
    expected = {"ok": True, "targetCardId": "mag-one", "persisted": False, "started": False}
    monkeypatch.setattr(
        "app.python_models.card_domain.load_card_graph_reference",
        lambda args: expected | {"sourceRunId": args["_sourceRunId"]},
    )

    result = asyncio.run(cp.card_load_graph_references({"_sourceRunId": "run-helper"}))

    assert result == expected | {"sourceRunId": "run-helper"}


class TestCardCreate:
    def test_creates_one_explicit_autogen_card_without_launching(self, fake_backend):
        result = asyncio.run(cp.card_create({
            "projectId": "p",
            "deckId": "d",
            "expectedRevision": "rev1",
            "title": "Search Agent",
            "role": "Bounded live-web researcher",
            "prompt": "Return cited sources and claims. Do not write KnowGraph.",
            "runtime": {"kind": "autogen", "mode": "assistant"},
            "model": {
                "provider": "openrouter",
                "modelKey": "research-model",
                "accessMode": "openrouter-api",
                "reasoningEffort": "low",
            },
            "tools": [],
            "position": {"x": 320, "y": 240},
        }))

        assert result["ok"] is True
        assert result["created"] is True
        assert result["started"] is False
        assert result["deckRevision"] == "rev2"
        assert result["cardId"].startswith("card_")
        assert fake_backend["expectedRevision"] == "rev1"
        assert len(fake_backend["deck"]["nodes"]) == len(DECK["nodes"]) + 1
        card = fake_backend["deck"]["nodes"][-1]
        assert card["title"] == "Search Agent"
        assert card["role"] == "Bounded live-web researcher"
        assert card["runtime"] == {"kind": "autogen", "mode": "assistant"}
        assert card["runtimeOptions"] == {
            "provider": "openrouter",
            "modelKey": "research-model",
            "accessMode": "openrouter-api",
            "tools": [],
            "reasoningEffort": "low",
        }
        assert fake_backend["deck"]["edges"] == DECK["edges"]

    def test_rejects_read_tools_and_default_quick_add_title(self, fake_backend):
        base = {
            "projectId": "p",
            "deckId": "d",
            "expectedRevision": "rev1",
            "title": "Search Agent",
            "role": "Research",
            "prompt": "Return cited evidence.",
            "runtime": {"kind": "autogen", "mode": "assistant"},
            "model": {
                "provider": "openrouter",
                "modelKey": "research-model",
                "accessMode": "openrouter-api",
            },
        }
        with pytest.raises(
            cp.ControlPlaneError,
            match="card_create_tools_must_be_write_operations:web_search",
        ):
            asyncio.run(cp.card_create({**base, "tools": ["web_search"]}))
        with pytest.raises(cp.ControlPlaneError, match="card_create_default_title_rejected"):
            asyncio.run(cp.card_create({**base, "title": "Assist 1"}))
        assert "deck" not in fake_backend

    def test_requires_current_revision_and_rejects_unknown_fields(self, fake_backend):
        base = {
            "projectId": "p",
            "deckId": "d",
            "expectedRevision": "stale",
            "title": "Researcher",
            "role": "Research",
            "prompt": "Return cited evidence.",
            "runtime": {"kind": "autogen", "mode": "assistant"},
            "model": {
                "provider": "openrouter",
                "modelKey": "research-model",
                "accessMode": "openrouter-api",
            },
        }
        with pytest.raises(cp.ControlPlaneError, match="deck_conflict"):
            asyncio.run(cp.card_create(base))
        with pytest.raises(cp.ControlPlaneError, match="card_create_fields_rejected"):
            asyncio.run(cp.card_create({**base, "expectedRevision": "rev1", "launch": True}))
        assert "deck" not in fake_backend


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

    def test_tools_update_accepts_only_idd_write_operations(self, fake_backend):
        with pytest.raises(
            cp.ControlPlaneError,
            match="card_update_tools_must_be_write_operations:web_search",
        ):
            asyncio.run(cp.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "updates": {"tools": ["web_search"]},
            }))

        result = asyncio.run(cp.card_update_configuration({
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "updates": {"tools": ["card.update_configuration"]},
        }))
        assert result["ok"] is True


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
    def test_rejoins_one_existing_run_without_resubmitting(self, monkeypatch):
        calls = []

        def backend(method, path, payload=None):
            calls.append((method, path, payload))
            return {
                "ok": True,
                "result": {
                    "runId": "run-existing",
                    "nativeRootId": "t_625de6e8",
                    "status": "working",
                },
            }

        monkeypatch.setattr(cp, "_backend_json", backend)
        response = asyncio.run(cp.card_run_assistant_agent({
            "projectId": "p",
            "deckId": "deck_builder",
            "correlationId": "server-injected-but-not-a-selector",
            "action": "status",
            "runId": "run-existing",
        }))
        assert response["result"]["runId"] == "run-existing"
        assert calls == [(
            "POST",
            "/api/coder/mcp-bridge/run_configured_card",
            {
                "projectId": "p",
                "deckId": "deck_builder",
                "action": "status",
                "runId": "run-existing",
            },
        )]

    def test_all_structural_references_required(self):
        with pytest.raises(cp.ControlPlaneError, match="input_required"):
            asyncio.run(cp.card_run_assistant_agent({
                "projectId": "p", "deckId": "d", "cardId": "c", "correlationId": "x",
            }))

    def test_forwards_only_saved_references_and_input(self, monkeypatch):
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
        assert sorted(payload.keys()) == ["action", "cardId", "correlationId", "deckId", "input", "projectId"]
        assert payload["action"] == "execute"
        assert payload["input"] == "hi"

        asyncio.run(cp.card_run_assistant_agent({
            "projectId": "p", "deckId": "d", "cardId": "c",
            "correlationId": "y", "conversationId": "conv-1",
            "input": "use the handoff",
        }))
        forwarded = calls[1][2]
        assert forwarded["conversationId"] == "conv-1"

        anchors = [{
            "authority": "KnowGraph", "nativeId": "episode-1",
            "reason": "selected current evidence", "priority": 1,
            "boundedExpansion": 0, "required": True,
        }]
        asyncio.run(cp.card_run_assistant_agent({
            "projectId": "p", "deckId": "d", "cardId": "c",
            "correlationId": "z", "input": "continue from the anchor",
            "dataAnchors": anchors,
        }))
        assert calls[2][2]["dataAnchors"] == anchors
        assert sorted(calls[2][2]) == [
            "action", "cardId", "correlationId", "dataAnchors", "deckId", "input", "projectId",
        ]

    def test_materialization_rejection_preserves_the_authority_error(self, monkeypatch):
        calls = []

        def backend(method, path, payload=None):
            calls.append((method, path, payload))
            return {"ok": False, "error": "card_relationship_not_authorized"}

        monkeypatch.setattr(cp, "_backend_json", backend)

        with pytest.raises(cp.ControlPlaneError, match="^card_relationship_not_authorized$"):
            asyncio.run(cp.card_run_assistant_agent({
                "projectId": "p",
                "deckId": "deck_builder",
                "cardId": "card_main_chat",
                "correlationId": "main-self-flow-rejected",
                "conversationId": "conv-1",
                "originatingAgentId": "card_main_chat",
                "originatingRunId": "main-turn-1",
                "input": "Do not run Main through the delegation doorway.",
            }))

        assert len(calls) == 1
        assert calls[0][2]["action"] == "execute"

    def test_trusted_inter_agent_call_forwards_native_parent_run(self, monkeypatch):
        calls = []

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

        assert calls[0][2]["originatingRunId"] == "main-turn-1"
        assert calls[0][2]["senderCardId"] == "card_hermes_steward"
        assert calls[0][2]["input"] == "Find one primary source."
        assert set(calls[0][2]) == {
            "action", "projectId", "deckId", "cardId", "correlationId",
            "conversationId", "senderCardId", "originatingRunId", "input",
        }
        assert response["result"]["status"] == "completed"


    def test_inter_agent_failure_records_backend_error(self, monkeypatch):
        def backend(_method, _path, payload=None):
            return {
                "ok": False,
                "error": "configured_card_failed",
                "result": {"status": "failed"},
            }

        monkeypatch.setattr(cp, "_backend_json", backend)

        with pytest.raises(cp.ControlPlaneError, match="^configured_card_failed$"):
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

    def test_plain_standalone_call_uses_same_doorway(self, monkeypatch):
        def backend(_method, _path, payload=None):
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
