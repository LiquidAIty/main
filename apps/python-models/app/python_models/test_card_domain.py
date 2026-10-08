from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from app.python_models import card_domain


@pytest.fixture(autouse=True)
def project_worldview_defaults_to_existing_availability(monkeypatch):
    """Keep unrelated Card tests focused; dedicated tests override the mask."""

    def resolve(project_id, candidate_capability_ids, **_kwargs):
        candidates = list(dict.fromkeys(candidate_capability_ids))
        return {
            "schemaVersion": "project-worldview.v1",
            "projectId": project_id,
            "defaultEnabled": True,
            "candidateCapabilities": candidates,
            "enabledCapabilities": candidates,
            "excludedCapabilities": [],
            "overrides": [],
        }

    monkeypatch.setattr(card_domain, "resolve_project_worldview", resolve)


@pytest.mark.parametrize("conversation_matches", [True, False])
def test_scoped_run_read_checks_provider_conversation_before_output(monkeypatch, conversation_matches):
    from unittest.mock import MagicMock

    connection = MagicMock()
    cursor = connection.__enter__.return_value.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = {"run_id": "parent", "project_id": "p", "deck_id": "d",
                                   "card_id": "main", "final_result": "private output"}
    monkeypatch.setattr(card_domain, "connect_postgres", lambda **kwargs: connection)
    monkeypatch.setattr(card_domain, "_resolve_project", lambda *args: {"id": "p"})
    lineage = MagicMock(return_value=[{"run_id": "parent"}] if conversation_matches else [])
    monkeypatch.setattr(card_domain, "_age_rows", lineage)
    result = card_domain.read_run({"projectId": "p", "deckId": "d", "runId": "parent",
                                   "conversationId": "selected-conversation"})
    if conversation_matches:
        assert result["run"]["conversationId"] == "selected-conversation"
        assert result["run"]["result"] == "private output"
    else:
        assert result == {"ok": True, "run": None}
    assert lineage.call_args.args[2] == {"projectId": "p", "deckId": "d",
                                         "runId": "parent", "conversationId": "selected-conversation"}

def test_run_history_is_bounded_to_saved_card_roots(monkeypatch):
    from unittest.mock import MagicMock

    connection = MagicMock()
    cursor = connection.__enter__.return_value.cursor.return_value.__enter__.return_value
    cursor.fetchall.return_value = [
        {
            "run_id": "run-new",
            "project_id": "project-one",
            "deck_id": "deck-one",
            "card_id": "card-one",
            "state": "failed",
        },
        {
            "run_id": "run-old",
            "project_id": "project-one",
            "deck_id": "deck-one",
            "card_id": "card-one",
            "state": "completed",
        },
    ]
    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: connection)
    monkeypatch.setattr(card_domain, "_resolve_project", lambda *_args: {"id": "project-one"})
    monkeypatch.setattr(card_domain, "_age_rows", lambda *_args: [{"run_id": "child-one"}])

    result = card_domain.read_run_history({
        "projectId": "project-one",
        "deckId": "deck-one",
        "cardId": "card-one",
        "limit": 2,
    })

    assert [run["runId"] for run in result["runs"]] == ["run-new", "run-old"]
    query, params = cursor.execute.call_args_list[-1].args
    assert "revision.card_id=%s" in query
    assert "NOT (run.run_id = ANY(%s::text[]))" in query
    assert "ORDER BY run.created_at DESC" in query
    assert params == ("project-one", "deck-one", "card-one", ["child-one"], 2)


@pytest.mark.parametrize("limit", [0, 21, True, "8"])
def test_run_history_rejects_unbounded_limits(monkeypatch, limit):
    with pytest.raises(card_domain.CardDomainError, match="run_history_limit_invalid"):
        card_domain.read_run_history({
            "projectId": "project-one",
            "deckId": "deck-one",
            "cardId": "card-one",
            "limit": limit,
        })


def _agent(card_id: str, **overrides):
    card = {
        "id": card_id,
        "kind": "agent",
        "templateId": "template_assist",
        "title": card_id,
        "prompt": "common prompt",
        "runtime": {"kind": "hermes", "mode": "delegate", "profile": card_id},
        "runtimeOptions": {
            "provider": "openrouter",
            "modelKey": "deepseek/deepseek-v4-flash-0731",
            "providerModelId": "deepseek/deepseek-v4-flash-0731",
            "accessMode": "openrouter-api",
            "tools": [],
        },
        "position": {"x": 0, "y": 0},
    }
    card.update(overrides)
    return card


def _main_bot(card_id: str, **overrides):
    return _agent(card_id, **overrides)


_REMOVED_PROFILE_TARGET_PROJECTION = "delegation" + "Targets"


def _external_tool(name: str, *, read_only: bool) -> dict:
    namespace, provider_name = name.split(".", 1)
    input_schema = {"type": "object", "properties": {}}
    return {
        "name": name,
        "providerToolName": provider_name,
        "kind": "tool",
        "sourceId": namespace,
        "namespace": namespace,
        "connectionKind": "external-mcp",
        "publication": "external-mcp",
        "access": "read" if read_only else "write",
        "title": name,
        "description": f"Provider contract for {name}.",
        "inputSchema": input_schema,
        "canonicalInputSchema": input_schema,
        "serverInjectedArguments": [],
        "dispatcherContextArguments": [],
        "dispatcherOwner": (
            "app.mcp_host._call_graphiti"
            if namespace == "graphiti" else "app.mcp_host._call_cbm"
        ),
        "authenticatedProjection": True,
        "annotations": {
            "readOnlyHint": read_only,
            "destructiveHint": False,
            "idempotentHint": read_only,
            "openWorldHint": True,
        },
        "grantEligible": True,
        "available": True,
    }


def _expected_bot_target(card_id: str = "child") -> dict:
    return {
        "cardId": card_id,
        "title": card_id,
        "profile": "helper",
        "description": "",
        "cardRevisionId": "revision-2" if card_id == "child" else "revision-2",
    }




def test_saved_profiles_stay_unique_and_stable_grants_are_preserved():
    controller = _agent("main", runtime={"kind": "hermes", "mode": "main", "profile": "main"})
    stable = card_domain._stable_card(controller)
    assert stable["grants"]["tools"] == controller["runtimeOptions"]["tools"]
    duplicate = _agent("separate", runtime={"kind": "hermes", "mode": "delegate", "profile": "MAIN"})
    with pytest.raises(card_domain.CardDomainError, match="card_profile_duplicate"):
        card_domain._validated_deck_collections({
            "id": "d", "nodes": [controller, duplicate], "edges": [], "promptTemplates": [],
        }, "d")


def test_one_tools_list_preserves_stored_tool_owners() -> None:
    grants = {
        "tools": ["card.create", "hermes:tool:memory"],
        "skills": [],
        "toolsets": [],
        "mcpConnectionIds": [],
    }

    assert card_domain.GRANT_FIELDS["tool"] == "tools"
    assert card_domain.GRANT_FIELDS["hermes_tool"] == "tools"
    assert card_domain._grant_ids_for_kind(grants, "tool", "tools") == ["card.create"]
    assert card_domain._grant_ids_for_kind(
        grants, "hermes_tool", "tools",
    ) == ["hermes:tool:memory"]


def test_existing_saved_hermes_card_profile_is_immutable() -> None:
    previous = card_domain._stable_card(_agent(
        "helper",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "stable-helper"},
    ))
    incoming = card_domain._stable_card(_agent(
        "helper",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "renamed-helper"},
    ))

    with pytest.raises(card_domain.CardDomainError, match="card_runtime_profile_immutable"):
        card_domain._validate_immutable_runtime_profile(previous, incoming)


def test_global_profile_binding_locks_sorted_before_collision_read() -> None:
    calls: list[tuple[str, object]] = []

    class Cursor:
        def execute(self, query, params=None):
            calls.append((str(query), params))

        def fetchone(self):
            return {"card_id": "already-bound"}

    cards = [
        _agent("z-card", runtime={"kind": "hermes", "mode": "delegate", "profile": "zeta"}),
        _agent("a-card", runtime={"kind": "hermes", "mode": "delegate", "profile": "Alpha"}),
    ]

    with pytest.raises(card_domain.CardDomainError, match="card_profile_duplicate:alpha"):
        card_domain._lock_and_validate_hermes_profile_bindings(Cursor(), cards)

    assert [params for query, params in calls if "pg_advisory_xact_lock" in query] == [
        ("card-profile:alpha",),
        ("card-profile:zeta",),
    ]
    first_binding_read = next(
        index for index, (query, _params) in enumerate(calls)
        if "FROM ag_catalog.agent_card_revisions" in query
    )
    assert first_binding_read == 2


def test_global_profile_binding_allows_same_card_identity_in_another_project() -> None:
    calls: list[tuple[str, object]] = []

    class Cursor:
        def execute(self, query, params=None):
            calls.append((str(query), params))

        def fetchone(self):
            return None

    card_domain._lock_and_validate_hermes_profile_bindings(
        Cursor(),
        [_agent(
            "shared-card",
            runtime={"kind": "hermes", "mode": "delegate", "profile": "shared-profile"},
        )],
    )

    query, params = calls[1]
    assert "LOWER(runtime_profile)=%s" in query
    assert "card_id<>%s" in query
    assert params == ("shared-profile", "shared-card")


def test_save_deck_rejects_new_card_using_globally_bound_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, object]] = []

    class Cursor:
        last_query = ""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            self.last_query = str(query)
            calls.append((self.last_query, params))

        def fetchone(self):
            if "SELECT 1 FROM ag_catalog.agent_decks" in self.last_query:
                return {"exists": 1}
            if "LOWER(runtime_profile)=%s" in self.last_query:
                return {"card_id": "existing-card"}
            return None

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_resolve_project", lambda *_args: {"id": "new-project"})
    document = {
        "id": "new-deck",
        "name": "New Deck",
        "version": 1,
        "nodes": [_agent(
            "new-card",
            runtime={"kind": "hermes", "mode": "delegate", "profile": "taken-profile"},
        )],
        "edges": [],
        "promptTemplates": [],
    }

    with pytest.raises(
        card_domain.CardDomainError,
        match="card_profile_duplicate:taken-profile",
    ):
        card_domain.save_deck("new-project", "new-deck", document, expected_revision=None)

    profile_lock_index = next(
        index for index, (query, _params) in enumerate(calls)
        if "pg_advisory_xact_lock" in query
    )
    profile_binding_read_index = next(
        index for index, (query, _params) in enumerate(calls)
        if "LOWER(runtime_profile)=%s" in query
    )
    assert profile_lock_index < profile_binding_read_index
    assert not any("FOR UPDATE" in query for query, _params in calls)
    assert not any("INSERT INTO ag_catalog.agent_cards" in query for query, _params in calls)


def test_one_flow_connection_grants_only_outbound_main_bot_authority():
    cards = [
        _main_bot('main', runtime={"kind": "hermes", "mode": "main", "profile": "main"}),
        _agent('helper', runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"}),
    ]
    cards.append(_agent(
        'mag', runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag"}
    ))
    edges = [{'id': key, 'source': source, 'target': target, 'edgeType': kind}
             for key, source, target, kind in [('connected', 'main', 'helper', 'flow')]]
    card_domain._validate_changed_flow_edges(cards, edges)
    card_domain._validate_changed_flow_edges(cards, edges)
    indexed = {card['id']: card for card in cards}
    assert [target['cardId'] for target in card_domain._direct_card_targets('main', indexed, edges)] == ['helper']
    assert card_domain._direct_card_targets('helper', indexed, edges) == []
    with pytest.raises(card_domain.CardDomainError, match='card_connection_controller_required:reverse'):
        card_domain._validate_changed_flow_edges(cards, [{
            'id': 'reverse', 'source': 'helper', 'target': 'main', 'edgeType': 'flow',
        }])


def test_one_card_can_be_an_independent_main_target_and_magnetic_worker():
    main = _main_bot(
        "main", runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    magnetic = _agent(
        "magnetic",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "magnetic"},
    )
    team = _agent(
        "card_team", runtime={"kind": "hermes", "mode": "delegate", "profile": "team"},
    )
    orange = {"id": "orange", "source": "main", "target": "card_team", "edgeType": "flow"}
    blue = {
        "id": "blue", "source": "card_team", "target": "magnetic",
        "edgeType": "magentic_option",
    }

    card_domain._validate_changed_flow_edges([main, magnetic, team], [orange])
    card_domain._validate_changed_flow_edges([main, magnetic, team], [blue])
    card_domain._validate_changed_flow_edges(
        [main, magnetic, team], [orange, blue],
    )
    indexed = {card["id"]: card for card in (main, magnetic, team)}
    assert [target["cardId"] for target in card_domain._direct_card_targets(
        "main", indexed, [orange, blue],
    )] == ["card_team"]
    assert [target["cardId"] for target in card_domain._connected_hermes_card_targets(
        "magnetic", indexed, [orange, blue], edge_type="magentic_option", strict=False,
    )] == ["card_team"]


def test_team_worker_projection_uses_stable_identity_and_saved_parent_model():
    magnetic = _agent(
        "magnetic",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "magnetic"},
    )
    team = _agent(
        "card_team",
        title="Renamed",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "team"},
    )
    team["runtimeOptions"].update({
        "provider": "openai",
        "accessMode": "chatgpt-account",
        "modelKey": "gpt-5.6-sol",
        "providerModelId": "gpt-5.6-sol",
        "reasoningEffort": "high",
    })
    for card in (magnetic, team):
        card["_cardRevisionId"] = f"revision-{card['id']}"
    cards = {card["id"]: card for card in (magnetic, team)}

    assert card_domain._connected_hermes_card_targets(
        "magnetic",
        cards,
        [{"source": "card_team", "target": "magnetic", "edgeType": "magentic_option"}],
        edge_type="magentic_option",
        strict=True,
    ) == [{
        "cardId": "card_team",
        "title": "Renamed",
        "profile": "team",
        "description": "",
        "cardRevisionId": "revision-card_team",
        "teamTaskMode": True,
        "provider": {
            "provider": "openai",
            "accessMode": "chatgpt-account",
            "modelKey": "gpt-5.6-sol",
            "providerModelId": "gpt-5.6-sol",
        },
        "runtimeOptions": {
            "modelKey": "gpt-5.6-sol",
            "providerModelId": "gpt-5.6-sol",
            "reasoningEffort": "high",
        },
    }]


def test_saved_orchestrator_flag_grants_non_main_outbound_bot_authority():
    main = _main_bot(
        "main", runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    signal = _agent(
        "signal", runtime={"kind": "hermes", "mode": "delegate", "profile": "signal"},
    )
    signal["runtimeOptions"]["orchestrator"] = True
    worldsignals = _agent(
        "worldsignals",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "worldsignals"},
    )
    cards = [main, signal, worldsignals]
    edges = [
        {"id": "main-signal", "source": "main", "target": "signal", "edgeType": "flow"},
        {"id": "signal-world", "source": "signal", "target": "worldsignals", "edgeType": "flow"},
    ]

    card_domain._validate_changed_flow_edges(cards, edges)
    indexed = {card["id"]: card for card in cards}
    assert [target["cardId"] for target in card_domain._direct_card_targets(
        "main", indexed, edges,
    )] == ["signal"]
    assert [target["cardId"] for target in card_domain._direct_card_targets(
        "signal", indexed, edges,
    )] == ["worldsignals"]


def test_new_card_revision_validates_saved_orchestrator_authority():
    delegate = _agent(
        "delegate",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "delegate"},
    )
    delegate["runtimeOptions"]["orchestrator"] = True
    card_domain._validate_new_card_revision(delegate)

    delegate["runtimeOptions"]["orchestrator"] = "yes"
    with pytest.raises(card_domain.CardDomainError, match="card_orchestrator_invalid"):
        card_domain._validate_new_card_revision(delegate)

    magnetic = _agent(
        "magnetic",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "magnetic"},
    )
    magnetic["runtimeOptions"]["orchestrator"] = True
    with pytest.raises(
        card_domain.CardDomainError,
        match="card_orchestrator_requires_non_magnetic_hermes",
    ):
        card_domain._validate_new_card_revision(magnetic)


def test_magnetic_cannot_gain_outbound_orange_bot_authority():
    magnetic = _agent(
        "magnetic",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "magnetic"},
    )
    magnetic["runtimeOptions"]["orchestrator"] = True
    helper = _agent("helper")
    with pytest.raises(
        card_domain.CardDomainError,
        match="card_connection_controller_required:magnetic-helper",
    ):
        card_domain._validate_changed_flow_edges(
            [magnetic, helper],
            [{"id": "magnetic-helper", "source": "magnetic", "target": "helper",
              "edgeType": "flow"}],
        )


def test_delegate_orchestrator_can_remain_a_blue_worker_with_an_outbound_orange_roster():
    main = _main_bot(
        "main", runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    worldview = _agent(
        "worldview",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "worldview"},
    )
    worldview["runtimeOptions"]["orchestrator"] = True
    worldsignals = _agent(
        "worldsignals",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "worldsignals"},
    )
    magnetic = _agent(
        "magnetic",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "magnetic"},
    )
    cards = [main, worldview, worldsignals, magnetic]
    edges = [
        {"id": "main-worldview", "source": "main", "target": "worldview", "edgeType": "flow"},
        {"id": "worldview-signals", "source": "worldview", "target": "worldsignals", "edgeType": "flow"},
        {"id": "worldview-magnetic", "source": "worldview", "target": "magnetic",
         "edgeType": "magentic_option"},
    ]

    card_domain._validate_changed_flow_edges(cards, edges)
    assert card_domain._is_callable_magentic_worker_card(worldview) is True
    indexed = {card["id"]: card for card in cards}
    assert [target["cardId"] for target in card_domain._direct_card_targets(
        "main", indexed, edges,
    )] == ["worldview"]
    assert [target["cardId"] for target in card_domain._direct_card_targets(
        "worldview", indexed, edges,
    )] == ["worldsignals"]


def test_wire_blue_save_identity_is_unordered_and_preserves_endpoint_handles():
    cards = [
        _agent('a'),
        _agent('b'),
        _agent('mag', runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag"}),
    ]
    forward = {'id': 'one', 'source': 'a', 'target': 'mag', 'sourceHandle': 'out',
               'targetHandle': 'bus-in-1', 'edgeType': 'magentic_option', 'enabled': True}
    reverse = {**forward, 'id': 'two', 'source': 'mag', 'target': 'a',
               'sourceHandle': 'bus-in-1', 'targetHandle': 'out'}
    document = {'id': 'd', 'nodes': cards, 'edges': [reverse], 'promptTemplates': []}
    assert card_domain._validated_deck_collections(document, 'd')[1] == [reverse]
    document['edges'] = [forward, reverse]
    with pytest.raises(card_domain.CardDomainError, match='edge_connection_duplicate'):
        card_domain._validated_deck_collections(document, 'd')
    document['edges'] = [forward, {**reverse, 'target': 'b'}]
    assert len(card_domain._validated_deck_collections(document, 'd')[1]) == 2
    for source, target in [('a', 'b'), ('mag', 'mag')]:
        document['edges'] = [{**forward, 'source': source, 'target': target}]
        with pytest.raises(card_domain.CardDomainError, match='magentic_endpoint_required'):
            card_domain._validated_deck_collections(document, 'd')


def test_flow_endpoints_require_unique_exact_one_word_public_addresses():
    main = _main_bot(
        'main', title='Main',
        runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    helper = _agent('helper', title='KnowGraph')
    magnetic = _agent(
        'magnetic',
        title='Magnetic',
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "magnetic"},
    )
    worker = _agent('worker', title='Trading Agent')
    document = {
        'id': 'd',
        'nodes': [main, helper, magnetic, worker],
        'edges': [
            {'id': 'orange', 'source': 'main', 'target': 'helper', 'edgeType': 'flow'},
            {'id': 'blue', 'source': 'magnetic', 'target': 'worker', 'edgeType': 'magentic_option'},
        ],
        'promptTemplates': [],
    }
    card_domain._validated_deck_collections(document, 'd')
    card_domain._validate_changed_flow_edges(document['nodes'], document['edges'])

    helper['title'] = 'Graph Agent'
    with pytest.raises(card_domain.CardDomainError, match='card_address_invalid:helper'):
        card_domain._validate_changed_flow_edges(document['nodes'], document['edges'])

    helper['title'] = 'MAIN'
    with pytest.raises(card_domain.CardDomainError, match='card_address_duplicate:main'):
        card_domain._validate_changed_flow_edges(document['nodes'], document['edges'])


def test_flow_creation_reconnection_and_main_bot_authority(monkeypatch):
    controller = _main_bot("main", runtime={"kind": "hermes", "mode": "main", "profile": "main"})
    receivers = [_agent(name, runtime={"kind": "hermes", "mode": "delegate", "profile": name})
                 for name in ("builder", "graph", "disconnected")]
    nodes = [controller, *receivers]
    for card in nodes:
        card.update(_cardRevisionId=card["id"] + "-revision", _cardRevision=1, _cardRevisionSha256="sha")
    edges = [{"id": name, "source": "main", "target": name, "edgeType": "flow"}
             for name in ("builder", "graph")]
    cards = {card["id"]: card for card in nodes}
    before = json.dumps(nodes, sort_keys=True)
    card_domain._validate_changed_flow_edges(nodes, edges)
    assert [target["cardId"] for target in card_domain._direct_card_targets("main", cards, edges)] == ["builder", "graph"]
    assert card_domain._direct_card_targets("builder", cards, edges) == []
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_: {
        "projectId": "p", "deck": {"nodes": nodes, "edges": edges},
    })
    received = card_domain._prepare_invocation({
        "projectId": "p", "deckId": "d", "cardId": "builder", "senderCardId": "main", "assignment": "Inspect",
    })
    assert received["_callConfig"]["runtime"] == receivers[0]["runtime"]
    assert received["_callConfig"]["systemPrompt"] == receivers[0]["prompt"]
    assert received["_callConfig"]["provider"]["modelKey"] == receivers[0]["runtimeOptions"]["modelKey"]
    assert json.dumps(nodes, sort_keys=True) == before
    for mutation in ({"source": "builder"}, {"target": "main"}):
        invalid = [{**edges[0], **mutation}]
        with pytest.raises(card_domain.CardDomainError, match="controller_required"):
            card_domain._validate_changed_flow_edges(nodes, invalid)
    assert [target["cardId"] for target in card_domain._direct_card_targets("main", cards, edges)] == [
        "builder", "graph",
    ]
    card_domain._validate_changed_flow_edges(nodes, edges)
    assert len(edges) == 2
    assert list(cards) == ["main", "builder", "graph", "disconnected"]
    assert card_domain._prepare_invocation({
        "projectId": "p", "deckId": "d", "cardId": "builder", "senderCardId": "main", "assignment": "Allowed",
    })["cardIdentity"]["cardId"] == "builder"
    with pytest.raises(card_domain.CardDomainError, match="card_invocation_edge_authority_required"):
        card_domain._prepare_invocation({
            "projectId": "p", "deckId": "d", "cardId": "main",
            "senderCardId": "builder", "assignment": "Reverse is not authorized",
        })


def test_no_script_preserves_saved_presentation_without_narrowing_effective_grants(
    monkeypatch,
):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"].update(
        tools=["canvas.inspect", "graphiti.search_nodes"],
        mcpConnectionIds=["graphiti"],
    )
    before = json.dumps(card, sort_keys=True)
    payload = _destination_payload("hermes")
    payload["discoveredTools"] = [
        _external_tool("graphiti.search_nodes", read_only=True),
    ]
    prepared = card_domain._prepare_invocation(payload)
    config = prepared["_callConfig"]
    assert config["presentedTools"] == card["runtimeOptions"]["tools"]
    assert set(config["presentedTools"]) <= set(config["enabledTools"])
    assert "web_search" not in config["enabledTools"]
    assert json.dumps(card, sort_keys=True) == before


def test_published_catalog_failure_keeps_the_model_turn_and_surfaces_the_error(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"]["tools"] = ["canvas.inspect"]
    payload = _destination_payload("hermes")
    payload["discoveredToolFailures"] = {
        "canvas.inspect": "tool_catalog_definition_invalid:canvas.inspect",
    }

    prepared = card_domain._prepare_invocation(payload)

    config = prepared["_callConfig"]
    assert config["enabledTools"] == []
    assert config["presentedTools"] == []
    assert config["unavailableTools"] == ["canvas.inspect"]
    assert config["unavailableToolReasons"] == {
        "canvas.inspect": "tool_catalog_definition_invalid:canvas.inspect",
    }
    assert config["toolCatalogFailure"] == "tool_catalog_definition_invalid:canvas.inspect"


def test_saved_card_exposes_only_currently_available_enabled_tools(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"].update(
        tools=["canvas.inspect", "graphiti.search_nodes"],
    )
    before = json.dumps(card, sort_keys=True)
    payload = _destination_payload("hermes")
    unavailable = _external_tool("graphiti.search_nodes", read_only=True)
    unavailable.update({
        "title": "Search Graphiti nodes",
        "description": "Search the connected Graphiti knowledge graph.",
        "available": False,
    })
    payload["discoveredTools"] = [unavailable]

    prepared = card_domain._prepare_invocation(payload)
    config = prepared["_callConfig"]
    assert config["enabledTools"] == ["canvas.inspect"]
    assert config["presentedTools"] == ["canvas.inspect"]
    assert config["unavailableTools"] == ["graphiti.search_nodes"]
    assert json.dumps(card, sort_keys=True) == before


def test_valid_enabled_script_is_retained_but_cannot_replace_tools_without_hermes_runner(
    monkeypatch,
):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"]["script"] = {
        "enabled": True,
        "source": '''CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {"type": "object", "properties": {}},
    "output": {"type": "object", "properties": {"result": {}}, "required": ["result"]},
}
from hermes_tools import SCRIPT, output, tools
tools.calculator = SCRIPT
tools.call("calculator")
output.emit({"result": {}})
''',
    }

    invocation = card_domain.materialize_invocation(_destination_payload("hermes"))
    grants = invocation["idf"]["selectedToolsAndGrants"]
    saved = invocation["idf"]["stableSavedCardContext"]["runtimeOptions"]["script"]

    assert grants["enabledTools"] == ["calculator"]
    assert grants["presentedTools"] == ["calculator"]
    assert grants["scriptPresentation"] == {
        "mode": "selected-mcp",
        "fallbackReason": "card_script_hermes_runner_unavailable",
    }
    assert saved["lastValidation"]["status"] == "valid"
    assert saved["hermesSupport"] == {
        "available": False,
        "executor": None,
        "active": False,
        "reason": "card_script_hermes_runner_unavailable",
    }


def test_invalid_enabled_script_falls_back_to_exact_saved_tool_schema(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"]["script"] = {
        "enabled": True,
        "source": "return InvocationPreparation()",
    }

    invocation = card_domain.materialize_invocation(_destination_payload("hermes"))
    grants = invocation["idf"]["selectedToolsAndGrants"]
    saved = invocation["idf"]["stableSavedCardContext"]["runtimeOptions"]["script"]

    assert grants["presentedTools"] == ["calculator"]
    assert grants["scriptPresentation"] == {
        "mode": "selected-mcp",
        "fallbackReason": "card_script_validation_failed",
    }
    assert saved["lastValidation"]["status"] == "invalid"


def test_disabled_script_remains_readable_saved_configuration(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"]["script"] = {
        "enabled": False,
        "source": "not executable",
    }

    stable = card_domain._stable_card(card)
    saved = stable["runtimeExtensions"]["script"]
    assert saved["enabled"] is False
    assert saved["source"] == "not executable"
    assert saved["hermesSupport"]["available"] is False
    assert stable["grants"]["tools"] == ["calculator"]


def test_saved_card_preserves_legacy_team_data_without_runtime_validation() -> None:
    team = {
        "mode": "auto", "maxWorkers": 3, "retryLimit": 2,
        "workerModel": {
            "provider": "openai", "accessMode": "chatgpt-account",
            "modelKey": "gpt-5.6-luna", "providerModelId": "gpt-5.6-luna",
        },
        "leadModel": {
            "provider": "openai", "accessMode": "chatgpt-account",
            "modelKey": "gpt-5.6-terra", "providerModelId": "gpt-5.6-terra",
        },
    }
    hermes = _agent(
        "hermes-team",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "research"},
        runtimeOptions={**_agent("x")["runtimeOptions"], "team": team},
    )
    assert card_domain._stable_card(hermes)["runtimeExtensions"]["team"] == team
    legacy = _agent("old-card", runtimeOptions={**_agent("x")["runtimeOptions"], "team": team})
    assert card_domain._stable_card(legacy)["runtimeExtensions"]["team"] == team


def test_deck_validation_rejects_duplicate_identities_and_missing_endpoints() -> None:
    duplicate = {
        "id": "deck-two",
        "name": "Two",
        "version": 1,
        "nodes": [_agent("same"), _agent("same")],
        "edges": [],
        "promptTemplates": [],
    }
    with pytest.raises(card_domain.CardDomainError, match="card_id_duplicate:same"):
        card_domain._validated_deck_collections(duplicate, "deck-two")

    missing = {
        **duplicate,
        "nodes": [_agent("source")],
        "edges": [{
            "id": "edge-one",
            "source": "source",
            "target": "missing",
            "edgeType": "flow",
        }],
    }
    with pytest.raises(card_domain.CardDomainError, match="edge_endpoint_missing:edge-one"):
        card_domain._validated_deck_collections(missing, "deck-two")


def test_project_code_folder_is_one_portable_managed_folder_name() -> None:
    assert card_domain._validated_project_code_folder("  worker-agent-ui  ") == "worker-agent-ui"
    assert card_domain._validated_project_code_folder(None) is None
    assert card_domain._validated_project_code_folder("  ") is None

    for invalid in (".", "..", "nested/folder", "nested\\folder", "C:\\outside", "/outside", "NUL"):
        with pytest.raises(card_domain.CardDomainError, match="builder_project_code_folder_invalid"):
            card_domain._validated_project_code_folder(invalid)


def test_explicit_card_deletion_requires_intent_and_rejects_protected_cards() -> None:
    with pytest.raises(card_domain.CardDomainError, match="card_deletion_intent_invalid"):
        card_domain.delete_card(
            "project-one", "deck-one", "accidental",
            expected_deck_revision="deck-revision",
            expected_card_revision_id="card-revision",
            deletion_intent="",
        )
    for card_id in (
        "card_main_chat",
        "builder",
        "card_thinkgraph",
        "card_magentic",
        "card_team",
        "card_knowgraph",
    ):
        with pytest.raises(
            card_domain.CardDomainError,
            match=f"card_deletion_protected:{card_id}",
        ):
            card_domain.delete_card(
                "project-one", "deck-one", card_id,
                expected_deck_revision="deck-revision",
                expected_card_revision_id="card-revision",
                deletion_intent="delete-card",
            )


@pytest.mark.parametrize(
    "card_id",
    [
        "accidental",
        "card_helper",
        "card_delegate",
        "card_hermes_steward",
        "card_trading_workbench",
        "card_worldsignals_agent",
    ],
)
def test_explicit_card_removal_detaches_only_project_membership_and_endpoint_edges(
    monkeypatch: pytest.MonkeyPatch,
    card_id: str,
) -> None:
    statements: list[tuple[str, object]] = []
    deleted_edges: list[str] = []
    deleted_cards: list[str] = []

    class Cursor:
        last_query = ""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            self.last_query = str(query)
            statements.append((self.last_query, params))

        def fetchone(self):
            if "SELECT revision" in self.last_query:
                return {"revision": "deck-revision"}
            if "SELECT current_revision_id" in self.last_query:
                return {"current_revision_id": "card-revision"}
            if "SELECT ordinal" in self.last_query:
                return {"ordinal": 6}
            return None

    class Connection:
        committed = False

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

        def commit(self):
            self.committed = True

    connection = Connection()
    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: connection)
    monkeypatch.setattr(card_domain, "_resolve_project", lambda *_args: {"id": "project-one"})
    monkeypatch.setattr(card_domain, "_load_deck_with_cursor", lambda *_args, **_kwargs: {
        "deck": {
            "nodes": [
                {"id": "keep-one", "_cardRevisionId": "keep-revision"},
                {"id": card_id, "_cardRevisionId": "card-revision"},
                {"id": "keep-two", "_cardRevisionId": "keep-revision-two"},
            ],
            "edges": [
                {"id": "edge-in", "source": "keep-one", "target": card_id},
                {"id": "edge-out", "source": card_id, "target": "keep-two"},
                {"id": "edge-keep", "source": "keep-one", "target": "keep-two"},
            ],
        },
    })
    monkeypatch.setattr(card_domain, "_card_has_telemetry_edges", lambda *_args: False)
    monkeypatch.setattr(
        card_domain,
        "_delete_age_edge",
        lambda _cursor, _project, _deck, edge: deleted_edges.append(edge["id"]),
    )
    monkeypatch.setattr(
        card_domain,
        "_delete_age_card",
        lambda _cursor, _project, _deck, card: deleted_cards.append(card),
    )
    monkeypatch.setattr(card_domain, "load_deck", lambda *_args: {
        "deck": {"nodes": [{"id": "keep-one"}, {"id": "keep-two"}], "edges": [{"id": "edge-keep"}]},
        "meta": {"deckRevision": "new-revision"},
    })

    result = card_domain.delete_card(
        "project-one", "deck-one", card_id,
        expected_deck_revision="deck-revision",
        expected_card_revision_id="card-revision",
        deletion_intent="delete-card",
    )

    assert deleted_edges == ["edge-in", "edge-out"]
    assert deleted_cards == [card_id]
    assert connection.committed is True
    assert result["meta"]["deckRevision"] == "new-revision"
    assert not any("agent_assignments" in query for query, _ in statements)
    assert not any("DELETE FROM ag_catalog.agent_card_revisions" in query for query, _ in statements)
    assert not any("DELETE FROM ag_catalog.agent_cards" in query for query, _ in statements)
    assert not any("current_revision_id=NULL" in query for query, _ in statements)
    mutation_params = [params for query, params in statements if "DELETE FROM" in query]
    assert mutation_params == [("project-one", "deck-one", card_id)]


def test_project_card_removal_keeps_age_identity_when_historic_telemetry_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Cursor:
        last_query = ""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, _params=None):
            self.last_query = str(query)

        def fetchone(self):
            if "SELECT revision" in self.last_query:
                return {"revision": "deck-revision"}
            if "SELECT current_revision_id" in self.last_query:
                return {"current_revision_id": "card-revision"}
            if "SELECT ordinal" in self.last_query:
                return {"ordinal": 0}
            return None

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

        def commit(self):
            return None

    deleted_cards: list[str] = []
    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_resolve_project", lambda *_args: {"id": "project-one"})
    monkeypatch.setattr(card_domain, "_load_deck_with_cursor", lambda *_args, **_kwargs: {
        "deck": {
            "nodes": [{"id": "card-helper", "_cardRevisionId": "card-revision"}],
            "edges": [],
        },
    })
    monkeypatch.setattr(card_domain, "_card_has_telemetry_edges", lambda *_args: True)
    monkeypatch.setattr(
        card_domain,
        "_delete_age_card",
        lambda _cursor, _project, _deck, card: deleted_cards.append(card),
    )
    monkeypatch.setattr(card_domain, "load_deck", lambda *_args: {
        "deck": {"nodes": [], "edges": []},
        "meta": {"deckRevision": "next"},
    })

    card_domain.delete_card(
        "project-one", "deck-one", "card-helper",
        expected_deck_revision="deck-revision",
        expected_card_revision_id="card-revision",
        deletion_intent="delete-card",
    )

    assert deleted_cards == []


def test_card_save_advances_every_exact_reused_revision_and_ensures_age_presence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []
    ensured: list[tuple[str, str, str]] = []
    inserted: list[tuple[str, str, str, int]] = []

    class Cursor:
        last_query = ""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            self.last_query = str(query)
            statements.append((self.last_query, params))

        def fetchone(self):
            if "SELECT 1 FROM ag_catalog.agent_decks" in self.last_query:
                return {"exists": 1}
            if "MAX(lineage.revision_number)" in self.last_query:
                return {
                    "project_id": "canonical-project",
                    "deck_id": "canonical-deck",
                    "card_id": "card-helper",
                    "latest_revision_number": 7,
                }
            return None

        def fetchall(self):
            if "RETURNING project_id::text, deck_id" in self.last_query:
                return [
                    {"project_id": "project-one", "deck_id": "deck-one"},
                    {"project_id": "project-two", "deck_id": "deck-two"},
                ]
            return []

    class Connection:
        committed = False

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

        def commit(self):
            self.committed = True

    previous = _agent("card-helper", title="Before")
    previous.update({"_cardRevisionId": "revision-old", "_cardRevision": 4})
    incoming = _agent("card-helper", title="After")
    document = {
        "id": "deck-one",
        "name": "Deck One",
        "version": 3,
        "nodes": [incoming],
        "edges": [],
        "promptTemplates": [],
    }
    connection = Connection()
    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: connection)
    monkeypatch.setattr(card_domain, "_resolve_project", lambda *_args: {"id": "project-one"})
    monkeypatch.setattr(card_domain, "_load_deck_with_cursor", lambda *_args, **_kwargs: {
        "deck": {"nodes": [previous], "edges": []},
        "meta": {"deckRevision": "deck-revision"},
    })
    monkeypatch.setattr(
        card_domain,
        "_ensure_age_card",
        lambda _cursor, project, deck, card: ensured.append((project, deck, card)),
    )

    def insert_revision(_cursor, project, deck, card, revision_number):
        inserted.append((project, deck, card["id"], revision_number))
        return "revision-new"

    monkeypatch.setattr(card_domain, "_insert_revision", insert_revision)
    monkeypatch.setattr(card_domain, "load_deck", lambda *_args: {
        "deck": document,
        "meta": {"deckRevision": "next-deck-revision"},
    })

    result = card_domain.save_deck(
        "project-one",
        "deck-one",
        document,
        expected_revision="deck-revision",
    )

    assert result["meta"]["deckRevision"] == "next-deck-revision"
    assert connection.committed is True
    assert ensured == [("project-one", "deck-one", "card-helper")]
    assert inserted == [("canonical-project", "canonical-deck", "card-helper", 8)]
    profile_lock_index = next(
        index for index, (query, _params) in enumerate(statements)
        if "pg_advisory_xact_lock" in query
    )
    profile_binding_read_index = next(
        index for index, (query, _params) in enumerate(statements)
        if "LOWER(runtime_profile)=%s" in query
    )
    deck_lock_index = next(
        index for index, (query, _params) in enumerate(statements)
        if "agent_decks" in query and "FOR UPDATE" in query
    )
    revision_owner_read_index = next(
        index for index, (query, _params) in enumerate(statements)
        if "MAX(lineage.revision_number)" in query
    )
    revision_update_index = next(
        index for index, (query, _params) in enumerate(statements)
        if "WHERE card_id=%s AND current_revision_id=%s" in query
    )
    assert profile_lock_index < profile_binding_read_index < deck_lock_index
    assert deck_lock_index < revision_owner_read_index
    assert profile_lock_index < revision_update_index
    propagation = next(
        (query, params)
        for query, params in statements
        if "WHERE card_id=%s AND current_revision_id=%s" in query
    )
    assert propagation[1] == ("revision-new", "card-helper", "revision-old")
    assert any(
        params is not None and tuple(params)[-2:] == ("project-two", "deck-two")
        for query, params in statements
        if "UPDATE ag_catalog.agent_decks" in query
    )


def test_card_deletion_telemetry_check_uses_typed_agentgraph_endpoints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[str] = []

    def no_rows(_cursor, query, _params, _column):
        statements.append(query)
        return []

    monkeypatch.setattr(card_domain, "_age_rows", no_rows)

    assert card_domain._card_has_telemetry_edges(
        object(), "project-one", "deck-one", "card-one"
    ) is False
    assert len(statements) == len(card_domain.CARD_TELEMETRY_CARD_EDGE_PATTERNS)
    assert all("->()" not in statement and "MATCH ()-" not in statement for statement in statements)
    assert all(":Run" in statement or ":Card" in statement for statement in statements)


def test_direct_card_targets_allow_saved_hermes_cards_including_magnetic() -> None:
    cards = {
        "parent": _main_bot("parent", runtime={"kind": "hermes", "mode": "main", "profile": "main"},
                            runtimeOptions={"orchestrator": False}),
        "enabled": _agent(
            "enabled",
            runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"},
        ),
        "disabled-option": _agent(
            "disabled-option",
            runtimeOptions={**_agent("x")["runtimeOptions"], "enabled": False},
        ),
        "presentation-attached": _agent(
            "presentation-attached",
            parentGraphId="workbench-trading",
            runtime={"kind": "hermes", "mode": "delegate", "profile": "trading"},
        ),
        "orchestrator": _agent(
            "orchestrator",
            runtime={"kind": "hermes", "mode": "magentic_one", "profile": "orchestrator"},
        ),
    }
    edges = [
        {"source": "parent", "target": "enabled", "edgeType": "flow"},
        {"source": "parent", "target": "disabled-option", "edgeType": "flow"},
        {"source": "parent", "target": "presentation-attached", "edgeType": "flow"},
        {"source": "parent", "target": "orchestrator", "edgeType": "flow"},
        {"source": "enabled", "target": "parent", "edgeType": "flow"},
        {"source": "parent", "target": "enabled", "edgeType": "magentic_option"},
        {"source": "parent", "target": "enabled", "edgeType": "flow", "enabled": False},
    ]
    assert card_domain._direct_card_targets("parent", cards, edges) == [
        {**_expected_bot_target("enabled"), "cardRevisionId": ""},
        {
            "cardId": "presentation-attached",
            "title": "presentation-attached",
            "profile": "trading",
            "description": "",
            "cardRevisionId": "",
        },
        {
            "cardId": "orchestrator",
            "title": "orchestrator",
            "profile": "orchestrator",
            "description": "",
            "cardRevisionId": "",
        },
    ]


def _delegation_invocation(
    monkeypatch: pytest.MonkeyPatch,
    *,
    edges: list[dict[str, object]],
    target: dict | None = None,
    parent_runtime: dict | None = None,
) -> dict:
    parent = _agent("parent", runtime=parent_runtime or {"kind": "hermes", "mode": "main", "profile": "main"})
    parent["runtimeOptions"] = {
        **parent["runtimeOptions"],
        "tools": ["calculator"],
    }
    child = target or _agent(
        "child",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"},
        runtimeOptions={
            **_agent("child")["runtimeOptions"],
            "tools": ["hermes:tool:terminal"],
            "skills": ["repository-helper"],
            "toolsets": ["terminal"],
        },
    )
    for number, card in enumerate((parent, child), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{number}"
    monkeypatch.setattr(
        card_domain,
        "_load_deck_internal",
        lambda _project, _deck: {
            "projectId": "00000000-0000-0000-0000-000000000001",
            "deck": {"nodes": [parent, child], "edges": edges},
        },
    )
    return card_domain.materialize_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-delegation",
        "cardId": "parent",
        "assignment": "delegate only across the saved FLOW relationship",
    })


def test_main_without_selected_graph_data_keeps_the_idf_graph_context_empty(monkeypatch):
    result = _delegation_invocation(monkeypatch, edges=[])
    assert result["idf"]["actualGraphData"]["modelText"] == ""
    assert result["idf"]["actualGraphData"]["selectedGraphRecords"] == []
    assert result["resolvedGraphReads"] == []
    assert "preparedContextReads" not in result


def test_main_preview_exposes_saved_authority_without_starting_a_run(monkeypatch):
    main = _agent("main", runtime={"kind": "hermes", "mode": "main", "profile": "main"})
    main.update({"_cardRevisionId": "main-revision", "_cardRevision": 1, "_cardRevisionSha256": "main-sha"})
    main["runtimeOptions"]["tools"] = ["canvas.inspect"]
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_: {
        "projectId": "00000000-0000-0000-0000-000000000001", "deck": {"nodes": [main], "edges": []},
    })
    monkeypatch.setattr(card_domain, "materialize_idf", lambda **_: pytest.fail("preview created an IDF"))
    monkeypatch.setattr(card_domain, "_insert_run", lambda *_, **__: pytest.fail("preview started a Run"))
    payload = {"projectId": "project-one", "deckId": "deck-one", "conversationId": "conversation-one"}
    assert "preparedContext" not in card_domain.prepare_main_chat(payload)
    result = card_domain.prepare_main_chat({**payload, "message": "source validity"})
    assert result["message"] == "source validity"
    assert "preparedContext" not in result
    assert result["sessionProfile"]["unavailableTools"] == []
    assert "idf" not in result and "runId" not in result


def test_enabled_flow_edge_does_not_project_a_conversational_target_into_the_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invocation = _delegation_invocation(
        monkeypatch,
        edges=[{"source": "parent", "target": "child", "edgeType": "flow"}],
    )
    assert invocation["cardIdentity"] == {"cardId": "parent", "title": "parent"}
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in invocation
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in invocation["idf"]


def test_hermes_flow_keeps_formal_run_and_conversation_surfaces_separate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invocation = _delegation_invocation(
        monkeypatch,
        edges=[{"source": "parent", "target": "child", "edgeType": "flow"}],
        parent_runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    assert invocation["runtimeOwner"] == "hermes"
    assert invocation["cardIdentity"] == {"cardId": "parent", "title": "parent"}
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in invocation
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in invocation["idf"]


def test_no_flow_edge_also_has_no_conversational_transport_projection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invocation = _delegation_invocation(monkeypatch, edges=[])
    assert invocation["cardIdentity"] == {"cardId": "parent", "title": "parent"}
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in invocation


def test_catalog_does_not_broaden_saved_card_grants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    card = _agent("catalog-card")
    card["_cardRevisionId"] = "revision-catalog"
    card["_cardRevision"] = 1
    card["_cardRevisionSha256"] = "sha-catalog"
    card["runtimeOptions"] = {
        **card["runtimeOptions"],
        "tools": ["engraphis_remember"],
    }
    monkeypatch.setattr(
        card_domain,
        "_load_deck_internal",
        lambda _project, _deck: {
            "projectId": "00000000-0000-0000-0000-000000000001",
            "deck": {"nodes": [card], "edges": []},
        },
    )

    def discovered(name: str, namespace: str, *, read_only: bool) -> dict:
        input_schema = {"type": "object", "properties": {}}
        return {
            "name": name,
            "providerToolName": name.split(".")[-1],
            "kind": "tool",
            "sourceId": f"{namespace}_mcp",
            "namespace": namespace,
            "connectionKind": "external-mcp",
            "publication": "external-mcp",
            "access": "read" if read_only else "write",
            "title": name,
            "description": name,
            "inputSchema": input_schema,
            "canonicalInputSchema": input_schema,
            "serverInjectedArguments": [],
            "dispatcherContextArguments": [],
            "dispatcherOwner": (
                "app.mcp_host._call_graphiti"
                if namespace == "graphiti" else "app.mcp_host._call_cbm"
            ),
            "authenticatedProjection": True,
            "annotations": {
                "readOnlyHint": read_only,
                "destructiveHint": not read_only,
                "idempotentHint": read_only,
                "openWorldHint": True,
            },
            "grantEligible": True,
        }

    invocation = card_domain.materialize_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-catalog",
        "cardId": "catalog-card",
        "assignment": "compose supported graph reads",
        "discoveredTools": [
            discovered("cbm.search_graph", "cbm", read_only=True),
            discovered("graphiti.search_nodes", "graphiti", read_only=True),
            discovered("cbm.index_repository", "cbm", read_only=False),
        ],
    })

    grants = invocation["idf"]["selectedToolsAndGrants"]
    assert grants["enabledTools"] == ["engraphis_remember"]
    assert grants["presentedTools"] == ["engraphis_remember"]
    assert [tool["canonicalId"] for tool in grants["toolDefinitions"]] == [
        "engraphis_remember",
    ]
    assert "cbm.index_repository" not in grants["enabledTools"]


def _prepared_grounded_runtime(runtime: dict[str, str]) -> dict:
    reads = [{
        "cbmQualifiedName": "symbol-one",
    }]
    materialized = card_domain.materialize_idf(
        stable={
            "projectId": "project-one", "deckId": "deck-one", "cardId": "card-one",
            "instructions": "test instructions",
            "outputContract": "",
            "runtime": runtime,
            "runtimeOptions": {},
            "provider": {
                "provider": "openai", "modelKey": "gpt-5.6-luna",
                "providerModelId": "gpt-5.6-luna", "accessMode": "chatgpt-account",
            },
        },
        variable={"task": "test task"},
        capabilities={"enabledTools": []},
        graph_context="symbol-one",
        graph_records=reads,
        graph_projection={"graphSystems": ["cbm"], "nodes": [{
            "id": "symbol-one", "graphSystem": "cbm", "type": "Function",
        }], "edges": []},
    )
    return {
        "projectId": "project-one",
        "deckId": "deck-one",
        "runtimeOwner": "mag_one" if runtime.get("mode") == "magentic_one" else "hermes",
        "cardIdentity": {"cardId": "card-one", "title": "Card"},
        "cardRevisionId": "revision-one",
        "idf": materialized.idf.model_dump(),
        "resolvedGraphReads": reads,
        "resolvedGraphProjection": {
            "nodes": [{"id": "symbol-one"}], "edges": [],
        },
    }


def _fake_retain_idf(prepared: dict, **_kwargs) -> tuple[dict, dict, dict]:
    idf = prepared["idf"]
    stable = idf["stableSavedCardContext"]
    grants = idf["selectedToolsAndGrants"]
    dynamic = idf["dynamicContext"]
    return (
        {
            "idf": idf,
            "inputSummary": {"idfBytes": 1},
        },
        {
            "idfPath": "in.idf", "idfSha256": "idf", "idfBytes": 1,
        },
        {
            "systemPrompt": str(stable.get("instructions") or ""),
            "outputRequirements": str(stable.get("outputRequirements") or ""),
            "task": str(dynamic.get("task") or ""),
            "message": str(dynamic.get("task") or ""),
            "kanbanMission": str(dynamic.get("task") or ""),
            "graphContext": str(idf["actualGraphData"].get("modelText") or ""),
            "runtime": stable["runtime"],
            "provider": stable["provider"],
            "enabledTools": list(grants.get("enabledTools") or []),
        },
    )


@pytest.mark.parametrize(
    "runtime",
    [
        {"kind": "hermes", "mode": "delegate", "profile": "helper"},
        {"kind": "hermes", "mode": "magentic_one", "profile": "card-one"},
    ],
)
def test_helper_and_mag_one_accept_empty_graph_and_reject_stale_selected_reference(
    monkeypatch: pytest.MonkeyPatch,
    runtime: dict[str, str],
) -> None:
    prepared = _prepared_grounded_runtime(runtime)
    prepared["resolvedGraphReads"] = []
    prepared["resolvedGraphProjection"] = {"nodes": [], "edges": []}
    monkeypatch.setattr(card_domain, "materialize_invocation", lambda _payload: prepared)
    assert card_domain.prepare_run_invocation({}) is prepared

    stale = [{
        "cbmQualifiedName": "missing-symbol",
        "reason": "Required production owner", "priority": 0,
        "boundedExpansion": 0, "resultLimit": 4, "required": True,
    }]
    with pytest.raises(
        card_domain.CardDomainError,
        match="selected_graph_data_reference_stale:cbmQualifiedName:missing-symbol",
    ):
        card_domain.prepare_run_invocation({"dataAnchors": stale})


@pytest.mark.parametrize(
    "runtime",
    [
        {"kind": "hermes", "mode": "delegate", "profile": "helper"},
        {"kind": "hermes", "mode": "magentic_one", "profile": "card-one"},
    ],
)
def test_selected_helper_and_mag_one_graph_data_is_validated_without_creating_a_run(
    monkeypatch: pytest.MonkeyPatch,
    runtime: dict[str, str],
) -> None:
    prepared = _prepared_grounded_runtime(runtime)
    monkeypatch.setattr(card_domain, "materialize_invocation", lambda _payload: prepared)
    monkeypatch.setattr(
        card_domain,
        "_insert_run",
        lambda *_args, **_kwargs: pytest.fail("graph-data validation created a Run"),
    )
    payload = {"dataAnchors": [{
        "cbmQualifiedName": "symbol-one",
        "reason": "Required production owner", "priority": 0,
        "boundedExpansion": 0, "resultLimit": 4, "required": True,
    }]}

    assert card_domain.prepare_run_invocation(payload) is prepared


def test_ordinary_hermes_cards_keep_the_existing_unrestricted_preparation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "delegate", "profile": "card-one",
    })
    prepared["resolvedGraphReads"] = []
    prepared["resolvedGraphProjection"] = {"nodes": [], "edges": []}
    monkeypatch.setattr(card_domain, "materialize_invocation", lambda _payload: prepared)

    assert card_domain.prepare_run_invocation({}) is prepared


def test_optional_editor_review_never_materializes_an_idf(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    components = {
        "prepared": {
            "projectId": "project-one",
            "deckId": "deck_builder",
            "cardRevisionId": "revision-one",
            "cardRevision": 1,
            "cardRevisionSha256": "sha-one",
            "runtimeOwner": "hermes",
            "cardIdentity": {"cardId": "card-one", "title": "One"},
        },
        "resolvedGraphReads": [],
        "resolvedGraphProjection": {
            "schemaVersion": "provider-card-context.v1",
            "authority": "",
            "projectId": "project-one",
            "nodes": [],
            "edges": [],
            "counts": {"nodes": 0, "edges": 0},
        },
    }
    monkeypatch.setattr(
        card_domain,
        "_resolve_invocation_components",
        lambda _payload, **_kwargs: components,
    )
    monkeypatch.setattr(
        card_domain,
        "materialize_idf",
        lambda **_kwargs: pytest.fail("editor review materialized an IDF"),
    )

    review = card_domain.prepare_card_review_context({"dataAnchors": []})

    assert review["resolvedGraphProjection"]["nodes"] == []
    assert "idf" not in review


def test_new_run_fails_closed_when_root_input_files_cannot_persist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "delegate", "profile": "card-one",
    })
    terminal: list[dict] = []
    monkeypatch.setattr(card_domain, "prepare_run_invocation", lambda _payload: prepared)
    monkeypatch.setattr(
        card_domain,
        "_insert_run",
        lambda *_args, **_kwargs: ("run-one", "correlation-one", True),
    )
    monkeypatch.setattr(
        card_domain,
        "_retain_run_idf",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            card_domain.CardDomainError("input_files_write_failed")
        ),
    )
    monkeypatch.setattr(card_domain, "finish_run", lambda payload: terminal.append(payload) or {})

    with pytest.raises(card_domain.CardDomainError, match="input_files_write_failed"):
        card_domain.begin_run({"runId": "run-one", "correlationId": "correlation-one"})
    assert terminal == [{
        "runId": "run-one",
        "state": "failed",
        "errorCode": "input_files_materialization_failed",
        "errorSummary": "input_files_write_failed",
    }]


def test_read_run_input_files_resolves_card_through_saved_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[str] = []
    loaded_identity: dict[str, str] = {}

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, _params=None):
            statements.append(str(query))

        def fetchone(self):
            return {"card_id": "card_delegate"}

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    class Materialized:
        idf_bytes = b'{"schema":"liquidaity.idf.v1"}\n'

    def load_materialized(_descriptor, **identity):
        loaded_identity.update(identity)
        return Materialized()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_resolve_project", lambda *_args: {"id": "project-one"})
    monkeypatch.setattr(card_domain, "_input_file_descriptor_for_run", lambda _run_id: {"idfPath": "in.idf"})
    monkeypatch.setattr(card_domain, "load_idf", load_materialized)
    monkeypatch.setattr(card_domain, "idf_public", lambda _materialized: {"inputSummary": {}})

    result = card_domain.read_run_input_files({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-one",
    })

    query = "\n".join(statements)
    assert "JOIN ag_catalog.agent_card_revisions AS revision" in query
    assert "SELECT revision.card_id" in query
    assert "SELECT card_id FROM ag_catalog.agent_runs" not in query
    assert loaded_identity == {
        "project_id": "project-one",
        "deck_id": "deck-one",
        "run_id": "run-one",
        "card_id": "card_delegate",
    }
    assert result["idfText"].startswith('{"schema"')


def test_mag_one_participant_validation_still_fails_before_run_creation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "magentic_one", "profile": "card-one",
    })
    monkeypatch.setattr(card_domain, "prepare_run_invocation", lambda _payload: prepared)
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one",
        "deck": {
            "nodes": [{
                "id": "card-one",
                "runtime": {
                    "kind": "hermes", "mode": "magentic_one", "profile": "card-one",
                },
            }],
            "edges": [],
        },
    })
    monkeypatch.setattr(
        card_domain,
        "_insert_run",
        lambda *_args, **_kwargs: pytest.fail("participant validation created a Run"),
    )

    with pytest.raises(
        card_domain.CardDomainError,
        match="magentic_runtime_no_connected_participants",
    ):
        card_domain.begin_run({"runId": "run-one", "correlationId": "correlation-one"})


def test_mag_one_materializes_all_six_saved_edges_without_worker_selection(monkeypatch):
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "magentic_one", "profile": "card-one",
    })
    prepared["idf"]["stableSavedCardContext"]["outputRequirements"] = "Separate output contract"
    workers = [_agent(f"worker-{i}", subtitle=f"Saved capability {i}",
                      runtime={"kind": "hermes", "mode": "delegate", "profile": f"profile-{i}"})
               for i in range(6)]
    for i, worker in enumerate(workers):
        worker["_cardRevisionId"] = f"worker-revision-{i}"
        worker["_cardRevision"] = 1
        worker["_cardRevisionSha256"] = f"{i:064x}"
    monkeypatch.setattr(card_domain, "prepare_run_invocation", lambda _payload: prepared)
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {"deck": {
        "nodes": workers,
        "edges": [{"source": "card-one" if i % 2 else worker["id"],
                   "target": worker["id"] if i % 2 else "card-one",
                   "edgeType": "magentic_option"} for i, worker in enumerate(workers)],
    }})
    monkeypatch.setattr(card_domain, "_insert_run", lambda *a, **kw: ("run-one", "correlation-one", True))
    monkeypatch.setattr(card_domain, "_retain_required_run_idf", _fake_retain_idf)
    monkeypatch.setattr(card_domain, "_observe_run_start", lambda *a, **kw: True)
    result = card_domain.begin_run({"runId": "run-one", "correlationId": "correlation-one"})
    assert result["magenticExecution"]["workers"] == [
        {
            "cardId": worker["id"],
            "title": worker["title"],
            "profile": worker["runtime"]["profile"],
            "description": worker["subtitle"],
            "cardRevisionId": worker["_cardRevisionId"],
            "capabilities": {
                "savedToolIds": [],
                "projectEligibleToolIds": [],
            },
        }
        for worker in workers
    ]
    assert result["magenticExecution"]["mission"] == "test task"
    assert result["magenticExecution"]["orchestrator"] == {
        "cardId": "card-one",
        "cardRevisionId": "revision-one",
        "hermesProfile": "card-one",
        "instructions": "test instructions",
        "provider": {
            "provider": "openai",
            "modelKey": "gpt-5.6-luna",
            "providerModelId": "gpt-5.6-luna",
            "accessMode": "chatgpt-account",
        },
        "runtimeOptions": {},
    }


def test_retired_kanban_card_mode_is_not_a_runtime_contract() -> None:
    with pytest.raises(
        card_domain.CardDomainError,
        match="hermes_runtime_mode_unsupported:kanban",
    ):
        card_domain._runtime_owner(_agent(
            "retired-kanban",
            runtime={"kind": "hermes", "mode": "kanban", "profile": "retired-kanban"},
        ))


def test_run_projection_carries_saved_runtime_profile_for_exact_rejoin() -> None:
    projected = card_domain._run_projection({
        "run_id": "run-one",
        "runtime_kind": "hermes",
        "runtime_mode": "delegate",
        "runtime_profile": "research",
        "provider_thread_ref": "t_retained_root",
        "provider": "openai-codex",
        "provider_model_id": "gpt-5.6-luna",
        "access_mode": "chatgpt-account",
        "state": "failed",
        "hermes_phase": "ready",
    })

    assert projected["runId"] == "run-one"
    assert projected["runtimeProfile"] == "research"
    assert projected["hermesRootId"] == "t_retained_root"
    assert projected["provider"] == "openai-codex"
    assert projected["model"] == "gpt-5.6-luna"
    assert projected["accessMode"] == "chatgpt-account"
    assert projected["hermesStatus"] == "ready"
    legacy = card_domain._run_projection({"run_id": "old", "hermes_phase": "queued"})
    assert legacy["hermesStatus"] is None


def test_run_progress_casts_numeric_hermes_run_id_to_persisted_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []

    class Cursor:
        rowcount = 1

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))

        def fetchone(self):
            return ("t_retained_root",)

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_observe_run_progress", lambda *_args, **_kwargs: True)

    result = card_domain.update_run_progress({
        "runId": "run-one",
        "hermesRootId": "t_retained_root",
        "hermesRunId": 18,
        "hermesStatus": "running",
        "tasksCompleted": 2,
        "tasksTotal": 5,
        "activeWorkers": 1,
    })

    query, params = statements[0]
    assert "provider_turn_ref=COALESCE(%s::text, provider_turn_ref)" in query
    assert "run.runtime_mode!='magentic_one'" in query
    assert "run.provider_thread_ref IS NULL OR run.provider_thread_ref=%s" in query
    assert params[2] == 18
    assert result["hermesRootId"] == "t_retained_root"
    assert result["updated"] is True


def test_run_progress_refuses_to_rebind_a_magnetic_root(monkeypatch: pytest.MonkeyPatch) -> None:
    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, _query, _params=None):
            return None

        def fetchone(self):
            return None

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(
        card_domain,
        "_observe_run_progress",
        lambda *_args, **_kwargs: pytest.fail("rejected rebind wrote telemetry"),
    )

    assert card_domain.update_run_progress({
        "runId": "run-one",
        "hermesRootId": "t_conflicting_root",
        "hermesStatus": "running",
    }) == {
        "ok": True,
        "runId": "run-one",
        "hermesRootId": None,
        "updated": False,
        "telemetryWritten": False,
    }


def test_finish_run_accepts_stock_gateway_completion_without_unconfigured_api_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []
    receipt = {
        "run_id": "run-one",
        "state": "running",
        "runtime_kind": "hermes",
        "runtime_mode": "main",
        "provider": "openai",
        "access_mode": "chatgpt-account",
        "saved_openai_runtime": "",
        "effective_provider": None,
        "provider_api_mode": None,
    }

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))
            if "UPDATE ag_catalog.agent_runs SET state" in str(query):
                self.rowcount = 1
                receipt["state"] = "completed"
                receipt["effective_provider"] = "openai-codex"

        def fetchone(self):
            return receipt

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_observe_run_finish", lambda *_args, **_kwargs: True)

    result = card_domain.finish_run({
        "runId": "run-one",
        "state": "completed",
        "finalResult": "Exact Gateway answer",
        "hermesSessionId": "hermes-session",
        "effectiveProvider": "openai-codex",
    })

    update_query, update_params = next(
        statement for statement in statements
        if "UPDATE ag_catalog.agent_runs SET state" in statement[0]
    )
    assert "provider_api_mode=COALESCE(provider_api_mode, %s)" in update_query
    assert update_params[6] == "openai-codex"
    assert update_params[7] is None
    assert result["updated"] is True
    assert result["state"] == "completed"


def test_finish_run_accepts_mag_one_hermes_root_and_final_task_without_fake_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []
    receipt = {
        "run_id": "run-mag-one",
        "state": "running",
        "runtime_kind": "hermes",
        "runtime_mode": "magentic_one",
        "provider": "openai",
        "access_mode": "chatgpt-account",
        "saved_openai_runtime": "codex_app_server",
        "effective_provider": None,
        "provider_api_mode": None,
    }

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))
            if "UPDATE ag_catalog.agent_runs SET state" in str(query):
                self.rowcount = 1
                receipt["state"] = "completed"

        def fetchone(self):
            return receipt

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_observe_run_finish", lambda *_args, **_kwargs: True)

    result = card_domain.finish_run({
        "runId": "run-mag-one",
        "state": "completed",
        "finalResult": "Exact Hermes synthesis",
        "hermesSessionId": None,
        "providerThreadRef": "t_mag_root",
        "providerTurnRef": "t_mag_final",
        "effectiveProvider": "openai-codex",
        "providerApiMode": "codex_app_server",
        "hermesStatus": "done",
    })

    update_query, update_params = next(
        statement for statement in statements
        if "UPDATE ag_catalog.agent_runs SET state" in statement[0]
    )
    assert "hermes_session_ref=COALESCE(hermes_session_ref, %s)" in update_query
    assert update_params[8] is None
    assert update_params[9] == "t_mag_root"
    assert update_params[10] == "t_mag_final"
    assert result["updated"] is True
    assert result["state"] == "completed"


def test_finish_run_reconciles_one_hash_verified_result_without_rewriting_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []
    final_result = "Exact provider assistant result."
    receipt = {
        "run_id": "run-one",
        "state": "completed",
        "finished_at": "original-finished-at",
        "provider_input_tokens": 123,
        "final_result": final_result,
    }

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))
            if "UPDATE ag_catalog.agent_runs SET final_result" in str(query):
                self.rowcount = 1

        def fetchone(self):
            return receipt

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_observe_run_result_ready", lambda *_args: True)
    monkeypatch.setattr(
        card_domain,
        "_observe_run_finish",
        lambda *_args, **_kwargs: pytest.fail("result recovery rewrote terminal Run telemetry"),
    )

    result = card_domain.finish_run({
        "runId": "run-one",
        "state": "completed",
        "finalResult": final_result,
        "expectedResultSha256": card_domain._sha(final_result),
        "reconcilePersistedResult": True,
    })

    update_query, update_params = next(
        statement for statement in statements
        if "UPDATE ag_catalog.agent_runs SET final_result" in statement[0]
    )
    assert "SET final_result=%s" in update_query
    assert "state='completed' AND final_result IS NULL" in update_query
    assert "finished_at" not in update_query
    assert "provider_input_tokens" not in update_query
    assert update_params == (final_result, "run-one")
    assert result["updated"] is True
    assert result["telemetryWritten"] is True


def test_finish_run_result_reconciliation_rejects_wrong_hash() -> None:
    with pytest.raises(
        card_domain.CardDomainError,
        match="run_result_reconciliation_hash_mismatch",
    ):
        card_domain.finish_run({
            "runId": "run-one",
            "state": "completed",
            "finalResult": "Exact provider result.",
            "expectedResultSha256": "0" * 64,
            "reconcilePersistedResult": True,
        })


def test_finish_run_rejects_unverifiable_card_script_receipt_before_database_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        card_domain,
        "connect_postgres",
        lambda **_kwargs: pytest.fail("invalid Script receipt reached PostgreSQL"),
    )
    with pytest.raises(
        card_domain.CardDomainError,
        match="run_card_script_execution_sourceHash_invalid",
    ):
        card_domain.finish_run({
            "runId": "run-one",
            "state": "completed",
            "cardScriptExecution": {
                "schemaVersion": "liquidaity.card-script.run-execution.v1",
                "sourceHash": "not-a-hash",
                "compiledHash": "0" * 64,
            },
        })


def test_run_projection_preserves_existing_card_script_execution_receipt() -> None:
    receipt = {
        "schemaVersion": "liquidaity.card-script.run-execution.v1",
        "sourceHash": "a" * 64,
        "compiledHash": "b" * 64,
    }
    projected = card_domain._run_projection({
        "run_id": "run-one",
        "card_script_execution": receipt,
    })
    assert projected["cardScriptExecution"] == receipt


def test_magentic_card_may_invoke_only_a_saved_magentic_option_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mag_one = _agent(
        "mag-one",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag-one"},
    )
    worker = _agent(
        "worker",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "worker"},
    )
    for number, card in enumerate((mag_one, worker), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{number}"
    loaded = {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {
            "nodes": [mag_one, worker],
            "edges": [{
                "source": "worker",
                "target": "mag-one",
                "edgeType": "magentic_option",
            }],
        },
    }
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: loaded)
    payload = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-worker",
        "cardId": "worker",
        "senderCardId": "mag-one",
        "assignment": "bounded worker task",
    }
    assert card_domain.materialize_invocation(payload)["runtimeOwner"] == "hermes"
    loaded["deck"]["edges"] = []
    with pytest.raises(card_domain.CardDomainError, match="card_invocation_edge_authority_required"):
        card_domain.materialize_invocation(payload)


def test_same_hermes_card_direct_and_mag_one_materialize_the_same_saved_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _main_bot(
        "main",
        title="Main",
        runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    mag_one = _agent(
        "mag-one",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag-one"},
    )
    helper = _agent(
        "helper",
        title="Helper",
        prompt="Saved Helper prompt",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"},
    )
    helper["runtimeOptions"] = {
        **helper["runtimeOptions"],
        "provider": "openai",
        "modelKey": "gpt-5.6-luna",
        "providerModelId": "gpt-5.6-luna",
        "accessMode": "chatgpt-account",
        "tools": ["card.create", "hermes:tool:memory"],
        "skills": ["codex"],
        "toolsets": ["computer_use"],
        "mcpConnectionIds": ["main-runtime"],
    }
    for number, card in enumerate((main, mag_one, helper), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{number}"
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {
            "nodes": [main, mag_one, helper],
            "edges": [
                {
                    "source": "main",
                    "target": "helper",
                    "edgeType": "flow",
                },
                {
                    "source": "mag-one",
                    "target": "helper",
                    "edgeType": "magentic_option",
                },
            ],
        },
    })

    direct = card_domain.materialize_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-direct",
        "cardId": "helper",
        "senderCardId": "main",
        "assignment": "direct mission",
    })
    bus_worker = card_domain.materialize_invocation({
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-team-child",
        "cardId": "helper",
        "senderCardId": "mag-one",
        "assignment": "bus mission",
    })

    assert direct["cardIdentity"] == bus_worker["cardIdentity"]
    assert direct["cardRevisionId"] == bus_worker["cardRevisionId"] == "revision-3"
    assert direct["runtimeOwner"] == bus_worker["runtimeOwner"] == "hermes"
    assert direct["idf"]["stableSavedCardContext"] == bus_worker["idf"]["stableSavedCardContext"]
    assert direct["idf"]["selectedToolsAndGrants"] == bus_worker["idf"]["selectedToolsAndGrants"]
    assert direct["idf"]["dynamicContext"]["task"] == "direct mission"
    assert bus_worker["idf"]["dynamicContext"]["task"] == "bus mission"


def test_one_enabled_saved_magnetic_card_resolves_without_a_control_wire(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _agent(
        "main",
        runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    mag_one = _agent(
        "mag-one",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag-one"},
    )
    for number, card in enumerate((main, mag_one), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{number}"
    loaded = {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {
            "nodes": [main, mag_one],
            "edges": [],
        },
    }
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: loaded)
    assert card_domain.resolve_magentic_target_card(
        "project-one", "deck-one"
    ) == {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deckId": "deck-one",
        "cardId": "mag-one",
    }
    mag_one["runtimeOptions"]["enabled"] = False
    with pytest.raises(card_domain.CardDomainError, match="magentic_card_identity_ambiguous"):
        card_domain.resolve_magentic_target_card("project-one", "deck-one")
    mag_one["runtimeOptions"].pop("enabled")
    loaded["deck"]["nodes"].append(_agent(
        "other-mag",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "other-mag"},
    ))
    with pytest.raises(card_domain.CardDomainError, match="magentic_card_identity_ambiguous"):
        card_domain.resolve_magentic_target_card("project-one", "deck-one")


def test_main_mode_invokes_magnetic_across_orange_bot_authority(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _main_bot(
        "main",
        runtime={"kind": "hermes", "mode": "main", "profile": "main"},
    )
    main["runtimeOptions"]["orchestrator"] = False
    magnetic = _agent(
        "magnetic",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "magnetic"},
    )
    for number, card in enumerate((main, magnetic), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{number}"
    loaded = {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {"nodes": [main, magnetic], "edges": [{
            "id": "main-magnetic",
            "source": "main",
            "target": "magnetic",
            "edgeType": "flow",
        }]},
    }
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: loaded)
    payload = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "run-magnetic",
        "cardId": "magnetic",
        "senderCardId": "main",
        "assignment": "approved Magnetic mission",
    }
    assert card_domain.materialize_invocation(payload)["runtimeOwner"] == "mag_one"
    loaded["deck"]["edges"] = []
    with pytest.raises(card_domain.CardDomainError, match="card_invocation_edge_authority_required"):
        card_domain.materialize_invocation(payload)
    loaded["deck"]["edges"] = [{
        "id": "main-magnetic",
        "source": "main",
        "target": "magnetic",
        "edgeType": "flow",
    }]
    main["runtime"] = {"kind": "hermes", "mode": "delegate", "profile": "main"}
    main["runtimeOptions"]["orchestrator"] = True
    assert card_domain.materialize_invocation(payload)["runtimeOwner"] == "mag_one"
    main["runtimeOptions"]["orchestrator"] = False
    with pytest.raises(card_domain.CardDomainError, match="card_invocation_edge_authority_required"):
        card_domain.materialize_invocation(payload)


def test_disabled_flow_edge_materializes_no_delegation_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invocation = _delegation_invocation(
        monkeypatch,
        edges=[{
            "source": "parent",
            "target": "child",
            "edgeType": "flow",
            "enabled": False,
        }],
    )
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in invocation


def test_disabled_missing_or_magnetic_flow_target_projection_is_exact() -> None:
    edge = [{"source": "parent", "target": "child", "edgeType": "flow"}]
    parent = _main_bot(
        "parent", runtime={"kind": "hermes", "mode": "main", "profile": "main"}
    )
    disabled = _agent(
        "child", runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"}
    )
    disabled["runtimeOptions"] = {**disabled["runtimeOptions"], "enabled": False}
    assert card_domain._direct_card_targets(
        "parent", {"parent": parent, "child": disabled}, edge
    ) == []

    magnetic = _agent(
        "child",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "child"},
    )
    assert card_domain._direct_card_targets(
        "parent", {"parent": parent, "child": magnetic}, edge
    ) == [{
        "cardId": "child",
        "title": "child",
        "profile": "child",
        "description": "",
        "cardRevisionId": "",
    }]
    assert card_domain._direct_card_targets(
        "parent",
        {"parent": parent},
        [{"source": "parent", "target": "missing", "edgeType": "flow"}],
    ) == []


def test_stable_card_has_one_prompt_and_one_explicit_runtime() -> None:
    card = _agent(
        "helper",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"},
    )
    stable = card_domain._stable_card(card)
    assert stable["basePrompt"] == "common prompt"
    assert stable["runtime"] == {
        "kind": "hermes", "mode": "delegate", "profile": "helper"
    }


def test_runtime_owner_is_exhaustive_over_the_explicit_runtime_union() -> None:
    for mode in ("main", "delegate"):
        assert card_domain._runtime_owner(_agent(
            mode, runtime={"kind": "hermes", "mode": mode, "profile": mode}
        )) == "hermes"
    assert card_domain._runtime_owner(_agent(
        "mag-one",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag-one"},
    )) == "mag_one"
    for invalid, error in (
        (None, "runtime_kind_required"),
        ({"kind": "hermes", "mode": "delegate"}, "runtime_profile_required"),
        ({"kind": "hermes", "mode": "unknown", "profile": "invalid"},
         "hermes_runtime_mode_unsupported"),
        ({"kind": "other", "mode": "assistant"}, "runtime_kind_unsupported"),
    ):
        with pytest.raises(card_domain.CardDomainError, match=error):
            card_domain._runtime_owner(_agent("invalid", runtime=invalid))


def test_enabled_callable_saved_cards_are_magentic_workers() -> None:
    assert card_domain._is_callable_magentic_worker_card(_agent(
        "delegate", runtime={"kind": "hermes", "mode": "delegate", "profile": "delegate"}
    )) is True
    assert card_domain._is_callable_magentic_worker_card(_agent(
        "main", runtime={"kind": "hermes", "mode": "main", "profile": "main"}
    )) is False
    orchestrator = _agent(
        "orchestrator",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "orchestrator"},
    )
    orchestrator["runtimeOptions"]["orchestrator"] = True
    assert card_domain._is_callable_magentic_worker_card(orchestrator) is True
    assert card_domain._is_callable_magentic_worker_card(_agent(
        "mag-one",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag-one"},
    )) is False
    assert card_domain._is_callable_magentic_worker_card(_agent(
        "disabled", enabled=False,
        runtime={"kind": "hermes", "mode": "delegate", "profile": "disabled"},
    )) is False
    assert card_domain._is_callable_magentic_worker_card(_agent(
        "disabled-option", runtimeOptions={"enabled": False},
        runtime={"kind": "hermes", "mode": "delegate", "profile": "disabled-option"},
    )) is False
    assert card_domain._is_callable_magentic_worker_card(_agent(
        "unsupported", runtime={"kind": "hermes", "mode": "single", "profile": "unsupported"},
    )) is False


def test_connected_magentic_worker_projects_exact_saved_card_binding() -> None:
    card = _agent(
        "helper",
        title="Helper",
        prompt="saved worker prompt",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"},
    )
    card["runtimeOptions"]["tools"] = ["card.create"]
    card["subtitle"] = "Controlled repository code worker"
    card["_cardRevisionId"] = "helper-revision"
    cards = {"mag-one": _agent(
        "mag-one",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag-one"},
    ), "helper": card}
    edges = [{
        "source": "mag-one",
        "target": "helper",
        "edgeType": "magentic_option",
    }]

    assert card_domain._connected_hermes_card_targets(
        "mag-one", cards, edges, edge_type="magentic_option", strict=True,
    ) == [{
        "cardId": "helper",
        "title": "Helper",
        "profile": "helper",
        "description": "Controlled repository code worker",
        "cardRevisionId": "helper-revision",
    }]
    cards["helper"] = _agent(
        "helper", runtime={"kind": "hermes", "mode": "magentic_one", "profile": "helper"},
        _cardRevisionId="helper-revision",
    )
    with pytest.raises(card_domain.CardDomainError, match="magentic_worker_runtime_invalid"):
        card_domain._connected_hermes_card_targets(
            "mag-one", cards, edges, edge_type="magentic_option", strict=True,
        )


def _destination_fixture(monkeypatch: pytest.MonkeyPatch) -> dict:
    sender = _main_bot("sender", runtime={"kind": "hermes", "mode": "main", "profile": "sender"})
    hermes = _agent(
        "hermes",
        prompt="Hermes saved prompt",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "research"},
    )
    hermes["runtimeOptions"] = {
        **hermes["runtimeOptions"],
        "tools": ["calculator"],
    }
    for number, card in enumerate((sender, hermes), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = number
        card["_cardRevisionSha256"] = f"sha-{number}"
    loaded = {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {
            "nodes": [sender, hermes],
            "edges": [
                {"id": "flow-hermes", "source": "sender", "target": "hermes", "edgeType": "flow"},
            ],
        },
    }
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda _project, _deck: loaded)
    return loaded


def _destination_payload(card_id: str) -> dict:
    return {
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": f"run-{card_id}",
        "cardId": card_id,
        "senderCardId": "sender",
        "assignment": "Use every supplied declaration.",
    }


@pytest.mark.parametrize("model_key", ["gpt-5.6-sol", "catalog-choice"])
def test_saved_parent_selection_reaches_execution_without_changing_card_authority(monkeypatch, model_key):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"].update(
        provider="openai", accessMode="chatgpt-account", modelKey=model_key,
        providerModelId="gpt-5.6-sol",
        subagentModel={"provider": "openai", "accessMode": "chatgpt-account",
                       "modelKey": "gpt-5.6-luna", "providerModelId": "gpt-5.6-luna"},
    )
    before = json.dumps(loaded, sort_keys=True)
    prepared = card_domain._prepare_invocation(_destination_payload("hermes"))
    invocation = card_domain.materialize_invocation(_destination_payload("hermes"))
    expected = {"provider": "openai", "accessMode": "chatgpt-account",
                "modelKey": model_key, "providerModelId": "gpt-5.6-sol"}
    assert prepared["_callConfig"]["provider"] == expected
    assert invocation["idf"]["stableSavedCardContext"]["provider"] == expected
    assert prepared["_callConfig"]["runtimeOptions"]["subagentModel"] == card["runtimeOptions"]["subagentModel"]
    assert json.dumps(loaded, sort_keys=True) == before


def test_saved_hermes_subagent_model_survives_canonical_idf_materialization(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = next(item for item in loaded["deck"]["nodes"] if item["id"] == "hermes")
    selection = {
        "provider": "openai",
        "accessMode": "chatgpt-account",
        "modelKey": "gpt-5.6-luna",
        "providerModelId": "gpt-5.6-luna",
    }
    card["runtimeOptions"]["subagentModel"] = selection

    invocation = card_domain.materialize_invocation(_destination_payload("hermes"))

    assert invocation["idf"]["stableSavedCardContext"]["runtimeOptions"]["subagentModel"] == selection
    assert invocation["idf"]["stableSavedCardContext"]["provider"]["providerModelId"] != "gpt-5.6-luna"
    assert card_domain._stable_card(card)["runtimeExtensions"]["subagentModel"] == selection


@pytest.mark.parametrize("selection", ["none", "leaf", "recursive"])
def test_saved_hermes_subagent_type_survives_canonical_idf_materialization(
    monkeypatch, selection,
):
    loaded = _destination_fixture(monkeypatch)
    card = next(item for item in loaded["deck"]["nodes"] if item["id"] == "hermes")
    card["runtimeOptions"]["subagentType"] = selection

    prepared = card_domain._prepare_invocation(_destination_payload("hermes"))
    invocation = card_domain.materialize_invocation(_destination_payload("hermes"))

    assert prepared["_callConfig"]["runtimeOptions"]["subagentType"] == selection
    assert invocation["idf"]["stableSavedCardContext"]["runtimeOptions"]["subagentType"] == selection
    assert card_domain._stable_card(card)["runtimeExtensions"]["subagentType"] == selection


def test_missing_hermes_subagent_type_stays_absent(monkeypatch):
    _destination_fixture(monkeypatch)

    prepared = card_domain._prepare_invocation(_destination_payload("hermes"))

    assert "subagentType" not in prepared["_callConfig"]["runtimeOptions"]


def test_invalid_saved_hermes_subagent_type_is_rejected(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = next(item for item in loaded["deck"]["nodes"] if item["id"] == "hermes")
    card["runtimeOptions"]["subagentType"] = "team"

    with pytest.raises(card_domain.CardDomainError, match="card_subagent_type_invalid"):
        card_domain._prepare_invocation(_destination_payload("hermes"))


@pytest.mark.parametrize("runtime", [
    {"kind": "hermes", "mode": mode, "profile": "research"}
    for mode in ("main", "delegate", "magentic_one")
])
def test_ordinary_materialization_never_loads_builder_dictionary(monkeypatch, runtime):
    from app.python_models import idd
    loaded = _destination_fixture(monkeypatch)
    next(card for card in loaded["deck"]["nodes"] if card["id"] == "hermes")["runtime"] = runtime
    monkeypatch.setattr(idd, "load_input_data_dictionary", lambda: (_ for _ in ()).throw(
        AssertionError("ordinary Run must not load builder data")))
    payload = _destination_payload("hermes")
    payload.pop("senderCardId")
    invocation = card_domain.materialize_invocation(payload)
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]


def test_project_worldview_filters_saved_tools_before_the_existing_one_batch_jev(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    card = next(item for item in loaded["deck"]["nodes"] if item["id"] == "hermes")
    card["runtimeOptions"].update({
        "tools": ["calculator", "current_datetime"],
        "autoTools": True,
    })
    jev_candidates: list[list[str]] = []

    def project_mask(project_id, candidates, **_kwargs):
        assert project_id == loaded["projectId"]
        assert candidates == ["calculator", "current_datetime"]
        return {
            "schemaVersion": "project-worldview.v1",
            "projectId": project_id,
            "defaultEnabled": True,
            "candidateCapabilities": candidates,
            "enabledCapabilities": ["calculator"],
            "excludedCapabilities": ["current_datetime"],
            "overrides": [{
                "capabilityId": "current_datetime",
                "enabled": False,
                "controlledBy": "user",
                "mainReason": None,
                "updatedAt": "2026-09-27T00:00:00+00:00",
            }],
        }

    def one_batch_jev(_context, candidates):
        names = [str(item["canonicalId"]) for item in candidates]
        jev_candidates.append(names)
        return names, {
            "schemaVersion": "card-auto-tools.v1",
            "enabled": True,
            "status": "selected",
            "requestCount": 1,
            "questionCount": len(names),
            "normalAuthorizedTools": names,
            "selectedTools": names,
        }

    monkeypatch.setattr(card_domain, "resolve_project_worldview", project_mask)
    monkeypatch.setattr(card_domain, "_decide_card_auto_tools", one_batch_jev)

    invocation = card_domain.materialize_invocation(_destination_payload("hermes"))

    assert jev_candidates == [["calculator"]]
    assert invocation["projectWorldview"]["excludedCapabilities"] == ["current_datetime"]
    assert invocation["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert invocation["jevAutoTools"]["questionCount"] == 1


def test_receiving_card_materializes_its_own_exact_call_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    hermes = card_domain.materialize_invocation(_destination_payload("hermes"))

    assert hermes["idf"]["stableSavedCardContext"]["instructions"] == "Hermes saved prompt"
    assert hermes["idf"]["stableSavedCardContext"]["runtime"] == {
        "kind": "hermes", "mode": "delegate", "profile": "research",
    }
    assert hermes["idf"]["selectedToolsAndGrants"]["enabledTools"] == ["calculator"]
    assert hermes["idf"]["dynamicContext"]["task"] == "Use every supplied declaration."
    assert hermes["idf"]["actualGraphData"]["recordCounts"]["total"] == 0
    assert hermes["idf"]["actualGraphData"]["selectedGraphRecords"] == []
    assert "runId" not in hermes["idf"]["stableSavedCardContext"]
    assert "flow-hermes" not in str(hermes["idf"])

    loaded["deck"]["edges"] = [
        edge for edge in loaded["deck"]["edges"] if edge["target"] != "hermes"
    ]
    with pytest.raises(
        card_domain.CardDomainError,
        match="card_invocation_edge_authority_required",
    ):
        card_domain.materialize_invocation(_destination_payload("hermes"))


def test_idf_materialization_requires_an_actual_run_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _destination_fixture(monkeypatch)
    payload = _destination_payload("hermes")
    payload.pop("runId")

    with pytest.raises(card_domain.CardDomainError, match="run_id_required"):
        card_domain.materialize_invocation(payload)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("contextMarkdown", "copied parent context"),
        ("keyContext", "arbitrary caller summary"),
        ("visibleMessages", [{"role": "user", "content": "old chat"}]),
        ("priorResults", [{"recordId": "copied-result"}]),
        ("outputRequirements", "caller-authored extra prompt"),
        ("tools", ["calculator"]),
    ],
)
def test_invocation_rejects_every_non_graph_context_field(
    monkeypatch: pytest.MonkeyPatch,
    field: str,
    value: object,
) -> None:
    _destination_fixture(monkeypatch)
    payload = {**_destination_payload("hermes"), field: value}
    with pytest.raises(
        card_domain.CardDomainError,
        match=f"invocation_context_field_forbidden:{field}",
    ):
        card_domain.materialize_invocation(payload)


def test_saved_knowgraph_idf_receives_complete_cross_graph_subject_directory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.python_models.data_anchor import assemble_canonical_subject_directory

    loaded = _destination_fixture(monkeypatch)
    target = loaded["deck"]["nodes"][1]
    target["id"] = "card_knowgraph"
    target["runtime"]["profile"] = "knowgraph"
    loaded["deck"]["edges"][0]["target"] = "card_knowgraph"
    subjects = assemble_canonical_subject_directory(
        loaded["projectId"],
        {"complete": True, "count": 1, "revision": "think-r1", "subjects": [{
            "engraphisEntityId": "think-rocket",
            "canonicalName": "Rocket Lab", "entityKind": "person_or_concept",
        }]},
        {"complete": True, "count": 1, "revision": "know-r1", "subjects": [{
            "graphitiEntityId": "know-rocket",
            "canonicalName": "Rocket Lab", "entityKind": "Entity",
        }]},
    )
    monkeypatch.setattr(
        card_domain, "build_canonical_subject_directory", lambda _project: subjects,
    )
    invocation = card_domain.materialize_invocation(
        _destination_payload("card_knowgraph")
    )

    assert invocation["canonicalSubjectDirectory"] == subjects
    graph_text = invocation["idf"]["actualGraphData"]["modelText"]
    assert "Complete Cross-Graph Subject Directory" in graph_text
    assert graph_text.count("Rocket Lab") == 2
    assert invocation["inputSummary"]["estimatedGraphContextTokens"] > 0


def test_card_graph_handoff_rereads_provider_data_and_attributes_source_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = _agent("helper", runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"})
    source["runtimeOptions"]["tools"] = ["card.load_graph_references"]
    target = _agent(
        "mag-one",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag-one"},
        _cardRevisionId="revision-mag-one",
        _cardRevision=3,
        _cardRevisionSha256="sha-mag-one",
    )
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one",
        "deck": {"nodes": [source, target], "edges": []},
    })
    resolved_calls = []
    monkeypatch.setattr(
        card_domain,
        "resolve_data_anchors",
        lambda project_id, anchors, **kwargs: (
            resolved_calls.append((project_id, anchors, kwargs))
            or (
                "# KnowGraph\nActual current sourced finding",
                [{
                    "graphitiEpisodeId": "episode:one", "reason": anchors[0]["reason"],
                    "provenance": {"source": "Graphiti"}, "truncated": False,
                }],
            )
        ),
    )
    result = card_domain.load_card_graph_reference({
        "projectId": "project-one", "deckId": "deck_builder",
        "conversationId": "conversation-one", "_sourceCardId": "helper",
        "_sourceRunId": "run-helper", "targetCardId": "mag-one",
        "graphitiEpisodeId": "episode:one",
        "reason": "Use the sourced evidence", "order": 2, "depth": 1,
        "resultLimit": 8, "required": True,
    })

    assert result["ready"] is True
    assert result["persisted"] is False
    assert result["started"] is False
    assert result["cardRevisionId"] == "revision-mag-one"
    assert result["cardRevision"] == 3
    assert result["cardRevisionSha256"] == "sha-mag-one"
    assert result["reference"] == {
        "graphitiEpisodeId": "episode:one",
        "reason": "Use the sourced evidence", "boundedExpansion": 1,
        "resultLimit": 8, "required": True, "order": 2,
    }
    assert resolved_calls[0][2]["deck_id"] == "deck_builder"
    assert resolved_calls[0][2]["card_id"] == "helper"
    assert resolved_calls[0][2]["graph_projection"]["schemaVersion"] == "provider-card-context.v1"


def test_main_can_load_its_own_bounded_knowledge_selection_without_handoff_grant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _agent(
        "main",
        runtime={"kind": "hermes", "mode": "main", "profile": "liquidaity-main"},
    )
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one",
        "deck": {"nodes": [main], "edges": []},
    })
    resolved_calls = []
    monkeypatch.setattr(
        card_domain,
        "resolve_data_anchors",
        lambda project_id, anchors, **kwargs: (
            resolved_calls.append((project_id, anchors, kwargs))
            or (
                "# ThinkGraph\nCurrent bounded decision",
                [{
                    "engraphisMemoryId": "mem-one",
                    "reason": anchors[0]["reason"],
                }],
            )
        ),
    )

    result = card_domain.load_card_graph_reference({
        "projectId": "project-one",
        "deckId": "deck_builder",
        "conversationId": "conversation-one",
        "_sourceCardId": "main",
        "_sourceRunId": "run-main",
        "targetCardId": "main",
        "engraphisMemoryId": "mem-one",
        "reason": "Attach the approved decision",
        "order": 0,
        "depth": 0,
        "resultLimit": 1,
        "required": True,
    })

    assert result["ready"] is True
    assert result["sourceCardId"] == result["targetCardId"] == "main"
    assert result["reference"] == {
        "engraphisMemoryId": "mem-one",
        "reason": "Attach the approved decision",
        "boundedExpansion": 0,
        "resultLimit": 1,
        "required": True,
        "order": 0,
    }
    assert len(resolved_calls) == 1
    assert resolved_calls[0][2]["card_id"] == "main"


def test_non_main_same_card_graph_load_remains_forbidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    helper = _agent(
        "helper",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"},
    )
    helper["runtimeOptions"]["tools"] = ["card.load_graph_references"]
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one",
        "deck": {"nodes": [helper], "edges": []},
    })

    with pytest.raises(
        card_domain.CardDomainError,
        match="graph_reference_self_handoff_forbidden",
    ):
        card_domain.load_card_graph_reference({
            "projectId": "project-one",
            "deckId": "deck_builder",
            "_sourceCardId": "helper",
            "_sourceRunId": "run-helper",
            "targetCardId": "helper",
            "engraphisMemoryId": "mem-one",
            "reason": "Invalid recursive handoff",
            "order": 0,
            "depth": 0,
            "resultLimit": 1,
            "required": True,
        })


def test_card_graph_handoff_fails_closed_for_ungranted_or_unresolved_required_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = _agent("helper", runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"})
    target = _agent(
        "mag-one",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag-one"},
    )
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one", "deck": {"nodes": [source, target], "edges": []},
    })
    payload = {
        "projectId": "project-one", "deckId": "deck_builder",
        "_sourceCardId": "helper", "_sourceRunId": "run-helper",
        "targetCardId": "mag-one", "graphitiEpisodeId": "missing",
        "reason": "Required source", "order": 0,
        "depth": 0, "resultLimit": 4, "required": True,
    }
    with pytest.raises(card_domain.CardDomainError, match="graph_reference_handoff_not_granted"):
        card_domain.load_card_graph_reference(payload)

    source["runtimeOptions"]["tools"] = ["card.load_graph_references"]
    monkeypatch.setattr(card_domain, "resolve_data_anchors", lambda *_args, **_kwargs: ("", []))
    result = card_domain.load_card_graph_reference(payload)
    assert result["ok"] is False
    assert result["ready"] is False
    assert result["error"] == "data_anchor_required_not_resolved"


def test_context_cascade_rejects_duplicate_and_recursive_handoffs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _destination_fixture(monkeypatch)
    payload = {
        **_destination_payload("hermes"),
        "dataAnchors": [
            {
                "engraphisEntityId": "same:one",
                "reason": "sender selected the object",
                "priority": 1,
                "boundedExpansion": 0,
                "required": True,
            },
            {
                "engraphisEntityId": "same:one",
                "reason": "sender selected the same object twice",
                "priority": 0,
                "boundedExpansion": 0,
                "required": True,
            },
        ],
    }
    with pytest.raises(card_domain.CardDomainError, match="data_anchor_duplicate"):
        card_domain.materialize_invocation(payload)

    payload["dataAnchors"] = []
    payload["senderCardId"] = "hermes"
    with pytest.raises(
        card_domain.CardDomainError,
        match="card_invocation_self_handoff_forbidden",
    ):
        card_domain.materialize_invocation(payload)


def test_explicit_card_mission_is_transient_and_retaskable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _destination_fixture(monkeypatch)
    target = next(card for card in loaded["deck"]["nodes"] if card["id"] == "hermes")
    target["runtime"] = {"kind": "hermes", "mode": "delegate", "profile": "knowledge"}
    target["runtimeOptions"]["tools"] = ["graphiti.add_memory"]

    first = card_domain.materialize_invocation({
        **_destination_payload("hermes"),
        "runId": "run-first",
        "assignment": "Research the first bounded question.",
        "discoveredTools": [_external_tool("graphiti.add_memory", read_only=False)],
    })
    second = card_domain.materialize_invocation({
        **_destination_payload("hermes"),
        "runId": "run-second",
        "assignment": "Retask the same saved Graph Agent Card with a second question.",
        "discoveredTools": [_external_tool("graphiti.add_memory", read_only=False)],
    })

    assert first["cardIdentity"]["cardId"] == second["cardIdentity"]["cardId"] == "hermes"
    assert second["idf"]["stableSavedCardContext"]["runtime"]["profile"] == "knowledge"
    assert "Retask the same saved Graph Agent Card" in second["idf"]["dynamicContext"]["task"]
    assert "Research the first bounded question" not in second["idf"]["dynamicContext"]["task"]
    assert _REMOVED_PROFILE_TARGET_PROJECTION not in second


def test_only_main_mode_can_retask_one_connected_graph_card(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main = _main_bot("main", runtime={"kind": "hermes", "mode": "main", "profile": "main"})
    helper = _agent("helper", runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"})
    graph_agent = _agent("graph-agent", runtime={"kind": "hermes", "mode": "delegate", "profile": "knowledge"})
    graph_agent["runtimeOptions"]["tools"] = ["graphiti.add_memory"]
    for index, card in enumerate((main, helper, graph_agent), start=1):
        card["_cardRevisionId"] = f"revision-{index}"
        card["_cardRevision"] = 1
        card["_cardRevisionSha256"] = f"sha-{index}"
    loaded = {
        "projectId": "project-one",
        "deck": {
            "nodes": [main, helper, graph_agent],
            "edges": [
                {"source": "main", "target": "graph-agent", "edgeType": "flow"},
            ],
        },
    }
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: loaded)

    def invoke(sender: str, task: str) -> dict:
        return card_domain.materialize_invocation({
            "projectId": "project-one", "deckId": "deck_builder",
            "runId": f"run-{sender}-{len(task)}",
            "cardId": "graph-agent", "senderCardId": sender,
            "assignment": task,
            "discoveredTools": [_external_tool("graphiti.add_memory", read_only=False)],
        })

    assert invoke("main", "Research the current question.")["cardIdentity"]["cardId"] == "graph-agent"
    with pytest.raises(card_domain.CardDomainError, match="card_invocation_edge_authority_required"):
        invoke("helper", "An ordinary Card cannot orchestrate another Card.")


def test_main_chat_uses_one_canonical_materializer_without_serialized_card_data(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    from app.python_models import engraphis

    monkeypatch.setattr(
        engraphis,
        "get_service",
        lambda *_args, **_kwargs: pytest.fail("Main preparation opened Engraphis"),
    )
    main = _agent(
        "main", runtime={"kind": "hermes", "mode": "main", "profile": "default"}
    )
    main["runtimeOptions"] = {
        **main["runtimeOptions"],
        "tools": ["canvas.inspect"],
    }
    main["_cardRevisionId"] = "main-revision"
    main["_cardRevision"] = 1
    main["_cardRevisionSha256"] = "main-sha"
    monkeypatch.setattr(
        card_domain,
        "_load_deck_internal",
        lambda _project, _deck: {
            "projectId": "00000000-0000-0000-0000-000000000001",
            "deck": {"nodes": [main], "edges": []},
        },
    )
    materializations: list[str] = []
    real_materialize = card_domain.materialize_idf

    def count_materialization(**kwargs):
        materializations.append(str(kwargs["variable"]["task"]))
        return real_materialize(**kwargs)

    monkeypatch.setattr(card_domain, "materialize_idf", count_materialization)
    prepared = card_domain.prepare_main_chat({
        "projectId": "project-one",
        "deckId": "deck-one",
        "message": "Help me prepare work for another agent.",
    })
    assert "assignment" not in prepared
    assert prepared["message"] == "Help me prepare work for another agent."
    assert "idf" not in prepared
    assert prepared["sessionProfile"]["systemPrompt"] == main["prompt"]
    assert prepared["sessionProfile"]["enabledTools"] == ["canvas.inspect"]
    assert prepared["sessionProfile"]["unavailableTools"] == []
    assert prepared["sessionProfile"]["runtime"] == {
        "kind": "hermes", "mode": "main", "profile": "default",
    }
    assert prepared["cardIdentity"] == {"cardId": "main", "title": "main"}
    assert materializations == []
    inserted: dict[str, object] = {}
    monkeypatch.setattr(
        card_domain,
        "_insert_run",
        lambda value, **kwargs: (
            inserted.update({"prepared": value, **kwargs})
            or (kwargs["run_id"], kwargs["correlation_id"], True)
        ),
    )
    monkeypatch.setattr(card_domain, "_observe_run_start", lambda *args, **kwargs: True)
    monkeypatch.setattr(card_domain, "_record_run_input_artifact", lambda *_args, **_kwargs: None)
    monkeypatch.setenv("LIQUIDAITY_RUN_INPUT_ROOT", str(tmp_path / "run-inputs"))
    begun = card_domain.begin_main_chat_run({
        "projectId": "project-one",
        "deckId": "deck-one",
        "message": "Help me prepare work for another agent.",
        "cardRevisionId": "main-revision",
        "runId": "run-main-one",
        "correlationId": "run-main-one",
        "conversationId": "conversation-one",
    })
    assert begun["hermesTransport"]["request"]["task"] == (
        "Help me prepare work for another agent."
    )
    assert inserted["prepared"]["idf"]["dynamicContext"]["task"] == begun["idf"]["dynamicContext"]["task"]
    assert begun["inputFile"]["idfPath"].endswith("in.idf")
    assert materializations == ["Help me prepare work for another agent."]


def test_shared_conversation_task_names_the_selected_saved_card() -> None:
    current = "Who just replied to me?"
    context = [
        {
            "role": "user",
            "speakerCardId": "",
            "speakerLabel": "You",
            "targetCardId": "builder",
            "targetLabel": "Builder",
            "content": "@builder Reply exactly BUILDER_DIRECT_OK",
        },
        {
            "role": "assistant",
            "speakerCardId": "builder",
            "speakerLabel": "Builder",
            "targetCardId": "",
            "targetLabel": "",
            "content": "BUILDER_DIRECT_OK",
        },
    ]
    rendered = card_domain._shared_conversation_task(current, context, "Builder")
    assert rendered.startswith("## Shared conversation before this Builder turn")
    assert "You -> Builder:\n@builder Reply exactly BUILDER_DIRECT_OK" in rendered
    assert "Builder:\nBUILDER_DIRECT_OK" in rendered
    assert rendered.endswith("## Current user message to Builder\n\nWho just replied to me?")
    assert card_domain._shared_conversation_task(current, [], "Research") == current


def test_begin_run_renders_shared_conversation_before_selected_card_idf(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "delegate", "profile": "builder",
    })
    prepared["cardIdentity"] = {"cardId": "builder", "title": "Builder"}
    captured: dict[str, object] = {}

    def prepare(payload: dict) -> dict:
        captured.update(payload)
        return prepared

    monkeypatch.setattr(card_domain, "prepare_run_invocation", prepare)
    monkeypatch.setattr(
        card_domain,
        "_insert_run",
        lambda *_args, **_kwargs: ("run-builder", "run-builder", True),
    )
    monkeypatch.setattr(card_domain, "_retain_required_run_idf", _fake_retain_idf)
    monkeypatch.setattr(card_domain, "_observe_run_start", lambda *_args, **_kwargs: True)

    card_domain.begin_run({
        "projectId": "project-one",
        "deckId": "deck-one",
        "cardId": "builder",
        "assignment": "Continue with this result.",
        "sharedConversationTargetLabel": "Builder",
        "sharedConversation": [{
            "role": "assistant",
            "speakerCardId": "research",
            "speakerLabel": "Research",
            "targetCardId": "",
            "targetLabel": "",
            "content": "The bounded research result.",
        }],
        "runId": "run-builder",
        "correlationId": "run-builder",
    })

    assert captured["assignment"] == "\n\n".join((
        "## Shared conversation before this Builder turn",
        "Research:\nThe bounded research result.",
        "## Current user message to Builder",
        "Continue with this result.",
    ))


def test_age_run_start_records_identity_but_never_invents_tool_or_reference_use(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, dict]] = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(
        card_domain,
        "_age_rows",
        lambda _cursor, query, params, _columns: statements.append((query, params)) or [],
    )
    prepared = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "cardIdentity": {"cardId": "card-one"},
        "idf": {"stableSavedCardContext": {"runtime": {
            "kind": "hermes", "mode": "main", "profile": "main",
        }}},
    }
    assert card_domain._observe_run_start(
        {
            **prepared,
            "jevAutoTools": {"schemaVersion": "card-auto-tools.v1", "status": "disabled"},
            "jevModelRouter": {"schemaVersion": "card-model-router.v1", "status": "disabled"},
        },
        {
            "driverSource": "internal_chat",
            "acceptedAt": "2026-10-01T20:00:00.000Z",
            "graphRecords": [{
                "graphitiEpisodeId": "episode:stale-request",
                "reason": "must not drive telemetry",
                "asOf": "2026-08-17T00:00:00Z",
                "required": True,
            }],
        },
        run_id="run-one",
        correlation_id="correlation-one",
        input_file={"idfSha256": "a" * 64, "idfBytes": 321},
    ) is True
    assert any("EXECUTED_BY" in query for query, _params in statements)
    assert statements[0][1]["driverSource"] == "internal_chat"
    assert statements[0][1]["contextAuthorityMode"] == "main_honcho"
    assert statements[0][1]["hermesProfile"] == "main"
    assert statements[0][1]["acceptedAt"] == "2026-10-01T20:00:00.000Z"
    assert statements[0][1]["preparationElapsedMs"] is not None
    assert statements[0][1]["idfSha256"] == "a" * 64
    assert statements[0][1]["idfBytes"] == 321
    assert "run.driverSource=$driverSource" in statements[0][0]
    assert "run.contextAuthorityMode=$contextAuthorityMode" in statements[0][0]
    assert "run.preparationState='completed'" in statements[0][0]
    assert all("USED_TOOL" not in query for query, _params in statements)
    assert all("[edge:USED]" not in query for query, _params in statements)
    assert all("[edge:VIEWED]" not in query for query, _params in statements)

    statements.clear()
    assert card_domain._observe_run_finish("run-one", "completed") is True
    assert len(statements) == 1
    assert "SET run.state=$state" in statements[0][0]

    statements.clear()
    assert card_domain._observe_artifact(
        "run-one",
        "artifact-one",
        "report",
        "artifact://report-one",
    ) is True
    assert len(statements) == 1
    assert "PRODUCED_ARTIFACT" in statements[0][0]


def test_accepted_run_request_is_pending_scoped_and_has_no_hermes_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, tuple | None]] = []
    observed: list[dict] = []

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))
            self.rowcount = 1 if "INSERT INTO ag_catalog.agent_runs" in str(query) else 0

        def fetchone(self):
            return {
                "run_id": "request-one",
                "correlation_id": "request-one",
                "project_id": "project-one",
                "deck_id": "deck-one",
                "target_card_revision_id": "revision-one",
                "state": "pending",
                "created_at": datetime(2026, 10, 1, 20, 0, tzinfo=timezone.utc),
                "provider_turn_ref": None,
            }

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    card = _agent(
        "card-one",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "card-one"},
    )
    card["_cardRevisionId"] = "revision-one"
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one", "deck": {"nodes": [card], "edges": []},
    })
    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(
        card_domain,
        "_observe_run_acceptance",
        lambda **kwargs: observed.append(kwargs) or True,
    )

    result = card_domain.accept_run_request({
        "projectId": "project-one",
        "deckId": "deck-one",
        "cardId": "card-one",
        "runId": "request-one",
        "correlationId": "request-one",
        "conversationId": "conversation-one",
        "acceptedAt": "2026-10-01T20:00:00.000Z",
    })

    insert_params = next(params for query, params in statements if "INSERT INTO" in query)
    assert insert_params[-1] == datetime(2026, 10, 1, 20, 0, tzinfo=timezone.utc)
    assert result["state"] == "pending"
    assert result["hermesRunId"] is None
    assert result["acceptedAt"] == "2026-10-01T20:00:00+00:00"
    assert observed[0]["project_id"] == "project-one"
    assert observed[0]["deck_id"] == "deck-one"
    assert observed[0]["card_id"] == "card-one"


def test_beginning_an_accepted_run_types_nullable_request_fingerprint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, tuple | None]] = []

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            text = str(query)
            statements.append((text, params))
            if "INSERT INTO ag_catalog.agent_runs" in text:
                self.rowcount = 0
            elif "UPDATE ag_catalog.agent_runs SET" in text:
                self.rowcount = 1
            else:
                self.rowcount = 0

        def fetchone(self):
            return {
                "run_id": "request-one",
                "correlation_id": "request-one",
                "project_id": "project-one",
                "deck_id": "deck-one",
                "target_card_revision_id": "revision-one",
                "request_fingerprint": None,
                "state": "pending",
                "execution_authority_sha256": None,
            }

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "main", "profile": "liquidaity-main",
    })

    assert card_domain._insert_run(
        prepared,
        run_id="request-one",
        correlation_id="request-one",
        request_fingerprint=None,
    ) == ("request-one", "request-one", True)
    lookup_query = next(
        query for query, _params in statements
        if "SELECT run_id, correlation_id" in query
    )
    assert "%s::text IS NOT NULL" in lookup_query


def test_failed_preparation_settles_same_request_with_exact_error_and_no_hermes_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    updates: list[tuple[str, tuple | None]] = []
    observed: list[dict] = []

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            updates.append((str(query), params))
            self.rowcount = 1 if "UPDATE ag_catalog.agent_runs" in str(query) else 0

        def fetchone(self):
            return {
                "run_id": "request-one", "state": "pending",
                "provider_thread_ref": None, "provider_turn_ref": None,
                "card_id": "card-one",
            }

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    accepted = {
        "runId": "request-one", "correlationId": "request-one",
        "projectId": "project-one", "deckId": "deck-one", "cardId": "card-one",
        "cardRevisionId": "revision-one", "acceptedAt": "2026-10-01T20:00:00+00:00",
        "preparationStartedAt": "2026-10-01T20:00:00.001+00:00",
    }
    monkeypatch.setattr(card_domain, "accept_run_request", lambda _payload: accepted)
    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(
        card_domain,
        "_observe_run_preparation_failure",
        lambda **kwargs: observed.append(kwargs) or True,
    )

    result = card_domain.fail_run_preparation({
        "errorSummary": "configured_tool_unknown:provider.tool",
    })

    update_params = next(params for query, params in updates if "UPDATE ag_catalog.agent_runs" in query)
    update_query = next(query for query, _params in updates if "UPDATE ag_catalog.agent_runs" in query)
    assert update_params[2] == "configured_tool_unknown:provider.tool"
    assert "provider=NULL" in update_query
    assert "provider_input_tokens=NULL" in update_query
    assert result["runId"] == "request-one"
    assert result["state"] == "failed"
    assert result["errorSummary"] == "configured_tool_unknown:provider.tool"
    assert result["hermesRunId"] is None
    assert observed[0]["run_id"] == "request-one"
    assert observed[0]["error_summary"] == "configured_tool_unknown:provider.tool"


def test_failed_preparation_rejects_wrong_card_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, _query, _params=None):
            return None

        def fetchone(self):
            return None

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "accept_run_request", lambda _payload: {
        "runId": "request-one", "correlationId": "request-one",
        "projectId": "project-one", "deckId": "deck-one", "cardId": "wrong-card",
        "cardRevisionId": "revision-one", "acceptedAt": "2026-10-01T20:00:00+00:00",
        "preparationStartedAt": "2026-10-01T20:00:00.001+00:00",
    })
    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())

    with pytest.raises(card_domain.CardDomainError, match="run_preparation_scope_mismatch"):
        card_domain.fail_run_preparation({"errorSummary": "source_failure"})


def test_begin_run_preserves_source_failure_after_settling_accepted_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settled: list[dict] = []
    monkeypatch.setattr(card_domain, "accept_run_request", lambda payload: {
        "runId": payload["runId"], "correlationId": payload["correlationId"],
    })
    monkeypatch.setattr(
        card_domain,
        "_begin_accepted_run",
        lambda _payload: (_ for _ in ()).throw(
            card_domain.CardDomainError("configured_tool_unknown:provider.tool")
        ),
    )
    monkeypatch.setattr(
        card_domain,
        "fail_run_preparation",
        lambda payload: settled.append(payload) or {"ok": True},
    )
    payload = {
        "projectId": "project-one", "deckId": "deck-one", "cardId": "card-one",
        "runId": "request-one", "correlationId": "request-one",
        "acceptedAt": "2026-10-01T20:00:00.000Z",
    }

    with pytest.raises(
        card_domain.CardDomainError,
        match="configured_tool_unknown:provider.tool",
    ):
        card_domain.begin_run(payload)

    assert settled == [{
        **payload,
        "errorCode": "configured_card_preparation_failed",
        "errorSummary": "configured_tool_unknown:provider.tool",
    }]


def test_run_finish_links_hermes_identity_to_the_same_observed_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, dict]] = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(
        card_domain,
        "_age_rows",
        lambda _cursor, query, params, _columns: statements.append((query, params)) or [],
    )

    assert card_domain._observe_run_finish("request-one", "failed", {
        "providerThreadRef": "provider-root-one",
        "providerTurnRef": "provider-run-one",
        "errorCode": "provider_failure",
        "errorSummary": "provider source failure",
    }) is True
    query, params = statements[0]
    assert "MATCH (run:Run {runId: $runId})" in query
    assert "run.hermesRunId=$hermesRunId" in query
    assert params["runId"] == "request-one"
    assert params["hermesRootId"] == "provider-root-one"
    assert params["hermesRunId"] == "provider-run-one"
    assert params["errorSummary"] == "provider source failure"


def test_selected_agentgraph_root_includes_only_its_cards_hermes_team(monkeypatch):
    from contextlib import nullcontext
    class Cursor:
        def execute(self, statement):
            assert statement == "SET TRANSACTION READ ONLY"
    class Connection:
        def cursor(self, **_kwargs):
            return nullcontext(Cursor())
    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: nullcontext(Connection()))
    monkeypatch.setattr(card_domain, "_load_deck_with_cursor", lambda *_args: {
        "projectId": "p", "deck": {"nodes": [], "edges": []},
    })
    queries = []
    def age_rows(_cursor, query, params, _columns):
        queries.append((query, params))
        if "rootRunIds" in params:
            assert params["rootRunIds"] == ["root"]
            assert "run.hermesChildId IS NOT NULL" in query and "LIMIT 20" in query
            return [
                {"run": {"runId": "team", "rootRunId": "root", "hermesChildId": "t_team", "state": "completed"}, "card_id": "graph"},
                {"run": {"runId": "profile", "rootRunId": "root", "hermesChildId": "t_other"}, "card_id": "other"},
                {"run": {"runId": "old-team", "rootRunId": "old", "hermesChildId": "t_old"}, "card_id": "graph"},
            ]
        if "EXECUTED_BY" in query:
            assert params["cardId"] == "graph" and "LIMIT 1" in query
            return [{"run": {"runId": "root", "state": "running"}, "card_id": "graph"}]
        assert params["runIds"] == ["root", "team"]
        if "USED_TOOL" in query and "count(edge)" not in query:
            assert "directOnly" not in query
            return [{"run_id": "team", "tool_id": "cbm.search_graph", "event": {
                "eventId": "worker-read", "cardId": "graph", "hermesChildId": "t_worker",
                "authority": "codegraph", "operation": "read", "entityIds": ["pkg.worker"],
                "resultHash": "a" * 64,
            }}]
        return []
    monkeypatch.setattr(card_domain, "_age_rows", age_rows)
    result = card_domain.inspect_agentgraph({"projectId": "p", "deckId": "d", "cardId": "graph", "directOnly": True, "limit": 1})
    assert [run["runId"] for run in result["runs"]] == ["root", "team"]
    team = result["runs"][1]
    assert team["cardId"] == "graph" and team["rootRunId"] == "root"
    assert team["hermesChildId"] == "t_team"
    assert all("-[:READ]->" not in query for query, _ in queries)
    assert team["usedTools"] == ["cbm.search_graph"]


def test_agentgraph_inspection_is_bounded_read_only_and_project_scoped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sql: list[str] = []
    age_calls: list[tuple[str, dict]] = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, statement, *_args):
            sql.append(statement)

        def fetchone(self):
            return {"available": True}

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    deck = {
        "projectId": "project-one",
        "deck": {
            "nodes": [{
                "id": "card-one",
                "title": "Main",
                "runtime": {"kind": "hermes", "mode": "main", "profile": "main"},
                "runtimeOptions": {"enabled": True},
            }],
            "edges": [{
                "id": "flow-one",
                "source": "card-one",
                "target": "card-two",
                "edgeType": "flow",
            }],
        },
    }

    def age_rows(_cursor, query, params, _columns):
        age_calls.append((query, params))
        if "EXECUTED_BY" in query:
            return [{
                "run": {
                    "runId": "run-one",
                    "correlationId": "correlation-one",
                    "state": "completed",
                },
                "card_id": "card-one",
            }]
        if "ASSIGNED_TO" in query:
            return [{
                "run_id": "run-one",
                "sender_card_id": "card-main",
                "target_card_id": "card-one",
            }]
        if "count(edge)" in query:
            return [{
                "run_id": "run-one",
                "operation": "read",
                "event_count": 1,
            }]
        if "USED_TOOL" in query:
            return [{
                "run_id": "run-one",
                "tool_id": "cbm.search_graph",
                "event": {
                    "eventId": "tool:event-one",
                    "timestamp": "2026-08-18T12:00:00Z",
                    "projectId": "project-one",
                    "deckId": "deck-one",
                    "conversationId": "conversation-one",
                    "cardId": "card-one",
                    "authority": "codegraph",
                    "operation": "read",
                    "toolName": "cbm.search_graph",
                    "entityIds": ["pkg._runtime_owner"],
                    "relationshipIds": [],
                    "resultHash": "a" * 64,
                    "truncated": False,
                },
            }]
        if "-[:USED]->" in query:
            return [{
                "run_id": "run-one",
                "authority": "KnowGraph",
                "provider_id": "episode:one",
            }]
        if "-[:VIEWED]->" in query:
            return []
        if "-[:READ]->" in query:
            return [{"run_id": "run-one", "authority": "CodeGraph", "provider_id": "pkg.materialized"}]
        if "PRODUCED_ARTIFACT" in query:
            return [{
                "run_id": "run-one",
                "artifact": {
                    "artifactId": "artifact-one",
                    "artifactKind": "report",
                    "locator": "artifact://one",
                },
            }]
        return []

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_load_deck_with_cursor", lambda *_args, **_kwargs: deck)
    monkeypatch.setattr(card_domain, "_age_rows", age_rows)

    result = card_domain.inspect_agentgraph({
        "projectId": "project-one",
        "deckId": "deck-one",
        "conversationId": "conversation-one",
        "limit": 5,
    })

    assert sql[0] == "SET TRANSACTION READ ONLY"
    assert sql == ["SET TRANSACTION READ ONLY"]
    assert result["telemetry"] == {
        "runIdentity": True,
        "artifacts": True,
        "rawIdfStored": False,
    }
    assert result["authority"] == "postgresql-age-agentgraph"
    assert result["projectId"] == "project-one"
    assert result["scope"] == {
        "readScope": "project-deck",
        "projectWideRequested": False,
        "conversationId": "conversation-one",
        "cardId": None,
        "runId": None,
        "conversationFilterAvailable": True,
    }
    assert result["cards"][0]["cardId"] == "card-one"
    assert result["relationships"][0]["edgeType"] == "flow"
    assert result["runs"] == [{
        "runId": "run-one",
        "correlationId": "correlation-one",
        "state": "completed",
        "projectId": "project-one",
        "deckId": "deck-one",
        "conversationId": "",
        "rootRunId": "run-one",
        "hermesChildId": None,
        "startedAt": None,
        "acceptedAt": None,
        "finishedAt": None,
        "preparationStartedAt": None,
        "preparationEndedAt": None,
        "preparationElapsedMs": None,
        "preparationState": None,
        "preparationError": None,
        "hermesRootId": None,
        "hermesRunId": None,
        "cardId": "card-one",
        "assignedFromCardIds": ["card-main"],
        "parentRunIds": [],
            "childRunIds": [],
            "usedTools": ["cbm.search_graph"],
            "graphReads": 1,
            "graphWrites": 0,
        "artifacts": [{
            "artifactId": "artifact-one",
            "artifactKind": "report",
            "locator": "artifact://one",
        }],
        "idf": {"sha256": None, "bytes": None},
        "jevDecisions": [],
    }]
    assert all(params["projectId"] == "project-one" for _query, params in age_calls)
    assert all(params["deckId"] == "deck-one" for _query, params in age_calls)
    assert all(
        keyword not in query.upper()
        for query, _params in age_calls
        for keyword in ("MERGE ", "CREATE ", "DELETE ", " SET ")
    )
    assert any(
        "ORDER BY coalesce(" in query and "run.acceptedAt" in query
        for query, _params in age_calls
    )


def test_builder_input_is_independent_of_changed_or_missing_plan(monkeypatch):
    from pathlib import Path

    builder = _agent(
        "builder", prompt="Use saved construction instructions.",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "builder"},
        runtimeOptions={**_agent("x")["runtimeOptions"], "tools": ["canvas.inspect"],
                        "skills": ["agent-builder-inspection"]},
    )
    builder.update(_cardRevisionId="revision-one", _cardRevision=1, _cardRevisionSha256="a" * 64)
    monkeypatch.setattr(card_domain, "_load_deck_internal", lambda *_args: {
        "projectId": "project-one", "meta": {"deckRevision": "deck-revision-one"},
        "deck": {"nodes": [builder], "edges": [], "projectCodeFolder": "worker-agent-ui"},
    })
    original_read = Path.read_bytes
    plan_reads = []
    plan_content = b"## Agent Builder product vision\nBuilder migration and graph test plan."

    def read_bytes(path):
        if path.name == "PLAN.md":
            plan_reads.append(str(path))
            if plan_content is None:
                raise FileNotFoundError(path)
            return plan_content
        return original_read(path)

    monkeypatch.setattr(Path, "read_bytes", read_bytes)
    payload = {
        "projectId": "project-one", "deckId": "deck_builder", "cardId": "builder",
        "assignment": "Inspect the current Card configuration.",
    }

    def materialized():
        prepared = card_domain._prepare_invocation(payload)
        config = prepared["_callConfig"]
        return card_domain.materialize_idf(
            stable={"instructions": config["systemPrompt"], "runtime": config["runtime"],
                    "provider": config["provider"]},
            variable={"task": prepared["assignment"]},
            capabilities=config, graph_context="", graph_records=[], graph_projection={},
            materialized_at="2026-09-10T00:00:00Z",
        )

    first = materialized()
    plan_content = b"stale rewritten PLAN containing obsolete runtime and roadmap instructions"
    assert materialized().idf_bytes == first.idf_bytes
    plan_content = None
    assert materialized().idf_bytes == first.idf_bytes
    assert plan_reads == []
    assert first.idf.stableSavedCardContext.instructions == builder["prompt"]
    assert first.idf.selectedToolsAndGrants.skills == ["agent-builder-inspection"]
    assert first.idf.selectedToolsAndGrants.enabledTools == ["canvas.inspect"]
    assert first.idf.selectedToolsAndGrants.unavailableTools == []
    assert first.idf.dynamicContext.task == payload["assignment"]
    assert b"PLAN.md" not in first.idf_bytes


@pytest.mark.parametrize("field", ["builderOperation", "agentBuilderOperation", "agentBuilderGuidance", "buildTarget", "selectedCardTarget"])
def test_invocation_rejects_retired_operation_fields(field):
    with pytest.raises(card_domain.CardDomainError, match="invocation_context_field_forbidden"):
        card_domain._reject_non_graph_invocation_context({field: {"mode": "create"}})


def test_card_jev_choice_accepts_possible_two_decimal_rounded_total() -> None:
    result = card_domain._validated_choice_answer(
        {
            "type": "choice",
            "choice": "alpha",
            "confidence": 0.0,
            "probabilities": {"alpha": 0.33, "beta": 0.33, "gamma": 0.33},
        },
        ("alpha", "beta", "gamma"),
        error_code="test_invalid",
    )

    assert result["winner"] == "alpha"
    assert result["probabilities"] == {
        "alpha": 0.33, "beta": 0.33, "gamma": 0.33,
    }


def test_card_jev_choice_rejects_impossible_rounded_total() -> None:
    with pytest.raises(card_domain._CardJevError, match="test_invalid"):
        card_domain._validated_choice_answer(
            {
                "type": "choice",
                "choice": "alpha",
                "confidence": 0.0,
                "probabilities": {"alpha": 0.30, "beta": 0.20},
            },
            ("alpha", "beta"),
            error_code="test_invalid",
        )


def test_auto_tools_preserves_provider_winner_when_tie_is_applied_as_omit(
    monkeypatch,
) -> None:
    monkeypatch.setattr(card_domain, "_jev_request", lambda *_args, **_kwargs: {
        "model": "typesafe/jev-1.13-test",
        "answers": {
            "tool_" + card_domain._sha("records.read")[:24]: {
                "type": "choice",
                "choice": "USE",
                "confidence": 0.0,
                "probabilities": {"USE": 0.5, "OMIT": 0.5},
            },
        },
        "usage": {},
    })

    selected, receipt = card_domain._decide_card_auto_tools(
        {"effective_request": "Inspect the saved provider record."},
        [{
            "canonicalId": "records.read",
            "displayName": "Record read",
            "shortDescription": "Read one provider record.",
            "effects": ["read"],
            "contracts": [{
                "sourceId": "python_runtime",
                "connectionKind": "private-runtime",
                "providerToolName": "records.read",
                "description": "Read one provider record.",
                "inputSchema": {"type": "object"},
                "effects": ["read"],
                "available": True,
            }],
        }],
    )

    assert selected == []
    decision = receipt["decisions"]["records.read"]
    assert decision["winner"] == "USE"
    assert decision["providerWinner"] == "USE"
    assert decision["effectiveDecision"] == "OMIT"
    assert decision["probabilities"] == {"USE": 0.5, "OMIT": 0.5}


def _card_jev_application_fixture(*, auto_tools: bool, auto_select: bool):
    prepared = {
        "cardIdentity": {"cardId": "card-one", "title": "Card One"},
        "cardRevisionId": "revision-one",
    }
    call_config = {
        "systemPrompt": "Use the saved Card instructions.",
        "runtime": {"kind": "hermes", "mode": "delegate", "profile": "card-one"},
        "provider": {
            "provider": "openrouter",
            "accessMode": "openrouter-api",
            "modelKey": "gpt-5.6-luna",
            "providerModelId": "openai/gpt-5.6-luna",
        },
        "runtimeOptions": {
            "autoTools": auto_tools,
            "autoSelect": auto_select,
            "reasoningEffort": "high",
        },
        "enabledTools": ["records.read", "records.write"],
        "unavailableTools": [],
        "unavailableToolReasons": {},
        "presentedTools": ["records.read", "records.write"],
        "scriptPresentation": {"mode": "ordinary", "fallbackReason": None},
        "skills": [],
        "toolsets": ["file"],
        "mcpConnectionIds": [],
    }
    definitions = [{
        "canonicalId": name,
        "displayName": name,
        "shortDescription": f"Contract for {name}",
        "effects": ["read" if name.endswith("read") else "write"],
        "contracts": [{
            "sourceId": "python_runtime",
            "connectionKind": "private-runtime",
            "providerToolName": name,
            "description": f"Contract for {name}",
            "inputSchema": {"type": "object", "properties": {}},
            "effects": ["read" if name.endswith("read") else "write"],
            "available": True,
        }],
    } for name in call_config["enabledTools"]]
    models = [{
        "provider": "openrouter",
        "key": key,
        "label": key,
        "providerModelId": f"openai/{key}",
        "contextWindow": 100_000,
        "routingProfile": {
            "taskFit": f"Configured fit for {key}.",
            "supportsTools": True,
            "inputModalities": ["text"],
            "reasoningEfforts": ["high"],
        },
    } for key in ("gpt-5.6-luna", "gpt-5.6-terra")]
    return prepared, call_config, definitions, models


def test_card_jev_context_omits_credentials_configuration_and_fingerprints() -> None:
    prepared, call_config, _definitions, _models = _card_jev_application_fixture(
        auto_tools=True,
        auto_select=True,
    )
    call_config["runtime"]["credential"] = "runtime-secret"
    call_config["provider"]["apiKey"] = "provider-secret"
    call_config["runtimeOptions"].update({
        "configuration": {"token": "configuration-secret"},
        "configurationFingerprint": "configuration-fingerprint",
        "executionAuthorityFingerprint": "authority-fingerprint",
        "customSecret": "extension-secret",
    })

    context = card_domain._card_jev_context(
        prepared=prepared,
        call_config=call_config,
        assignment="Inspect the provider record.",
        output_requirements="Return the requested result.",
        graph_text="Graph context.",
        references=[],
        images=[],
    )

    serialized = json.dumps(context, sort_keys=True)
    assert context["saved_card"]["runtime"] == {
        "kind": "hermes", "mode": "delegate", "profile": "card-one",
    }
    assert context["saved_card"]["provider"] == {
        "provider": "openrouter",
        "accessMode": "openrouter-api",
        "modelKey": "gpt-5.6-luna",
        "providerModelId": "openai/gpt-5.6-luna",
    }
    assert context["saved_card"]["runtime_options"] == {
        "reasoningEffort": "high", "autoTools": True, "autoSelect": True,
    }
    for forbidden in (
        "runtime-secret", "provider-secret", "configuration-secret",
        "configuration-fingerprint", "authority-fingerprint", "extension-secret",
    ):
        assert forbidden not in serialized


@pytest.mark.parametrize(
    ("auto_tools", "auto_select", "expected_tools", "expected_model"),
    [
        (False, False, ["records.read", "records.write"], "gpt-5.6-luna"),
        (True, False, ["records.read"], "gpt-5.6-luna"),
        (False, True, ["records.read", "records.write"], "gpt-5.6-terra"),
        (True, True, ["records.read"], "gpt-5.6-terra"),
    ],
)
def test_card_jev_toggle_combinations_apply_tools_before_model_without_widening(
    monkeypatch,
    auto_tools,
    auto_select,
    expected_tools,
    expected_model,
) -> None:
    prepared, call_config, definitions, models = _card_jev_application_fixture(
        auto_tools=auto_tools,
        auto_select=auto_select,
    )
    calls: list[tuple[str, list[str]]] = []

    def decide_tools(_context, candidates):
        calls.append((
            "tools",
            [str(candidate["canonicalId"]) for candidate in candidates],
        ))
        return ["records.read"], {
            "schemaVersion": "card-auto-tools.v1",
            "enabled": True,
            "status": "selected",
            "requestCount": 1,
            "questionCount": len(candidates),
            "normalAuthorizedTools": [
                str(candidate["canonicalId"]) for candidate in candidates
            ],
            "selectedTools": ["records.read"],
        }

    def decide_model(context, _candidates, saved):
        actual = [
            str(candidate["canonical_id"])
            for candidate in context["actual_initial_tools"]
        ]
        calls.append(("model", actual))
        selected = {
            **saved,
            "modelKey": "gpt-5.6-terra",
            "providerModelId": "openai/gpt-5.6-terra",
        }
        return selected, {
            "schemaVersion": "card-model-router.v1",
            "enabled": True,
            "status": "selected",
            "requestCount": 1,
            "questionCount": 1,
            "savedModel": saved,
            "selectedModel": selected,
        }

    monkeypatch.setattr(card_domain, "_decide_card_auto_tools", decide_tools)
    monkeypatch.setattr(card_domain, "_decide_card_model_router", decide_model)

    selected_definitions = card_domain._apply_card_jev_decisions(
        payload={"configuredModels": models},
        prepared=prepared,
        call_config=call_config,
        output_requirements="Return the completed requested result.",
        assignment="Inspect the provider record and report the result.",
        tool_definitions=definitions,
        saved_script_value=None,
        graph_text="Graph context.",
        references=[],
        images=[],
    )

    assert call_config["enabledTools"] == expected_tools
    assert [item["canonicalId"] for item in selected_definitions] == expected_tools
    assert call_config["provider"]["modelKey"] == expected_model
    assert [name for name, _items in calls] == (
        (["tools"] if auto_tools else []) + (["model"] if auto_select else [])
    )
    if auto_select:
        assert calls[-1] == ("model", expected_tools)
    assert prepared["jevAutoTools"]["enabled"] is auto_tools
    assert prepared["jevModelRouter"]["enabled"] is auto_select


def test_card_jev_context_policy_is_per_decision_bounded_and_receipted(monkeypatch) -> None:
    prepared, call_config, definitions, models = _card_jev_application_fixture(
        auto_tools=True,
        auto_select=True,
    )
    call_config["runtimeOptions"]["jevContext"] = {
        "autoTools": "conversation_window",
        "modelChoice": "selected_graph_context",
    }
    captured: dict[str, dict] = {}

    def decide_tools(context, _candidates):
        captured["tools"] = context
        return ["records.read"], {
            "schemaVersion": "card-auto-tools.v1", "enabled": True,
            "status": "selected", "requestCount": 1, "questionCount": 2,
            "selectedTools": ["records.read"],
        }

    def decide_model(context, _candidates, saved):
        captured["model"] = context
        return saved, {
            "schemaVersion": "card-model-router.v1", "enabled": True,
            "status": "selected", "requestCount": 1, "questionCount": 1,
            "savedModel": saved, "selectedModel": saved,
        }

    monkeypatch.setattr(card_domain, "_decide_card_auto_tools", decide_tools)
    monkeypatch.setattr(card_domain, "_decide_card_model_router", decide_model)
    card_domain._apply_card_jev_decisions(
        payload={
            "configuredModels": models,
            "_currentJevRequest": "Current bounded request.",
            "sharedConversation": [
                {"role": "user", "speaker": "User", "content": "Earlier bounded context."},
                {"role": "assistant", "speaker": "Main", "content": "Earlier answer."},
            ],
        },
        prepared=prepared,
        call_config=call_config,
        output_requirements="Return the result.",
        assignment="LEGACY MERGED HISTORY\nCurrent bounded request.",
        tool_definitions=definitions,
        saved_script_value=None,
        graph_text="Selected graph context.",
        references=[{
            "engraphisMemoryId": "think-one",
            "readOperation": "engraphis_get_memory", "contentSha256": "a" * 64,
                "label": "Rocket Lab thesis",
            "reason": "Investigate this selected hypothesis", "required": True,
            "selectionScope": {"boundedExpansion": 0, "resultLimit": 1},
            "materializedContentBytes": 512,
            "sourcePath": "thinkgraph://think-one",
        }],
        images=[],
    )

    assert captured["tools"]["request_or_delegated_mission"] == "Current bounded request."
    assert captured["tools"]["supplied_graph_context"] == ""
    assert [item["content"] for item in captured["tools"]["bounded_conversation_window"]] == [
        "Earlier bounded context.", "Earlier answer.",
    ]
    assert captured["model"]["request_or_delegated_mission"] == "Current bounded request."
    assert captured["model"]["supplied_graph_context"] == "Selected graph context."
    assert "bounded_conversation_window" not in captured["model"]
    assert prepared["jevAutoTools"]["context"]["policy"] == "conversation_window"
    assert prepared["jevAutoTools"]["context"]["effectiveSources"] == [
        "current_request", "saved_card", "conversation_window",
    ]
    assert prepared["jevModelRouter"]["context"]["policy"] == "selected_graph_context"
    assert prepared["jevModelRouter"]["context"]["effectiveSources"] == [
        "current_request", "saved_card", "selected_graph_context",
    ]
    assert len(prepared["jevAutoTools"]["context"]["inputSha256"]) == 64
    assert len(prepared["jevAutoTools"]["context"]["requestSha256"]) == 64
    assert prepared["jevAutoTools"]["context"]["savedCardRevisionId"] == "revision-one"
    assert prepared["jevAutoTools"]["context"]["conversationWindow"]["messageCount"] == 2
    assert prepared["jevAutoTools"]["context"]["graphRecords"] == []
    assert prepared["jevModelRouter"]["context"]["graphRecords"] == [{
        "engraphisMemoryId": "think-one",
        "readOperation": "engraphis_get_memory", "contentSha256": "a" * 64,
            "label": "Rocket Lab thesis",
        "reason": "Investigate this selected hypothesis", "required": True,
        "selectionScope": {"boundedExpansion": 0, "resultLimit": 1},
        "materializedContentBytes": 512,
        "sourcePath": "thinkgraph://think-one",
    }]
    assert prepared["jevModelRouter"]["context"]["conversationWindow"]["messageCount"] == 0
    assert prepared["jevAutoTools"]["context"]["unavailableSources"] == []
    assert prepared["jevModelRouter"]["context"]["unavailableSources"] == []


def test_card_jev_context_receipts_name_missing_optional_sources_without_disabling_required_input() -> None:
    prepared, call_config, definitions, models = _card_jev_application_fixture(
        auto_tools=False,
        auto_select=False,
    )
    call_config["runtimeOptions"]["jevContext"] = {
        "autoTools": "conversation_window",
        "modelChoice": "selected_graph_context",
    }
    card_domain._apply_card_jev_decisions(
        payload={"configuredModels": models, "_currentJevRequest": "Required request."},
        prepared=prepared,
        call_config=call_config,
        output_requirements="Return the result.",
        assignment="Required request.",
        tool_definitions=definitions,
        saved_script_value=None,
        graph_text="",
        references=[],
        images=[],
    )

    auto_context = prepared["jevAutoTools"]["context"]
    model_context = prepared["jevModelRouter"]["context"]
    assert auto_context["requiredSources"] == ["current_request", "saved_card"]
    assert model_context["requiredSources"] == ["current_request", "saved_card"]
    assert auto_context["unavailableSources"] == ["conversation_window"]
    assert model_context["unavailableSources"] == ["selected_graph_context"]
    assert auto_context["effectiveSources"] == ["current_request", "saved_card"]
    assert model_context["effectiveSources"] == ["current_request", "saved_card"]
    assert prepared["jevAutoTools"]["selectedTools"] == ["records.read", "records.write"]
    assert prepared["jevModelRouter"]["selectedModel"] == call_config["provider"]


@pytest.mark.parametrize(
    ("mode", "expected_sources", "graph_count", "conversation_count"),
    [
        ("inherited", ["current_request", "saved_card", "inherited_invocation_context",
                       "selected_graph_context", "attachment_metadata"], 1, 0),
        ("request_card", ["current_request", "saved_card", "attachment_metadata"], 0, 0),
        ("conversation_window", ["current_request", "saved_card", "conversation_window",
                                 "attachment_metadata"], 0, 1),
        ("selected_graph_context", ["current_request", "saved_card", "selected_graph_context",
                                     "attachment_metadata"], 1, 0),
    ],
)
def test_every_supported_card_jev_context_selector_has_an_exact_bounded_receipt(
    mode, expected_sources, graph_count, conversation_count,
) -> None:
    prepared, call_config, definitions, models = _card_jev_application_fixture(
        auto_tools=False,
        auto_select=False,
    )
    call_config["runtimeOptions"]["jevContext"] = {
        "autoTools": mode, "modelChoice": mode,
    }
    card_domain._apply_card_jev_decisions(
        payload={
            "configuredModels": models,
            "_currentJevRequest": "Current request.",
            "sharedConversation": [{
                "role": "user", "speaker": "User", "content": "Bounded prior turn.",
            }],
        },
        prepared=prepared,
        call_config=call_config,
        output_requirements="Return the result.",
        assignment="Inherited invocation context.",
        tool_definitions=definitions,
        saved_script_value=None,
        graph_text="Selected graph context.",
        references=[{
            "graphitiEpisodeId": "know-one",
            "readOperation": "graphiti.search_nodes", "sourceUrl": "https://source.test",
        }],
        images=[{
            "name": "evidence.png", "mediaType": "image/png",
            "sha256": "b" * 64, "sizeBytes": 123,
        }],
    )

    for receipt in (
        prepared["jevAutoTools"]["context"], prepared["jevModelRouter"]["context"],
    ):
        assert receipt["policy"] == mode
        assert receipt["requiredSources"] == ["current_request", "saved_card"]
        assert receipt["effectiveSources"] == expected_sources
        assert len(receipt["graphRecords"]) == graph_count
        assert receipt["conversationWindow"]["messageCount"] == conversation_count
        assert receipt["attachmentReferences"] == [{
            "name": "evidence.png", "mediaType": "image/png",
            "sha256": "b" * 64, "sizeBytes": 123,
        }]
        assert receipt["unavailableSources"] == ["attachment_content"]
        assert receipt["inputBytes"] <= card_domain._CARD_JEV_MAX_STATE_BYTES


@pytest.mark.parametrize("value", [
    {"autoTools": "everything"},
    {"unknownBoundary": "request_card"},
    ["conversation_window"],
])
def test_card_jev_context_policy_rejects_unsupported_or_everything(value) -> None:
    with pytest.raises(card_domain.CardDomainError, match="card_jev_context_invalid"):
        card_domain._validated_card_jev_context(value)


def test_card_auto_tools_selects_with_hermes_skill_without_selecting_the_skill(
    monkeypatch,
) -> None:
    prepared, call_config, definitions, models = _card_jev_application_fixture(
        auto_tools=True,
        auto_select=True,
    )
    call_config["skills"] = ["grounded-citations"]
    calls = []

    def decide_tools(context, candidates):
        calls.append([item["canonicalId"] for item in candidates])
        assert context["saved_card"]["skills"] == ["grounded-citations"]
        return ["records.read"], {
            "schemaVersion": "card-auto-tools.v1",
            "enabled": True,
            "status": "selected",
            "requestCount": 1,
            "questionCount": len(candidates),
            "selectedTools": ["records.read"],
        }

    monkeypatch.setattr(card_domain, "_decide_card_auto_tools", decide_tools)
    selected = card_domain._apply_card_jev_decisions(
        payload={"configuredModels": models},
        prepared=prepared,
        call_config=call_config,
        output_requirements="Return the result.",
        assignment="Inspect the provider record.",
        tool_definitions=definitions,
        saved_script_value=None,
        graph_text="",
        references=[],
        images=[],
    )

    assert calls == [["records.read", "records.write"]]
    assert [item["canonicalId"] for item in selected] == ["records.read"]
    assert call_config["skills"] == ["grounded-citations"]
    assert prepared["jevAutoTools"]["status"] == "selected"
    assert prepared["jevAutoTools"]["selectedTools"] == ["records.read"]
    assert prepared["jevModelRouter"]["status"] == "unavailable"
    assert prepared["jevModelRouter"]["errorCode"] == "card_jev_skill_material_unavailable"


def test_card_auto_tools_failure_restores_complete_saved_authorized_set(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        card_domain,
        "_jev_request",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            card_domain._CardJevError("unavailable", "card_auto_tools_unavailable")
        ),
    )
    definitions = _card_jev_application_fixture(
        auto_tools=True,
        auto_select=False,
    )[2]

    selected, receipt = card_domain._decide_card_auto_tools(
        {"request_or_delegated_mission": "Inspect the record."},
        definitions,
    )

    assert selected == ["records.read", "records.write"]
    assert receipt["status"] == "unavailable"
    assert receipt["selectedTools"] == ["records.read", "records.write"]
    assert receipt["errorCode"] == "card_auto_tools_unavailable"


def test_card_auto_tools_cannot_omit_a_saved_script_mandatory_handle(
    monkeypatch,
) -> None:
    prepared, call_config, definitions, models = _card_jev_application_fixture(
        auto_tools=True,
        auto_select=False,
    )
    source = '''CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {"type": "object", "properties": {}},
    "output": {"type": "object", "properties": {"result": {}}, "required": ["result"]},
}
from hermes_tools import SCRIPT, output, tools
tools.records.write = SCRIPT
tools.call("records.write")
output.emit({"result": {}})
'''
    saved_script_value = card_domain.saved_script(
        {"enabled": True, "source": source},
        selected_tools=["records.read", "records.write"],
        default_agent_tools=["records.read"],
        hermes_available=False,
    )
    call_config["runtimeOptions"]["script"] = saved_script_value

    def decide_tools(_context, candidates):
        assert [candidate["canonicalId"] for candidate in candidates] == ["records.read"]
        return [], {
            "schemaVersion": "card-auto-tools.v1",
            "enabled": True,
            "status": "selected",
            "requestCount": 1,
            "questionCount": 1,
            "normalAuthorizedTools": ["records.read"],
            "selectedTools": [],
        }

    monkeypatch.setattr(card_domain, "_decide_card_auto_tools", decide_tools)
    selected = card_domain._apply_card_jev_decisions(
        payload={"configuredModels": models},
        prepared=prepared,
        call_config=call_config,
        output_requirements="Return the requested result.",
        assignment="Write the requested provider record.",
        tool_definitions=definitions,
        saved_script_value=saved_script_value,
        graph_text="Graph context.",
        references=[],
        images=[],
    )

    assert call_config["enabledTools"] == ["records.write"]
    assert call_config["presentedTools"] == ["records.write"]
    assert [definition["canonicalId"] for definition in selected] == ["records.write"]
    assert prepared["jevAutoTools"]["normalAuthorizedTools"] == [
        "records.read", "records.write",
    ]
    assert prepared["jevAutoTools"]["mandatoryTools"] == ["records.write"]
    assert prepared["jevAutoTools"]["selectedTools"] == ["records.write"]


def test_card_model_router_failure_uses_saved_model_only_when_still_eligible(
    monkeypatch,
) -> None:
    _prepared, call_config, _definitions, models = _card_jev_application_fixture(
        auto_tools=False,
        auto_select=True,
    )
    candidates = card_domain._configured_card_router_candidates(
        models,
        call_config["provider"],
        100,
        requires_tools=True,
        has_images=False,
        reasoning_effort="high",
    )
    monkeypatch.setattr(
        card_domain,
        "_jev_request",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            card_domain._CardJevError("timeout", "card_model_router_timeout")
        ),
    )

    selected, receipt = card_domain._decide_card_model_router(
        {"actual_initial_tools": [{"canonical_id": "records.read"}]},
        candidates,
        call_config["provider"],
    )

    assert selected == call_config["provider"]
    assert receipt["status"] == "fallback_saved"
    assert receipt["errorCode"] == "card_model_router_timeout"
