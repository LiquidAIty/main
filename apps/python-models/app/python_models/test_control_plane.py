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
    "workspaceRoot": "C:/Projects/agents",
    "nodes": [
        {"id": "signals-card", "title": "WorldSignals",
         "runtime": {"kind": "autogen", "mode": "assistant"}, "prompt": "p",
         "runtimeOptions": {"tools": ["worldsignals.capabilities", "worldsignals.command"]},
         "_cardRevisionId": "revision:signals-card"},
        {"id": "worker", "title": "Worker",
         "runtime": {"kind": "autogen", "mode": "assistant"},
         "prompt": "", "runtimeOptions": None,
         "_cardRevisionId": "revision:worker"},
        {"id": "builder-card", "title": "Agent Builder",
         "runtime": {"kind": "hermes", "mode": "delegate",
                     "profile": "agent-builder"},
         "prompt": "Build saved Cards.", "runtimeOptions": {"tools": []},
         "_cardRevisionId": "revision:builder-card"},
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


def builder_target_authority(card_id="signals-card", deck_revision="rev1"):
    return {
        "caller_card_id": "builder-card",
        "target_card_id": card_id,
        "target_card_revision_id": f"revision:{card_id}",
        "target_deck_revision": deck_revision,
        "operation_mode": "edit",
        "allowed_fields": ["prompt", "tools"],
        "workspace_root": "C:/Projects/agents",
    }


def builder_create_authority(
    *, title="Search Agent", role="Bounded live-web researcher",
    prompt="Return cited sources and claims. Do not write KnowGraph.",
    tools=None, template_id="template_assist", deck_revision="rev1",
):
    model = {
        "provider": "openrouter",
        "modelKey": "research-model",
        "providerModelId": "research-model",
        "accessMode": "openrouter-api",
    }
    return {
        "mode": "create",
        "deckRevision": deck_revision,
        "workspaceRoot": "C:/Projects/agents",
        "allowedFields": ["prompt", "tools"],
        "templateId": template_id,
        "title": title,
        "role": role,
        "prompt": prompt,
        "tools": list(tools or []),
        "model": model,
    }


def test_saved_card_reference_exposes_explicit_runtime() -> None:
    reference = cp.resolve_saved_card_reference(
        "project-one",
        "deck_builder",
        "signals-card",
        deck=DECK,
    )

    assert reference["runtime"] == {"kind": "autogen", "mode": "assistant"}
    assert reference["role"] == ""


def test_team_defaults_are_strict_card_configuration() -> None:
    model = {
        "provider": "openai", "accessMode": "chatgpt-account",
        "modelKey": "gpt-5.6-luna", "providerModelId": "gpt-5.6-luna",
    }
    assert cp._team_config({
        "mode": "auto", "maxWorkers": 4, "retryLimit": 1,
        "workerModel": model, "leadModel": model,
    })["maxWorkers"] == 4
    with pytest.raises(cp.ControlPlaneError, match="card_team_config_invalid"):
        cp._team_config({
            "mode": "auto", "maxWorkers": 8, "retryLimit": 1,
            "workerModel": model, "leadModel": model,
        })


def test_canvas_inspect_returns_only_the_bounded_public_projection(fake_backend) -> None:
    result = asyncio.run(cp.canvas_inspect({"projectId": "p", "deckId": "d"}))

    assert result["deckRevision"] == "rev1"
    assert result["cards"][0] == {
        "id": "signals-card",
        "title": "WorldSignals",
        "runtime": {"kind": "autogen", "mode": "assistant"},
        "tools": ["worldsignals.capabilities", "worldsignals.command"],
        "savedWriteTools": ["worldsignals.command"],
        "legacyReadableSelections": ["worldsignals.capabilities"],
        "unknownConfiguredTools": [],
        "unavailableConfiguredTools": [],
    }
    assert result["effectiveReadTools"] == []
    assert all("prompt" not in card for card in result["cards"])
    assert result["wires"] == [
        {"id": "w1", "source": "worker", "target": "signals-card", "edgeType": "flow"}
    ]


def test_canvas_reports_removed_grant_unavailable_and_never_allocates_it(fake_backend, monkeypatch):
    monkeypatch.setitem(DECK["nodes"][0]["runtimeOptions"], "tools", [
        "retired.project_memory_admin", "worldsignals.command",
    ])
    result = asyncio.run(cp.canvas_inspect({"projectId": "p", "deckId": "d"}))
    card = result["cards"][0]
    assert card["tools"] == ["worldsignals.command"]
    assert card["savedWriteTools"] == ["worldsignals.command"]
    assert card["unknownConfiguredTools"] == ["retired.project_memory_admin"]
    assert card["unavailableConfiguredTools"] == []
    assert "retired.project_memory_read" not in result["effectiveReadTools"]
    assert fake_backend == {}  # inspection never rewrites the saved grant


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
        "runtime": {"kind": "hermes", "mode": "delegate", "profile": "helper"},
        "runtimeOptions": {"tools": ["write_mag_one_instructions"]},
    })
    calls = []

    def backend(method, _path, payload=None):
        calls.append((method, payload))
        assert method == "GET"
        return {"ok": True, "deck": copy.deepcopy(deck), "meta": {"deckRevision": "rev-mag"}}

    monkeypatch.setattr(cp, "_backend_json", backend)
    reviews = []

    def prepare_review(request):
        reviews.append(copy.deepcopy(request))
        has_graph_data = bool(request.get("dataAnchors"))
        return {
            "projectId": "p", "deckId": "deck_builder", "ephemeral": True,
            "cardRevisionId": f"revision-{target_id}", "cardRevision": 1,
            "cardRevisionSha256": "sha", "runtimeOwner": runtime["kind"],
            "cardIdentity": {"cardId": target_id, "title": target_id},
            "resolvedNativeReads": ([{
                "authority": "KnowGraph", "nativeId": "episode-1",
            }] if has_graph_data else []),
            "resolvedGraphProjection": {
                "schemaVersion": "native-card-context.v1", "authority": "knowgraph",
                "projectId": "p",
                "nodes": ([{"id": "episode-1"}] if has_graph_data else []),
                "edges": [],
                "counts": {"nodes": 1 if has_graph_data else 0, "edges": 0},
            },
        }

    monkeypatch.setattr(
        "app.python_models.card_domain.prepare_card_review_context",
        prepare_review,
    )
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
    assert result["reviewContext"]["resolvedGraphProjection"]["nodes"] == [{"id": "episode-1"}]
    assert "idf" not in result["reviewContext"]
    assert result["ready"] is True
    assert result["persisted"] is False
    assert result["started"] is False
    assert reviews == [{
        "projectId": "p", "deckId": "deck_builder", "cardId": target_id,
        "assignment": "Research one bounded public question.\nKeep citations.",
        "dataAnchors": [{
            "authority": "KnowGraph", "nativeId": "episode-1",
            "reason": "Current sourced evidence", "priority": 0,
            "boundedExpansion": 1, "resultLimit": 8, "required": True,
        }],
    }]
    assert [method for method, _payload in calls] == ["GET"]

    without_graph = asyncio.run(cp.write_mag_one_instructions({
        "projectId": "p",
        "deckId": "deck_builder",
        "targetCardId": target_id,
        "mission": "Review a mission with no selected graph data.",
        "_sourceCardId": "helper",
    }))
    assert without_graph["dataAnchors"] == []
    assert without_graph["reviewContext"]["resolvedGraphProjection"]["nodes"] == []
    assert reviews[-1]["dataAnchors"] == []
    assert "idf" not in without_graph["reviewContext"]


def test_grounded_staging_requires_source_card_write_grant(monkeypatch, fake_backend) -> None:
    with pytest.raises(cp.ControlPlaneError, match="write_mag_one_instructions_not_granted"):
        asyncio.run(cp.write_mag_one_instructions({
            "projectId": "p", "deckId": "d", "targetCardId": "worker",
            "mission": "bounded", "dataAnchors": [{"nativeId": "one"}],
            "_sourceCardId": "signals-card",
        }))


def test_grounded_staging_rejects_a_non_delegate_source_even_with_the_tool(monkeypatch) -> None:
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

    with pytest.raises(cp.ControlPlaneError, match="grounded_staging_source_must_be_hermes_delegate"):
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
    def test_run_authority_creates_one_explicit_autogen_card_without_launching(
        self, fake_backend,
    ):
        operation = builder_create_authority()
        result = asyncio.run(cp.card_create({
            "projectId": "p",
            "deckId": "d",
            "expectedRevision": "rev1",
            "templateId": operation["templateId"],
            "title": "Search Agent",
            "role": "Bounded live-web researcher",
            "prompt": "Return cited sources and claims. Do not write KnowGraph.",
            "runtime": {"kind": "autogen", "mode": "assistant"},
            "model": operation["model"],
            "tools": [],
        }, caller_card_id="builder-card", builder_operation=operation))

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
            "providerModelId": "research-model",
            "accessMode": "openrouter-api",
            "tools": [],
            "nativeTools": [],
            "skills": [],
            "toolsets": [],
            "mcpConnectionIds": [],
        }
        assert fake_backend["deck"]["edges"] == DECK["edges"]

    def test_direct_or_non_assistant_creation_is_rejected(self, fake_backend):
        operation = builder_create_authority()
        base = {
            "projectId": "p",
            "deckId": "d",
            "expectedRevision": "rev1",
            "templateId": operation["templateId"],
            "title": operation["title"],
            "role": operation["role"],
            "prompt": operation["prompt"],
            "runtime": {"kind": "autogen", "mode": "assistant"},
            "model": operation["model"],
            "tools": [],
        }
        with pytest.raises(cp.ControlPlaneError, match="card_create_requires_agent_builder"):
            asyncio.run(cp.card_create(base))
        with pytest.raises(cp.ControlPlaneError, match="agent_builder_create_runtime_forbidden"):
            asyncio.run(cp.card_create({
                **base,
                "runtime": {"kind": "hermes", "mode": "delegate", "profile": "research"},
            }, caller_card_id="builder-card", builder_operation=operation))
        assert "deck" not in fake_backend

    def test_rejects_unavailable_tools_system_templates_and_request_drift(self, fake_backend):
        operation = builder_create_authority()
        base = {
            "projectId": "p",
            "deckId": "d",
            "expectedRevision": "rev1",
            "templateId": operation["templateId"],
            "title": operation["title"],
            "role": operation["role"],
            "prompt": operation["prompt"],
            "runtime": {"kind": "autogen", "mode": "assistant"},
            "model": operation["model"],
            "tools": [],
        }
        with pytest.raises(
            cp.ControlPlaneError,
            match="card_create_tool_unavailable:unclassified_read",
        ):
            asyncio.run(cp.card_create(
                {**base, "tools": ["unclassified_read"]},
                caller_card_id="builder-card",
                builder_operation=operation,
            ))
        system_operation = builder_create_authority(template_id="template_main_chat")
        with pytest.raises(cp.ControlPlaneError, match="agent_builder_system_template_forbidden"):
            asyncio.run(cp.card_create(
                {**base, "templateId": "template_main_chat"},
                caller_card_id="builder-card",
                builder_operation=system_operation,
            ))
        with pytest.raises(cp.ControlPlaneError, match="agent_builder_create_request_mismatch"):
            asyncio.run(cp.card_create(
                {**base, "prompt": "Drifted after the Run began."},
                caller_card_id="builder-card",
                builder_operation=operation,
            ))
        assert "deck" not in fake_backend

    def test_requires_current_revision_and_rejects_unknown_fields(self, fake_backend):
        operation = builder_create_authority()
        base = {
            "projectId": "p",
            "deckId": "d",
            "expectedRevision": "stale",
            "templateId": operation["templateId"],
            "title": operation["title"],
            "role": operation["role"],
            "prompt": operation["prompt"],
            "runtime": {"kind": "autogen", "mode": "assistant"},
            "model": operation["model"],
            "tools": [],
        }
        with pytest.raises(cp.ControlPlaneError, match="deck_conflict"):
            asyncio.run(cp.card_create(
                base, caller_card_id="builder-card", builder_operation=operation,
            ))
        with pytest.raises(cp.ControlPlaneError, match="card_create_fields_rejected"):
            asyncio.run(cp.card_create(
                {**base, "expectedRevision": "rev1", "launch": True},
                caller_card_id="builder-card",
                builder_operation=operation,
            ))
        assert "deck" not in fake_backend


class TestCardUpdateConfiguration:
    def test_update_requires_agent_builder_and_cannot_target_system_cards(self, fake_backend):
        with pytest.raises(
            cp.ControlPlaneError, match="card_update_requires_agent_builder"
        ):
            asyncio.run(cp.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "updates": {"prompt": "new prompt"},
            }, **{**builder_target_authority(), "caller_card_id": "signals-card"}))
        with pytest.raises(
            cp.ControlPlaneError, match="agent_builder_target_self_forbidden"
        ):
            asyncio.run(cp.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "builder-card",
                "updates": {"prompt": "new prompt"},
            }, **builder_target_authority("builder-card")))

    def test_arbitrary_runtime_and_authority_fields_rejected(self, fake_backend):
        for field in (
            "runtimeCode", "title", "modelKey", "script", "nativeTools",
            "skills", "toolsets", "mcpConnectionIds", "team",
        ):
            with pytest.raises(cp.ControlPlaneError, match="agent_builder_edit_field_forbidden"):
                asyncio.run(cp.card_update_configuration({
                    "projectId": "p", "deckId": "d", "cardId": "signals-card", "updates": {field: "x"},
                }, **builder_target_authority()))
        assert "deck" not in fake_backend  # nothing was saved

    def test_prompt_and_tools_update_persists_with_revision(self, fake_backend):
        result = asyncio.run(cp.card_update_configuration({
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "updates": {"prompt": "new prompt", "tools": ["web_search"]},
        }, **builder_target_authority()))
        assert result["ok"] is True
        assert fake_backend["expectedRevision"] == "rev1"
        card = next(n for n in fake_backend["deck"]["nodes"] if n["id"] == "signals-card")
        assert card["prompt"] == "new prompt"
        assert card["runtimeOptions"]["tools"] == ["web_search"]

    def test_tools_update_must_be_string_list(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="card_update_tools_must_be_string_list"):
            asyncio.run(cp.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "updates": {"tools": [{"name": "shell"}]},
            }, **builder_target_authority()))

    def test_tools_update_rejects_unclassified_and_accepts_explicit_read_or_write(self, fake_backend):
        with pytest.raises(
            cp.ControlPlaneError,
            match="card_update_tool_unavailable:unclassified_read",
        ):
            asyncio.run(cp.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "updates": {"tools": ["unclassified_read"]},
            }, **builder_target_authority()))

        result = asyncio.run(cp.card_update_configuration({
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "updates": {"tools": ["card.update_configuration", "web_search"]},
        }, **builder_target_authority()))
        assert result["ok"] is True
        saved = next(item for item in fake_backend["deck"]["nodes"] if item["id"] == "signals-card")
        assert saved["runtimeOptions"]["tools"] == ["card.update_configuration", "web_search"]

    def test_target_revision_and_workspace_are_bound_to_the_builder_run(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="agent_builder_target_mismatch"):
            asyncio.run(cp.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "updates": {"prompt": "new prompt"},
            }, **builder_target_authority("worker")))
        with pytest.raises(cp.ControlPlaneError, match="agent_builder_target_revision_changed"):
            asyncio.run(cp.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "updates": {"prompt": "new prompt"},
            }, **builder_target_authority(deck_revision="stale")))
        with pytest.raises(cp.ControlPlaneError, match="agent_builder_workspace_changed"):
            asyncio.run(cp.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "updates": {"prompt": "new prompt"},
            }, **{**builder_target_authority(), "workspace_root": "C:/Projects/other"}))


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
            "projectId": "p", "deckId": "d", "cardId": "c",
            "cardRevisionId": "revision-c", "correlationId": "x", "input": "hi",
        }))
        method, path, payload = calls[0]
        assert path == "/api/coder/mcp-bridge/run_configured_card"
        assert sorted(payload.keys()) == [
            "action", "cardId", "cardRevisionId", "correlationId", "deckId", "input", "projectId",
        ]
        assert payload["action"] == "execute"
        assert payload["cardRevisionId"] == "revision-c"
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
