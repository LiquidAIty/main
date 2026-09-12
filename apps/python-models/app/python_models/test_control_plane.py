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
        {"id": "signals-card", "title": "WorldSignals", "role": "",
         "templateId": "template_assist",
         "runtime": {"kind": "autogen", "mode": "assistant"}, "prompt": "p",
         "runtimeOptions": {"tools": ["worldsignals.capabilities", "worldsignals.command"]},
         "_cardRevisionId": "revision:signals-card"},
        {"id": "worker", "title": "Worker",
         "runtime": {"kind": "autogen", "mode": "assistant"},
         "prompt": "", "runtimeOptions": None,
         "_cardRevisionId": "revision:worker"},
        {"id": "builder-card", "title": "Agent Builder",
         "runtime": {"kind": "hermes", "mode": "delegate",
                     "profile": "builder"},
         "prompt": "Build saved Cards.", "runtimeOptions": {"tools": ["card.create", "card.update_configuration"]},
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


def create_args(**overrides):
    return {
        "projectId": "p", "deckId": "d", "expectedRevision": "rev1",
        "templateId": "template_assist", "title": "Research", "role": "Research sources",
        "prompt": "Return sourced findings.",
        "runtime": {"kind": "hermes", "mode": "delegate", "profile": "research"},
        "model": {"provider": "openrouter", "modelKey": "research-model",
                  "providerModelId": "research-model", "accessMode": "openrouter-api"},
        "tools": [], **overrides,
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


def test_team_overlay_is_not_a_card_creation_or_edit_option() -> None:
    assert "team" not in cp._CARD_CREATE_KEYS
    assert "team" not in cp._UPDATABLE_RUNTIME_OPTION_FIELDS


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
    # Disconnected Cards remain visible independently of any call allowlist.
    assert {card["id"] for card in result["cards"]} == {card["id"] for card in DECK["nodes"]}
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
        ("delegate", {"kind": "hermes", "mode": "delegate", "profile": "delegate"}),
        ("mag-one", {"kind": "autogen", "mode": "magentic_one"}),
    ],
)
def test_one_grounded_staging_path_loads_helper_or_mag_one_without_running(
    monkeypatch, target_id, runtime,
) -> None:
    import copy

    deck = copy.deepcopy(DECK)
    deck["nodes"].extend([
        {
            "id": "delegate", "title": "Delegate",
            "runtime": {"kind": "hermes", "mode": "delegate", "profile": "delegate"},
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
    def test_granted_builder_creates_requested_profile_and_native_selections(self, fake_backend):
        args = create_args(nativeTools=["read_file"], skills=["hermes-agent"],
                           toolsets=["file", "terminal"], position={"x": 12, "y": 8})
        result = asyncio.run(cp.card_create(args, caller_card_id="builder-card"))
        assert result["ok"] and result["created"] and result["started"] is False
        assert result["deckRevision"] == "rev2"
        assert fake_backend["expectedRevision"] == "rev1"
        card = result["card"]
        assert card["runtime"] == args["runtime"]
        for key in ("nativeTools", "skills", "toolsets"):
            assert card["runtimeOptions"][key] == args[key]
        assert card["position"] == args["position"]
        assert fake_backend["deck"]["nodes"][:-1] == DECK["nodes"]
        assert fake_backend["deck"]["edges"] == DECK["edges"]

    def test_create_requires_saved_caller_and_grant(self, fake_backend, monkeypatch):
        with pytest.raises(cp.ControlPlaneError, match="card_create_requires_agent_builder"):
            asyncio.run(cp.card_create(create_args()))
        monkeypatch.setitem(DECK["nodes"][2]["runtimeOptions"], "tools", [])
        with pytest.raises(cp.ControlPlaneError, match="card_create_not_granted"):
            asyncio.run(cp.card_create(create_args(), caller_card_id="builder-card"))
        assert fake_backend == {}

    @pytest.mark.parametrize(("change", "error"), [
        ({"expectedRevision": "stale"}, "deck_conflict"),
        ({"launch": True}, "card_create_fields_rejected"),
        ({"tools": ["unclassified_read"]}, "card_create_tool_unavailable"),
        ({"templateId": "template_main_chat"}, "card_create_template_runtime_mismatch"),
        ({"runtime": {"kind": "hermes", "mode": "delegate"}}, "card_create_profile_required"),
    ])
    def test_create_preserves_structural_rejections(self, fake_backend, change, error):
        with pytest.raises(cp.ControlPlaneError, match=error):
            asyncio.run(cp.card_create(create_args(**change), caller_card_id="builder-card"))
        assert fake_backend == {}


class TestCardUpdateConfiguration:
    def test_authenticated_user_can_edit_builder_without_impersonating_a_card(self, fake_backend):
        result = asyncio.run(cp.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:builder-card",
            "projectId": "p", "deckId": "deck_builder", "cardId": "builder-card",
            "updates": {"prompt": "Updated instructions"},
        }, authenticated_user_edit=True))
        assert result["ok"] is True
        assert fake_backend["expectedRevision"] == "rev1"
        assert fake_backend["deck"]["nodes"][:2] == DECK["nodes"][:2]
        updated = fake_backend["deck"]["nodes"][2]
        assert updated == {**DECK["nodes"][2], "prompt": "Updated instructions"}

    def test_authenticated_user_edit_keeps_structural_field_allowlist(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="card_update_fields_rejected"):
            asyncio.run(cp.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:builder-card",
                "projectId": "p", "deckId": "deck_builder", "cardId": "builder-card",
                "updates": {"runtime": {"kind": "other"}},
            }, authenticated_user_edit=True))
        assert fake_backend == {}

    def test_update_requires_builder_and_protects_self_and_main(self, fake_backend, monkeypatch):
        args = {"projectId": "p", "deckId": "d", "cardId": "signals-card",
                "expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
                "updates": {"prompt": "new prompt"}}
        with pytest.raises(cp.ControlPlaneError, match="card_update_requires_agent_builder"):
            asyncio.run(cp.card_update_configuration(args, caller_card_id="signals-card"))
        with pytest.raises(cp.ControlPlaneError, match="card_update_self_forbidden"):
            asyncio.run(cp.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:builder-card",**args, "cardId": "builder-card"}, caller_card_id="builder-card"))
        monkeypatch.setitem(DECK["nodes"][0], "runtime", {"kind": "hermes", "mode": "main", "profile": "main"})
        with pytest.raises(cp.ControlPlaneError, match="card_update_main_forbidden"):
            asyncio.run(cp.card_update_configuration(args, caller_card_id="builder-card"))
        assert fake_backend == {}

    @pytest.mark.parametrize("field", ["runtimeCode", "runtime", "team", "cardId"])
    def test_immutable_or_unsupported_fields_rejected(self, fake_backend, field):
        with pytest.raises(cp.ControlPlaneError, match="card_update_fields_rejected"):
            asyncio.run(cp.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
                "updates": {field: "x"},
            }, caller_card_id="builder-card"))
        assert fake_backend == {}

    def test_prompt_and_tools_update_persists_with_revision(self, fake_backend):
        result = asyncio.run(cp.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "updates": {"prompt": "new prompt", "tools": ["web_search"]},
        }, caller_card_id="builder-card"))
        assert result["ok"] is True
        assert fake_backend["expectedRevision"] == "rev1"
        card = next(n for n in fake_backend["deck"]["nodes"] if n["id"] == "signals-card")
        assert card["prompt"] == "new prompt"
        assert card["runtimeOptions"]["tools"] == ["web_search"]

    def test_structured_card_configuration_persists_with_revision(self, fake_backend):
        configuration = {"schemaVersion": "trading.card.v1", "trading": {"paperOnly": True}}
        result = asyncio.run(cp.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "updates": {"configuration": configuration},
        }, caller_card_id="builder-card"))
        assert result["ok"] is True
        card = next(n for n in fake_backend["deck"]["nodes"] if n["id"] == "signals-card")
        assert card["runtimeOptions"]["configuration"] == configuration

    def test_product_neutral_subsystem_attachment_persists_with_revision(self, fake_backend):
        subsystems = [{
            "id": "lumibot",
            "label": "LumiBot",
            "adapter": {
                "kind": "python",
                "contractVersion": "card-subsystem.v1",
                "capabilities": ["state", "readiness"],
            },
            "cardTab": {"enabled": True},
            "configurationSchema": "trading.card.v1",
        }]
        result = asyncio.run(cp.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "updates": {"subsystems": subsystems},
        }, caller_card_id="builder-card"))
        assert result["ok"] is True
        card = next(n for n in fake_backend["deck"]["nodes"] if n["id"] == "signals-card")
        assert card["runtimeOptions"]["subsystems"] == subsystems

    def test_builder_chooses_updates_without_prefilled_packet(self, fake_backend):
        updates = {"prompt": "Chosen after inspection", "title": "New title", "tools": ["web_search"],
                   "nativeTools": ["read_file"], "skills": ["hermes-agent"], "toolsets": ["file"]}
        result = asyncio.run(cp.card_update_configuration({
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
            "updates": updates,
        }, caller_card_id="builder-card"))
        assert result["deckRevision"] == "rev2"
        assert result["card"]["prompt"] == updates["prompt"]
        assert result["card"]["runtime"] == DECK["nodes"][0]["runtime"]
        for key in ("tools", "nativeTools", "skills", "toolsets"):
            assert result["card"]["runtimeOptions"][key] == updates[key]
        assert fake_backend["deck"]["nodes"][1:] == DECK["nodes"][1:]
        assert fake_backend["deck"]["edges"] == DECK["edges"]

    def test_tools_update_must_be_string_list(self, fake_backend):
        with pytest.raises(cp.ControlPlaneError, match="card_update_tools_must_be_string_list"):
            asyncio.run(cp.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "updates": {"tools": [{"name": "shell"}]},
            }, caller_card_id="builder-card"))

    def test_tools_update_rejects_unclassified_and_accepts_explicit_read_or_write(self, fake_backend):
        with pytest.raises(
            cp.ControlPlaneError,
            match="card_update_tool_unavailable:unclassified_read",
        ):
            asyncio.run(cp.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "updates": {"tools": ["unclassified_read"]},
            }, caller_card_id="builder-card"))

        result = asyncio.run(cp.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "updates": {"tools": ["card.update_configuration", "web_search"]},
        }, caller_card_id="builder-card"))
        assert result["ok"] is True
        saved = next(item for item in fake_backend["deck"]["nodes"] if item["id"] == "signals-card")
        assert saved["runtimeOptions"]["tools"] == ["card.update_configuration", "web_search"]

    @pytest.mark.parametrize(("deck_rev", "card_rev", "error"), [
        ("stale", "revision:signals-card", "deck_conflict"),
        ("rev1", "revision:worker", "card_revision_conflict"),
        ("rev1", "", "expectedCardRevisionId_required"),
    ])
    def test_exact_target_revisions_are_required(self, fake_backend, deck_rev, card_rev, error):
        with pytest.raises(cp.ControlPlaneError, match=error):
            asyncio.run(cp.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "expectedRevision": deck_rev, "expectedCardRevisionId": card_rev,
                "updates": {"prompt": "new prompt"},
            }, caller_card_id="builder-card"))
        assert fake_backend == {}


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

    def test_magentic_option_upsert_persists(self, fake_backend, monkeypatch):
        import copy
        deck = copy.deepcopy(DECK)
        deck['nodes'].append({'id': 'mag', 'runtime': {'kind': 'autogen', 'mode': 'magentic_one'}})
        monkeypatch.setattr(cp, '_load_deck', lambda *_: (deck, 'rev1'))
        result = asyncio.run(cp.canvas_upsert_wire({
            "projectId": "p", "deckId": "d", "op": "upsert",
            "wire": {"source": "worker", "target": "mag", "edgeType": "magentic_option"},
        }))
        assert result["ok"] is True
        edges = fake_backend["deck"]["edges"]
        assert any(e["edgeType"] == "magentic_option" for e in edges)

    @pytest.mark.parametrize('edge_type', ['flow', 'magentic_option', 'magentic_control'])
    def test_wire_round_trip_and_identical_upsert_preserve_every_field(self, monkeypatch, edge_type):
        import copy
        from app.python_models import card_domain
        source = {'id': 'source', 'kind': 'agent', 'runtime': {'kind': 'hermes', 'mode': 'main', 'profile': 'source'},
                  'runtimeOptions': {'delegationRole': "profile", 'tools': ['canvas.inspect']}}
        target = {'id': 'target', 'kind': 'agent', 'runtime': {'kind': 'hermes', 'mode': 'delegate', 'profile': 'target'},
                  'runtimeOptions': {'delegationRole': "off"}}
        if edge_type != 'flow':
            target['runtime'] = {'kind': 'autogen', 'mode': 'magentic_one'}
        deck = {'nodes': [source, target], 'edges': []}
        cards_before = copy.deepcopy(deck['nodes'])
        saves = []
        monkeypatch.setattr(cp, '_load_deck', lambda *_: (copy.deepcopy(deck), 'rev1'))
        def save(_project, _deck_id, value, _revision):
            saves.append(copy.deepcopy(value))
            deck.update(value)
        monkeypatch.setattr(cp, '_save_deck', save)
        wire = {'id': 'wire', 'source': 'source', 'target': 'target', 'sourceHandle': 'out',
                'targetHandle': 'in', 'edgeType': edge_type, 'enabled': False, 'label': 'Saved label',
                'style': {'strokeWidth': 2}}
        args = {'projectId': 'p', 'deckId': 'd', 'op': 'upsert', 'wire': wire}
        assert asyncio.run(cp.canvas_upsert_wire(args))['ok']
        assert deck['edges'] == [wire]
        # An abbreviated update retains saved fields and performs no write when unchanged.
        args['wire'] = {key: wire[key] for key in ('id', 'source', 'target')}
        assert asyncio.run(cp.canvas_upsert_wire(args))['ok']
        assert len(saves) == 1
        if edge_type != 'flow':
            # Reversing only serialization keeps each port on its original Card and is a no-op.
            args['wire'] = {'id': wire['id'], 'source': wire['target'], 'target': wire['source']}
            assert asyncio.run(cp.canvas_upsert_wire(args))['ok']
            assert len(saves) == 1
            assert deck['edges'] == [wire]
        assert asyncio.run(cp.canvas_inspect({'projectId': 'p', 'deckId': 'd'}))['wires'] == [wire]
        core = card_domain._edge_core(wire)
        properties = {**core, 'edgeId': core['id'], 'ordinal': 0}
        monkeypatch.setattr(card_domain, '_age_rows', lambda _cursor, query, *_:
                            [{'source': wire['source'], 'target': wire['target'], 'properties': properties}]
                            if ':' + card_domain._edge_labels()[edge_type] + ']' in query else [])
        assert card_domain._load_age_edges(None, 'p', 'd') == [wire]
        assert deck['nodes'] == cards_before

    def test_blue_reverse_duplicates_and_invalid_endpoint_pairs(self, monkeypatch):
        deck = {'nodes': [{'id': key, 'runtime': {'kind': 'autogen', 'mode': mode}}
                          for key, mode in [('a', 'assistant'), ('b', 'assistant'),
                                            ('mag', 'magentic_one'), ('other-mag', 'magentic_one')]],
                'edges': [{'id': 'existing', 'source': 'a', 'target': 'mag', 'edgeType': 'magentic_option'}]}
        monkeypatch.setattr(cp, '_load_deck', lambda *_: (deck, 'rev1'))
        monkeypatch.setattr(cp, '_save_deck', lambda *_: pytest.fail('Rejected wires must not save or execute'))
        for source, target, reason in [('mag', 'a', 'duplicate'), ('a', 'b', 'endpoint_required'),
                                       ('mag', 'other-mag', 'endpoint_required')]:
            with pytest.raises(cp.ControlPlaneError, match=reason):
                asyncio.run(cp.canvas_upsert_wire({'projectId': 'p', 'deckId': 'd', 'op': 'upsert',
                    'wire': {'id': 'new', 'source': source, 'target': target, 'edgeType': 'magentic_option'}}))


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
            "/api/cards/run",
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
        assert path == "/api/cards/run"
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


@pytest.mark.parametrize("profile", ["../escape", "has space", "Upper", "root", "a" * 65])
def test_card_create_rejects_invalid_native_profile_names(fake_backend, profile):
    with pytest.raises(cp.ControlPlaneError, match="card_create_profile_invalid"):
        asyncio.run(cp.card_create(create_args(runtime={"kind": "hermes", "mode": "delegate", "profile": profile}), caller_card_id="builder-card"))
    assert fake_backend == {}


def test_selected_card_inspection_contains_full_configuration_and_revisions(fake_backend):
    result = asyncio.run(cp.canvas_inspect({"projectId": "p", "deckId": "d", "cardId": "signals-card"}))
    assert result["selectedCard"] == DECK["nodes"][0]
    assert result["deckRevision"] == "rev1"
    assert result["selectedCard"]["_cardRevisionId"] == "revision:signals-card"
    assert fake_backend == {}
