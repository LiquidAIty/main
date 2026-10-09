"""Focused saved Card and Canvas tool coverage (no network, no DB).

Proves the user-directed application tools enforce their gates: strict
Card creation and update, supported wire semantics, and no-override card runs.
"""

import asyncio

import pytest

from app import (
    saved_canvas_tools,
    saved_card_tools,
    saved_deck_http,
)
from app.application_tool_error import ApplicationToolError


def test_deck_transport_does_not_receive_the_mcp_process_secret(monkeypatch) -> None:
    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        @staticmethod
        def read():
            return b'{"ok": true}'

    def open_request(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setenv(
        "LIQUIDAITY_INTERNAL_MCP_SECRET",
        "internal-process-bridge-secret-0123456789abcdef",
    )
    monkeypatch.setattr(saved_deck_http, "urlopen", open_request)

    assert saved_deck_http.request_backend_json(
        "GET", "/api/projects/project/decks/deck"
    ) == {"ok": True}
    assert captured["timeout"] == 300
    assert captured["request"].get_header("X-liquidaity-internal-mcp-secret") is None

DECK = {
    "id": "deck_builder",
    "name": "Builder",
    "projectCodeFolder": "worker-agent-ui",
    "nodes": [
        {"id": "signals-card", "title": "WorldSignals", "role": "",
         "templateId": "template_assist",
         "runtime": {"kind": "hermes", "mode": "delegate", "profile": "signals-card"},
         "prompt": "p",
         "runtimeOptions": {"tools": ["worldsignals.capabilities", "worldsignals.command"]},
         "_cardRevisionId": "revision:signals-card"},
        {"id": "worker", "title": "Worker",
         "runtime": {"kind": "hermes", "mode": "delegate", "profile": "worker"},
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

    monkeypatch.setattr(saved_deck_http, "request_backend_json", backend)
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


def test_team_overlay_is_not_a_card_creation_or_edit_option() -> None:
    assert "team" not in saved_card_tools._CARD_CREATE_KEYS
    assert "team" not in saved_card_tools._UPDATABLE_RUNTIME_OPTION_FIELDS

def test_auto_flags_are_boolean_fields_on_both_existing_card_operations() -> None:
    create = saved_card_tools.saved_card_operation_schema("card.create")
    update = saved_card_tools.saved_card_operation_schema(
        "card.update_configuration"
    )

    for field in ("autoTools", "autoModel"):
        assert create["properties"][field] == {"type": "boolean"}
        assert update["properties"]["updates"]["properties"][field] == {
            "type": "boolean",
        }


def test_canvas_inspect_returns_only_the_bounded_public_projection(fake_backend) -> None:
    result = asyncio.run(saved_canvas_tools.canvas_inspect({"projectId": "p", "deckId": "d"}))

    assert result["deckRevision"] == "rev1"
    assert result["cards"][0] == {
        "id": "signals-card",
        "title": "WorldSignals",
        "runtime": {"kind": "hermes", "mode": "delegate", "profile": "signals-card"},
        "tools": ["worldsignals.capabilities", "worldsignals.command"],
        "savedWriteTools": ["worldsignals.command"],
        "unknownConfiguredTools": [],
    }
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
    result = asyncio.run(saved_canvas_tools.canvas_inspect({"projectId": "p", "deckId": "d"}))
    card = result["cards"][0]
    assert card["tools"] == ["worldsignals.command"]
    assert card["savedWriteTools"] == ["worldsignals.command"]
    assert card["unknownConfiguredTools"] == ["retired.project_memory_admin"]
    assert fake_backend == {}  # inspection never rewrites the saved grant


class TestCardCreate:
    def test_granted_builder_creates_requested_profile_and_tool_selections(self, fake_backend):
        args = create_args(tools=["canvas.inspect", "web_search"], skills=["hermes-agent"],
                           toolsets=["file", "terminal"], autoTools=True,
                           autoModel=False, position={"x": 12, "y": 8})
        result = asyncio.run(saved_card_tools.card_create(args, caller_card_id="builder-card"))
        assert result["ok"] and result["created"] and result["started"] is False
        assert result["deckRevision"] == "rev2"
        assert fake_backend["expectedRevision"] == "rev1"
        card = result["card"]
        assert card["runtime"] == args["runtime"]
        assert card["runtimeOptions"]["subagentType"] == "none"
        for key in ("tools", "skills", "toolsets"):
            assert card["runtimeOptions"][key] == args[key]
        assert card["runtimeOptions"]["autoTools"] is True
        assert card["runtimeOptions"]["autoModel"] is False
        assert card["position"] == args["position"]
        assert fake_backend["deck"]["nodes"][:-1] == DECK["nodes"]
        assert fake_backend["deck"]["edges"] == DECK["edges"]

    def test_create_requires_saved_caller_and_grant(self, fake_backend, monkeypatch):
        with pytest.raises(ApplicationToolError, match="card_create_requires_agent_builder"):
            asyncio.run(saved_card_tools.card_create(create_args()))
        monkeypatch.setitem(DECK["nodes"][2]["runtimeOptions"], "tools", [])
        with pytest.raises(ApplicationToolError, match="card_create_not_granted"):
            asyncio.run(saved_card_tools.card_create(create_args(), caller_card_id="builder-card"))
        assert fake_backend == {}

    @pytest.mark.parametrize("selection", ["none", "leaf", "recursive"])
    def test_create_saves_one_exact_subagent_type(self, fake_backend, selection):
        result = asyncio.run(saved_card_tools.card_create(
            create_args(subagentType=selection),
            caller_card_id="builder-card",
        ))

        assert result["card"]["runtimeOptions"]["subagentType"] == selection

    def test_create_rejects_retired_team_as_a_subagent_type(self, fake_backend):
        with pytest.raises(ApplicationToolError, match="card_create_subagent_type_invalid"):
            asyncio.run(saved_card_tools.card_create(
                create_args(subagentType="team"),
                caller_card_id="builder-card",
            ))
        assert fake_backend == {}

    @pytest.mark.parametrize(("change", "error"), [
        ({"expectedRevision": "stale"}, "deck_conflict"),
        ({"launch": True}, "card_create_fields_rejected"),
        ({"tools": ["unclassified_read"]}, "card_create_tool_unavailable"),
        ({"templateId": "template_main_chat"}, "card_create_template_runtime_mismatch"),
        ({"runtime": {"kind": "hermes", "mode": "delegate"}}, "card_create_profile_required"),
    ])
    def test_create_preserves_structural_rejections(self, fake_backend, change, error):
        with pytest.raises(ApplicationToolError, match=error):
            asyncio.run(saved_card_tools.card_create(create_args(**change), caller_card_id="builder-card"))
        assert fake_backend == {}

    def test_create_auto_flags_are_boolean_and_non_magnetic(self, fake_backend):
        with pytest.raises(ApplicationToolError, match="card_create_auto_tools_invalid"):
            asyncio.run(saved_card_tools.card_create(
                create_args(autoTools=1), caller_card_id="builder-card",
            ))
        with pytest.raises(
            ApplicationToolError,
            match="card_create_auto_model_requires_non_magnetic_hermes",
        ):
            asyncio.run(saved_card_tools.card_create(
                create_args(
                    autoModel=True,
                    runtime={
                        "kind": "hermes", "mode": "magentic_one",
                        "profile": "magnetic",
                    },
                ),
                caller_card_id="builder-card",
            ))
        assert fake_backend == {}


class TestCardUpdateConfiguration:
    def test_authenticated_user_can_edit_builder_without_impersonating_a_card(self, fake_backend):
        result = asyncio.run(saved_card_tools.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:builder-card",
            "projectId": "p", "deckId": "deck_builder", "cardId": "builder-card",
            "updates": {"prompt": "Updated instructions"},
        }, authenticated_user_edit=True))
        assert result["ok"] is True
        assert fake_backend["expectedRevision"] == "rev1"
        assert fake_backend["deck"]["nodes"][:2] == DECK["nodes"][:2]
        updated = fake_backend["deck"]["nodes"][2]
        assert updated == {**DECK["nodes"][2], "prompt": "Updated instructions"}

    def test_authenticated_user_edit_keeps_structural_field_allowlist(self, fake_backend):
        with pytest.raises(ApplicationToolError, match="card_update_fields_rejected"):
            asyncio.run(saved_card_tools.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:builder-card",
                "projectId": "p", "deckId": "deck_builder", "cardId": "builder-card",
                "updates": {"runtime": {"kind": "other"}},
            }, authenticated_user_edit=True))
        assert fake_backend == {}

    def test_update_requires_builder_and_protects_self_and_main(self, fake_backend, monkeypatch):
        args = {"projectId": "p", "deckId": "d", "cardId": "signals-card",
                "expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
                "updates": {"prompt": "new prompt"}}
        with pytest.raises(ApplicationToolError, match="card_update_requires_agent_builder"):
            asyncio.run(saved_card_tools.card_update_configuration(args, caller_card_id="signals-card"))
        with pytest.raises(ApplicationToolError, match="card_update_self_forbidden"):
            asyncio.run(saved_card_tools.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:builder-card",**args, "cardId": "builder-card"}, caller_card_id="builder-card"))
        monkeypatch.setitem(DECK["nodes"][0], "runtime", {"kind": "hermes", "mode": "main", "profile": "main"})
        with pytest.raises(ApplicationToolError, match="card_update_main_forbidden"):
            asyncio.run(saved_card_tools.card_update_configuration(args, caller_card_id="builder-card"))
        assert fake_backend == {}

    @pytest.mark.parametrize("field", ["runtimeCode", "runtime", "team", "cardId"])
    def test_immutable_or_unsupported_fields_rejected(self, fake_backend, field):
        with pytest.raises(ApplicationToolError, match="card_update_fields_rejected"):
            asyncio.run(saved_card_tools.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
                "updates": {field: "x"},
            }, caller_card_id="builder-card"))
        assert fake_backend == {}

    def test_prompt_and_tools_update_persists_with_revision(self, fake_backend):
        result = asyncio.run(saved_card_tools.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "updates": {"prompt": "new prompt", "tools": ["web_search"]},
        }, caller_card_id="builder-card"))
        assert result["ok"] is True
        assert fake_backend["expectedRevision"] == "rev1"
        card = next(n for n in fake_backend["deck"]["nodes"] if n["id"] == "signals-card")
        assert card["prompt"] == "new prompt"
        assert card["runtimeOptions"]["tools"] == ["web_search"]

    def test_auto_flags_update_through_the_existing_runtime_options_path(
        self, fake_backend,
    ):
        result = asyncio.run(saved_card_tools.card_update_configuration({
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "expectedRevision": "rev1",
            "expectedCardRevisionId": "revision:signals-card",
            "updates": {"autoTools": True, "autoModel": False},
        }, caller_card_id="builder-card"))

        assert result["appliedFields"] == ["autoModel", "autoTools"]
        assert result["card"]["runtimeOptions"]["autoTools"] is True
        assert result["card"]["runtimeOptions"]["autoModel"] is False

    def test_auto_flag_update_rejects_coercion_and_magnetic_cards(
        self, fake_backend, monkeypatch,
    ):
        base = {
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "expectedRevision": "rev1",
            "expectedCardRevisionId": "revision:signals-card",
        }
        with pytest.raises(ApplicationToolError, match="card_update_auto_tools_invalid"):
            asyncio.run(saved_card_tools.card_update_configuration({
                **base, "updates": {"autoTools": 1},
            }, caller_card_id="builder-card"))
        monkeypatch.setitem(DECK["nodes"][0], "runtime", {
            "kind": "hermes", "mode": "magentic_one", "profile": "signals-card",
        })
        with pytest.raises(
            ApplicationToolError,
            match="card_auto_model_requires_non_magnetic_hermes",
        ):
            asyncio.run(saved_card_tools.card_update_configuration({
                **base, "updates": {"autoModel": True},
            }, caller_card_id="builder-card"))
        assert fake_backend == {}

    @pytest.mark.parametrize("selection", ["none", "leaf", "recursive"])
    def test_subagent_type_update_persists_with_revision(self, fake_backend, selection):
        result = asyncio.run(saved_card_tools.card_update_configuration({
            "expectedRevision": "rev1",
            "expectedCardRevisionId": "revision:signals-card",
            "projectId": "p",
            "deckId": "d",
            "cardId": "signals-card",
            "updates": {"subagentType": selection},
        }, caller_card_id="builder-card"))

        assert result["card"]["runtimeOptions"]["subagentType"] == selection

    def test_subagent_type_update_rejects_retired_team(self, fake_backend):
        with pytest.raises(ApplicationToolError, match="card_update_subagent_type_invalid"):
            asyncio.run(saved_card_tools.card_update_configuration({
                "expectedRevision": "rev1",
                "expectedCardRevisionId": "revision:signals-card",
                "projectId": "p",
                "deckId": "d",
                "cardId": "signals-card",
                "updates": {"subagentType": "team"},
            }, caller_card_id="builder-card"))
        assert fake_backend == {}

    def test_card_script_update_preserves_and_validates_source_without_enable_switch(
        self, fake_backend,
    ):
        source = '''CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {"type": "object", "properties": {}},
    "output": {"type": "object", "properties": {"result": {}}, "required": ["result"]},
}
from hermes_tools import output
output.emit({"result": {}})
'''
        result = asyncio.run(saved_card_tools.card_update_configuration({
            "expectedRevision": "rev1",
            "expectedCardRevisionId": "revision:signals-card",
            "projectId": "p",
            "deckId": "d",
            "cardId": "signals-card",
            "updates": {"script": {"enabled": False, "source": source, "version": 1}},
        }, caller_card_id="builder-card"))

        assert result["ok"] is True
        saved = next(
            node for node in fake_backend["deck"]["nodes"]
            if node["id"] == "signals-card"
        )["runtimeOptions"]["script"]
        assert saved["source"] == source
        assert saved["lastValidation"]["status"] == "valid"
        assert saved["author"] == {"kind": "agent-builder", "id": "builder-card"}
        assert "enabled" not in saved
        assert "hermesSupport" not in saved

    def test_unrelated_edit_preserves_incomplete_legacy_provider_authority(self, fake_backend):
        result = asyncio.run(saved_card_tools.card_update_configuration({
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
            "updates": {"prompt": "repair the prompt only"},
        }, caller_card_id="builder-card"))

        assert result["ok"] is True
        saved = next(item for item in fake_backend["deck"]["nodes"] if item["id"] == "signals-card")
        assert saved["prompt"] == "repair the prompt only"
        assert "provider" not in saved["runtimeOptions"]
        assert "accessMode" not in saved["runtimeOptions"]

    def test_provider_authority_is_validated_when_the_edit_changes_it(self, fake_backend):
        with pytest.raises(ApplicationToolError, match="card_provider_selection_incomplete"):
            asyncio.run(saved_card_tools.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
                "updates": {"provider": "openrouter"},
            }, caller_card_id="builder-card"))

        result = asyncio.run(saved_card_tools.card_update_configuration({
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
            "updates": {"provider": "openrouter", "accessMode": "openrouter-api"},
        }, caller_card_id="builder-card"))
        assert result["ok"] is True
        assert result["card"]["runtimeOptions"]["provider"] == "openrouter"
        assert result["card"]["runtimeOptions"]["accessMode"] == "openrouter-api"

    def test_structured_card_configuration_persists_with_revision(self, fake_backend):
        configuration = {"schemaVersion": "trading.card.v1", "trading": {"paperOnly": True}}
        result = asyncio.run(saved_card_tools.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
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
        result = asyncio.run(saved_card_tools.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "updates": {"subsystems": subsystems},
        }, caller_card_id="builder-card"))
        assert result["ok"] is True
        card = next(n for n in fake_backend["deck"]["nodes"] if n["id"] == "signals-card")
        assert card["runtimeOptions"]["subsystems"] == subsystems

    def test_builder_chooses_updates_without_prefilled_packet(self, fake_backend):
        updates = {"prompt": "Chosen after inspection", "title": "New title",
                   "tools": ["web_search", "canvas.inspect"],
                   "skills": ["hermes-agent"], "toolsets": ["file"]}
        result = asyncio.run(saved_card_tools.card_update_configuration({
            "projectId": "p", "deckId": "d", "cardId": "signals-card",
            "expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
            "updates": updates,
        }, caller_card_id="builder-card"))
        assert result["deckRevision"] == "rev2"
        assert result["card"]["prompt"] == updates["prompt"]
        assert result["card"]["runtime"] == DECK["nodes"][0]["runtime"]
        for key in ("tools", "skills", "toolsets"):
            assert result["card"]["runtimeOptions"][key] == updates[key]
        assert fake_backend["deck"]["nodes"][1:] == DECK["nodes"][1:]
        assert fake_backend["deck"]["edges"] == DECK["edges"]

    def test_tools_update_must_be_string_list(self, fake_backend):
        with pytest.raises(ApplicationToolError, match="card_update_tools_must_be_string_list"):
            asyncio.run(saved_card_tools.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "updates": {"tools": [{"name": "shell"}]},
            }, caller_card_id="builder-card"))

    def test_tools_update_rejects_unclassified_and_accepts_explicit_read_or_write(self, fake_backend):
        with pytest.raises(
            ApplicationToolError,
            match="card_update_tool_unavailable:unclassified_read",
        ):
            asyncio.run(saved_card_tools.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "updates": {"tools": ["unclassified_read"]},
            }, caller_card_id="builder-card"))

        result = asyncio.run(saved_card_tools.card_update_configuration({"expectedRevision": "rev1", "expectedCardRevisionId": "revision:signals-card",
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
        with pytest.raises(ApplicationToolError, match=error):
            asyncio.run(saved_card_tools.card_update_configuration({
                "projectId": "p", "deckId": "d", "cardId": "signals-card",
                "expectedRevision": deck_rev, "expectedCardRevisionId": card_rev,
                "updates": {"prompt": "new prompt"},
            }, caller_card_id="builder-card"))
        assert fake_backend == {}


class TestUpsertWire:
    def test_only_supported_wire_types(self, fake_backend):
        with pytest.raises(ApplicationToolError, match="wire_edge_type_unsupported"):
            asyncio.run(saved_canvas_tools.canvas_upsert_wire({
                "projectId": "p", "deckId": "d", "op": "upsert",
                "wire": {"source": "worker", "target": "signals-card", "edgeType": "auto_run"},
            }))

    def test_wire_endpoints_must_exist_in_saved_deck(self, fake_backend):
        with pytest.raises(ApplicationToolError, match="wire_endpoints_not_in_deck"):
            asyncio.run(saved_canvas_tools.canvas_upsert_wire({
                "projectId": "p", "deckId": "d", "op": "upsert",
                "wire": {"source": "ghost", "target": "signals-card", "edgeType": "flow"},
            }))

    def test_magentic_option_upsert_persists(self, fake_backend, monkeypatch):
        import copy
        deck = copy.deepcopy(DECK)
        # This case exercises a clean blue membership edit; the shared fixture's
        # unrelated legacy worker-to-worker flow is not a valid Main assignment.
        deck['edges'] = []
        deck['nodes'].append({
            'id': 'mag',
            'runtime': {'kind': 'hermes', 'mode': 'magentic_one', 'profile': 'mag'},
        })
        monkeypatch.setattr(saved_canvas_tools, 'load_saved_deck', lambda *_: (deck, 'rev1'))
        result = asyncio.run(saved_canvas_tools.canvas_upsert_wire({
            "projectId": "p", "deckId": "d", "op": "upsert",
            "wire": {"source": "worker", "target": "mag", "edgeType": "magentic_option"},
        }))
        assert result["ok"] is True
        edges = fake_backend["deck"]["edges"]
        assert any(e["edgeType"] == "magentic_option" for e in edges)

    def test_wire_upsert_keeps_orange_and_blue_independent_but_refuses_two_orange_masters(self, monkeypatch):
        import copy

        main = {
            'id': 'main', 'kind': 'agent', 'title': 'Main',
            'runtime': {'kind': 'hermes', 'mode': 'main', 'profile': 'main'},
            'runtimeOptions': {},
        }
        main_two = {
            'id': 'main-two', 'kind': 'agent', 'title': 'MainTwo',
            'runtime': {'kind': 'hermes', 'mode': 'main', 'profile': 'main-two'},
            'runtimeOptions': {},
        }
        team = {
            'id': 'card_team', 'kind': 'agent', 'title': 'Team',
            'runtime': {'kind': 'hermes', 'mode': 'delegate', 'profile': 'team'},
            'runtimeOptions': {},
        }
        magnetic = {
            'id': 'magnetic', 'kind': 'agent', 'title': 'Magnetic',
            'runtime': {'kind': 'hermes', 'mode': 'magentic_one', 'profile': 'magnetic'},
            'runtimeOptions': {},
        }
        blue = {
            'id': 'team-master', 'source': 'card_team', 'target': 'magnetic',
            'edgeType': 'magentic_option',
        }
        deck = {'nodes': [main, main_two, team, magnetic], 'edges': [blue]}
        saved = []
        monkeypatch.setattr(saved_canvas_tools, 'load_saved_deck', lambda *_: (copy.deepcopy(deck), 'rev1'))
        monkeypatch.setattr(saved_canvas_tools, 'save_saved_deck', lambda *_args: saved.append(copy.deepcopy(_args[2])))

        result = asyncio.run(saved_canvas_tools.canvas_upsert_wire({
            'projectId': 'p', 'deckId': 'd', 'op': 'upsert',
            'wire': {
                'id': 'orange-master', 'source': 'main', 'target': 'card_team',
                'edgeType': 'flow',
            },
        }))
        assert result['ok'] is True
        assert {edge['edgeType'] for edge in saved[-1]['edges']} == {'flow', 'magentic_option'}

        deck = copy.deepcopy(saved[-1])
        with pytest.raises(ApplicationToolError, match='card_master_conflict:card_team'):
            asyncio.run(saved_canvas_tools.canvas_upsert_wire({
                'projectId': 'p', 'deckId': 'd', 'op': 'upsert',
                'wire': {
                    'id': 'second-orange-master', 'source': 'main-two', 'target': 'card_team',
                    'edgeType': 'flow',
                },
            }))

        deck = {'nodes': [main, main_two, team, magnetic], 'edges': [blue]}
        saved.clear()
        result = asyncio.run(saved_canvas_tools.canvas_upsert_wire({
            'projectId': 'p', 'deckId': 'd', 'op': 'upsert',
            'wire': {
                'id': 'team-master', 'source': 'main', 'target': 'card_team',
                'edgeType': 'flow',
            },
        }))
        assert result['ok'] is True
        assert saved[-1]['edges'] == [{
            'id': 'team-master', 'source': 'main', 'target': 'card_team',
            'edgeType': 'flow',
        }]

    @pytest.mark.parametrize('edge_type', ['flow', 'magentic_option'])
    def test_wire_round_trip_and_identical_upsert_preserve_every_field(self, monkeypatch, edge_type):
        import copy
        from app.python_models import agentgraph_query, agentgraph_topology
        source = {'id': 'source', 'title': 'Source', 'kind': 'agent', 'runtime': {'kind': 'hermes', 'mode': 'main', 'profile': 'source'},
                  'runtimeOptions': {'tools': ['canvas.inspect']}}
        target = {'id': 'target', 'title': 'Target', 'kind': 'agent', 'runtime': {'kind': 'hermes', 'mode': 'delegate', 'profile': 'target'},
                  'runtimeOptions': {}}
        if edge_type != 'flow':
            target['runtime'] = {
                'kind': 'hermes', 'mode': 'magentic_one', 'profile': 'target',
            }
        deck = {'nodes': [source, target], 'edges': []}
        cards_before = copy.deepcopy(deck['nodes'])
        saves = []
        monkeypatch.setattr(saved_canvas_tools, 'load_saved_deck', lambda *_: (copy.deepcopy(deck), 'rev1'))
        def save(_project, _deck_id, value, _revision):
            saves.append(copy.deepcopy(value))
            deck.update(value)
        monkeypatch.setattr(saved_canvas_tools, 'save_saved_deck', save)
        wire = {'id': 'wire', 'source': 'source', 'target': 'target', 'sourceHandle': 'out',
                'targetHandle': 'in', 'edgeType': edge_type, 'enabled': False, 'label': 'Saved label',
                'style': {'strokeWidth': 2}}
        args = {'projectId': 'p', 'deckId': 'd', 'op': 'upsert', 'wire': wire}
        assert asyncio.run(saved_canvas_tools.canvas_upsert_wire(args))['ok']
        assert deck['edges'] == [wire]
        # An abbreviated update retains saved fields and performs no write when unchanged.
        args['wire'] = {key: wire[key] for key in ('id', 'source', 'target')}
        assert asyncio.run(saved_canvas_tools.canvas_upsert_wire(args))['ok']
        assert len(saves) == 1
        if edge_type != 'flow':
            # Reversing only serialization keeps each port on its original Card and is a no-op.
            args['wire'] = {'id': wire['id'], 'source': wire['target'], 'target': wire['source']}
            assert asyncio.run(saved_canvas_tools.canvas_upsert_wire(args))['ok']
            assert len(saves) == 1
            assert deck['edges'] == [wire]
        assert asyncio.run(saved_canvas_tools.canvas_inspect({'projectId': 'p', 'deckId': 'd'}))['wires'] == [wire]
        core = agentgraph_topology.parse_card_edge(wire)
        properties = {**core, 'edgeId': core['id'], 'ordinal': 0}
        monkeypatch.setattr(agentgraph_query, 'execute_fixed_agentgraph_query', lambda _cursor, query, *_:
                            [{'source': wire['source'], 'target': wire['target'], 'properties': properties}]
                            if ':' + agentgraph_topology._edge_labels()[edge_type] + ']' in query else [])
        assert agentgraph_topology._load_age_edges(None, 'p', 'd') == [wire]
        assert deck['nodes'] == cards_before

    def test_blue_reverse_duplicates_and_invalid_endpoint_pairs(self, monkeypatch):
        deck = {'nodes': [
                    {'id': 'a', 'runtime': {'kind': 'hermes', 'mode': 'delegate', 'profile': 'a'}},
                    {'id': 'b', 'runtime': {'kind': 'hermes', 'mode': 'delegate', 'profile': 'b'}},
                    {'id': 'mag', 'runtime': {
                        'kind': 'hermes', 'mode': 'magentic_one', 'profile': 'mag',
                    }},
                    {'id': 'other-mag', 'runtime': {
                        'kind': 'hermes', 'mode': 'magentic_one', 'profile': 'other-mag',
                    }},
                ],
                'edges': [{'id': 'existing', 'source': 'a', 'target': 'mag', 'edgeType': 'magentic_option'}]}
        monkeypatch.setattr(saved_canvas_tools, 'load_saved_deck', lambda *_: (deck, 'rev1'))
        monkeypatch.setattr(saved_canvas_tools, 'save_saved_deck', lambda *_: pytest.fail('Rejected wires must not save or execute'))
        for source, target, reason in [('mag', 'a', 'duplicate'), ('a', 'b', 'endpoint_required'),
                                       ('mag', 'other-mag', 'endpoint_required')]:
            with pytest.raises(ApplicationToolError, match=reason):
                asyncio.run(saved_canvas_tools.canvas_upsert_wire({'projectId': 'p', 'deckId': 'd', 'op': 'upsert',
                    'wire': {'id': 'new', 'source': source, 'target': target, 'edgeType': 'magentic_option'}}))


@pytest.mark.parametrize("profile", ["../escape", "has space", "Upper", "root", "a" * 65])
def test_card_create_rejects_invalid_hermes_profile_names(fake_backend, profile):
    with pytest.raises(ApplicationToolError, match="card_create_profile_invalid"):
        asyncio.run(saved_card_tools.card_create(create_args(runtime={"kind": "hermes", "mode": "delegate", "profile": profile}), caller_card_id="builder-card"))
    assert fake_backend == {}


def test_selected_card_inspection_contains_full_configuration_and_revisions(fake_backend):
    result = asyncio.run(saved_canvas_tools.canvas_inspect({"projectId": "p", "deckId": "d", "cardId": "signals-card"}))
    assert result["selectedCard"] == DECK["nodes"][0]
    assert result["deckRevision"] == "rev1"
    assert result["selectedCard"]["_cardRevisionId"] == "revision:signals-card"
    assert fake_backend == {}
