from __future__ import annotations

import pytest

from app.python_models import (
    agentgraph_topology,
    saved_card_contract,
    saved_cards,
)

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

    with pytest.raises(saved_card_contract.CardDomainError, match="card_profile_duplicate:alpha"):
        saved_cards._lock_and_validate_hermes_profile_bindings(Cursor(), cards)

    assert [params for query, params in calls if "pg_advisory_xact_lock" in query] == [
        ("card-id:a-card",),
        ("card-id:z-card",),
        ("card-profile:alpha",),
        ("card-profile:zeta",),
    ]
    first_binding_read = next(
        index for index, (query, _params) in enumerate(calls)
        if "FROM ag_catalog.agent_card_revisions" in query
    )
    assert first_binding_read == 4

def test_global_profile_binding_allows_same_card_and_profile_in_another_project() -> None:
    calls: list[tuple[str, object]] = []

    class Cursor:
        def execute(self, query, params=None):
            calls.append((str(query), params))

        def fetchone(self):
            return None

    saved_cards._lock_and_validate_hermes_profile_bindings(
        Cursor(),
        [_agent(
            "shared-card",
            runtime={"kind": "hermes", "mode": "delegate", "profile": "shared-profile"},
        )],
    )

    profile_query = next(
        (query, params) for query, params in calls
        if "LOWER(runtime_profile)=%s" in query
    )
    assert "card_id<>%s" in profile_query[0]
    assert profile_query[1] == ("shared-profile", "shared-card")
    card_query = next(
        (query, params) for query, params in calls
        if "LOWER(runtime_profile)<>%s" in query
    )
    assert card_query[1] == ("shared-card", "shared-profile")


def test_global_profile_binding_rejects_one_card_id_with_another_profile() -> None:
    class Cursor:
        last_query = ""

        def execute(self, query, _params=None):
            self.last_query = str(query)

        def fetchone(self):
            if "LOWER(runtime_profile)<>%s" in self.last_query:
                return {"runtime_profile": "other-profile"}
            return None

    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="card_profile_mismatch:shared-card",
    ):
        saved_cards._lock_and_validate_hermes_profile_bindings(
            Cursor(),
            [_agent(
                "shared-card",
                runtime={"kind": "hermes", "mode": "delegate", "profile": "shared-profile"},
            )],
        )

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

    monkeypatch.setattr(saved_cards, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(saved_cards, "resolve_project_record", lambda *_args: {"id": "new-project"})
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
        saved_card_contract.CardDomainError,
        match="card_profile_duplicate:taken-profile",
    ):
        saved_cards.save_deck("new-project", "new-deck", document, expected_revision=None)

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
    assert saved_cards._validated_deck_collections(document, 'd')[1] == [reverse]
    document['edges'] = [forward, reverse]
    with pytest.raises(saved_card_contract.CardDomainError, match='edge_connection_duplicate'):
        saved_cards._validated_deck_collections(document, 'd')
    document['edges'] = [forward, {**reverse, 'target': 'b'}]
    assert len(saved_cards._validated_deck_collections(document, 'd')[1]) == 2
    for source, target in [('a', 'b'), ('mag', 'mag')]:
        document['edges'] = [{**forward, 'source': source, 'target': target}]
        with pytest.raises(
            saved_card_contract.CardDomainError,
            match='magnetic_taskgraph_endpoint_required',
        ):
            saved_cards._validated_deck_collections(document, 'd')

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
    saved_cards._validated_deck_collections(document, 'd')
    agentgraph_topology.validate_card_topology(document['nodes'], document['edges'])

    helper['title'] = 'Graph Agent'
    with pytest.raises(saved_card_contract.CardDomainError, match='card_address_invalid:helper'):
        agentgraph_topology.validate_card_topology(document['nodes'], document['edges'])

    helper['title'] = 'MAIN'
    with pytest.raises(saved_card_contract.CardDomainError, match='card_address_duplicate:main'):
        agentgraph_topology.validate_card_topology(document['nodes'], document['edges'])

def test_deck_validation_rejects_duplicate_identities_and_missing_endpoints() -> None:
    duplicate = {
        "id": "deck-two",
        "name": "Two",
        "version": 1,
        "nodes": [_agent("same"), _agent("same")],
        "edges": [],
        "promptTemplates": [],
    }
    with pytest.raises(saved_card_contract.CardDomainError, match="card_id_duplicate:same"):
        saved_cards._validated_deck_collections(duplicate, "deck-two")

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
    with pytest.raises(saved_card_contract.CardDomainError, match="edge_endpoint_missing:edge-one"):
        saved_cards._validated_deck_collections(missing, "deck-two")

def test_project_code_folder_is_one_portable_managed_folder_name() -> None:
    assert saved_cards._validated_project_code_folder("  worker-agent-ui  ") == "worker-agent-ui"
    assert saved_cards._validated_project_code_folder(None) is None
    assert saved_cards._validated_project_code_folder("  ") is None

    for invalid in (".", "..", "nested/folder", "nested\\folder", "C:\\outside", "/outside", "NUL"):
        with pytest.raises(saved_card_contract.CardDomainError, match="builder_project_code_folder_invalid"):
            saved_cards._validated_project_code_folder(invalid)




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
    monkeypatch.setattr(saved_cards, "connect_postgres", lambda **_kwargs: connection)
    monkeypatch.setattr(saved_cards, "resolve_project_record", lambda *_args: {"id": "project-one"})
    monkeypatch.setattr(saved_cards, "load_saved_deck_with_cursor", lambda *_args, **_kwargs: {
        "deck": {"nodes": [previous], "edges": []},
        "meta": {"deckRevision": "deck-revision"},
    })
    monkeypatch.setattr(agentgraph_topology, "_ensure_age_card",
        lambda _cursor, project, deck, card: ensured.append((project, deck, card)),
    )

    def insert_revision(_cursor, project, deck, card, revision_number):
        inserted.append((project, deck, card["id"], revision_number))
        return "revision-new"

    monkeypatch.setattr(saved_cards, "_insert_revision", insert_revision)
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: {
        "deck": document,
        "meta": {"deckRevision": "next-deck-revision"},
    })

    result = saved_cards.save_deck(
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
