"""Saved orange and blue Card-topology contracts."""

# Entity: AgentGraph
# Relationship: This file verifies saved AGE Card relationships retain exact enabled Card identity and never gain authority from presentation fields.
#
# Entity: Card Topology
# Relationship: This file verifies orange and blue topology validation, address uniqueness, endpoint rules, direction, and independent coexistence.
#
# Entity: Agent Messaging
# Relationship: This file verifies only enabled outbound orange flow from an authorized orchestrator produces a direct saved Card roster.
#
# Entity: Magnetic Membership
# Relationship: This file verifies blue topology projects only callable saved workers with each worker's exact Card revision, profile, provider, and Team mode.
#
# Entity: Tool Catalog
# Relationship: This file verifies Magnetic worker projection carries only compact saved tool identifiers and does not create grants.
#
# Entity: Team
# Relationship: This file verifies the saved Team Card retains its explicit Team-task marker and saved parent model when selected as a blue worker.

from __future__ import annotations

import json

import pytest

from app.python_models import (
    agentgraph_topology,
    saved_card_contract,
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

def _expected_bot_target(card_id: str = "child") -> dict:
    return {
        "cardId": card_id,
        "title": card_id,
        "profile": "helper",
        "description": "",
        "cardRevisionId": "revision-2" if card_id == "child" else "revision-2",
    }

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
    agentgraph_topology.validate_card_topology(cards, edges)
    agentgraph_topology.validate_card_topology(cards, edges)
    indexed = {card['id']: card for card in cards}
    assert [target['cardId'] for target in agentgraph_topology.direct_orchestrator_targets('main', indexed, edges)] == ['helper']
    assert agentgraph_topology.direct_orchestrator_targets('helper', indexed, edges) == []
    with pytest.raises(saved_card_contract.CardDomainError, match='card_connection_controller_required:reverse'):
        agentgraph_topology.validate_card_topology(cards, [{
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

    agentgraph_topology.validate_card_topology([main, magnetic, team], [orange])
    agentgraph_topology.validate_card_topology([main, magnetic, team], [blue])
    agentgraph_topology.validate_card_topology(
        [main, magnetic, team], [orange, blue],
    )
    indexed = {card["id"]: card for card in (main, magnetic, team)}
    assert [target["cardId"] for target in agentgraph_topology.direct_orchestrator_targets(
        "main", indexed, [orange, blue],
    )] == ["card_team"]
    assert [target["cardId"] for target in agentgraph_topology.connected_agent_targets(
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
    })
    for card in (magnetic, team):
        card["_cardRevisionId"] = f"revision-{card['id']}"
    cards = {card["id"]: card for card in (magnetic, team)}

    assert agentgraph_topology.connected_agent_targets(
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

    agentgraph_topology.validate_card_topology(cards, edges)
    indexed = {card["id"]: card for card in cards}
    assert [target["cardId"] for target in agentgraph_topology.direct_orchestrator_targets(
        "main", indexed, edges,
    )] == ["signal"]
    assert [target["cardId"] for target in agentgraph_topology.direct_orchestrator_targets(
        "signal", indexed, edges,
    )] == ["worldsignals"]

def test_magnetic_cannot_gain_outbound_orange_bot_authority():
    magnetic = _agent(
        "magnetic",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "magnetic"},
    )
    magnetic["runtimeOptions"]["orchestrator"] = True
    helper = _agent("helper")
    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="card_connection_controller_required:magnetic-helper",
    ):
        agentgraph_topology.validate_card_topology(
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

    agentgraph_topology.validate_card_topology(cards, edges)
    assert agentgraph_topology._is_callable_magnetic_worker_card(worldview) is True
    indexed = {card["id"]: card for card in cards}
    assert [target["cardId"] for target in agentgraph_topology.direct_orchestrator_targets(
        "main", indexed, edges,
    )] == ["worldview"]
    assert [target["cardId"] for target in agentgraph_topology.direct_orchestrator_targets(
        "worldview", indexed, edges,
    )] == ["worldsignals"]

def test_flow_creation_reconnection_and_main_bot_authority():
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
    agentgraph_topology.validate_card_topology(nodes, edges)
    assert [target["cardId"] for target in agentgraph_topology.direct_orchestrator_targets("main", cards, edges)] == ["builder", "graph"]
    assert agentgraph_topology.direct_orchestrator_targets("builder", cards, edges) == []
    assert json.dumps(nodes, sort_keys=True) == before
    for mutation in ({"source": "builder"}, {"target": "main"}):
        invalid = [{**edges[0], **mutation}]
        with pytest.raises(saved_card_contract.CardDomainError, match="controller_required"):
            agentgraph_topology.validate_card_topology(nodes, invalid)
    assert [target["cardId"] for target in agentgraph_topology.direct_orchestrator_targets("main", cards, edges)] == [
        "builder", "graph",
    ]
    agentgraph_topology.validate_card_topology(nodes, edges)
    assert len(edges) == 2
    assert list(cards) == ["main", "builder", "graph", "disconnected"]


def test_direct_orchestrator_targets_allow_saved_hermes_cards_including_magnetic() -> None:
    cards = {
        "parent": _main_bot("parent", runtime={"kind": "hermes", "mode": "main", "profile": "main"},
                            runtimeOptions={"orchestrator": False}),
        "enabled": _agent(
            "enabled",
            runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"},
        ),
        "disabled-option": _agent(
            "disabled-option",
            enabled=False,
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
    assert agentgraph_topology.direct_orchestrator_targets("parent", cards, edges) == [
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

def test_disabled_missing_or_magnetic_flow_target_projection_is_exact() -> None:
    edge = [{"source": "parent", "target": "child", "edgeType": "flow"}]
    parent = _main_bot(
        "parent", runtime={"kind": "hermes", "mode": "main", "profile": "main"}
    )
    disabled = _agent(
        "child", runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"}
    )
    disabled["enabled"] = False
    assert agentgraph_topology.direct_orchestrator_targets(
        "parent", {"parent": parent, "child": disabled}, edge
    ) == []

    magnetic = _agent(
        "child",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "child"},
    )
    assert agentgraph_topology.direct_orchestrator_targets(
        "parent", {"parent": parent, "child": magnetic}, edge
    ) == [{
        "cardId": "child",
        "title": "child",
        "profile": "child",
        "description": "",
        "cardRevisionId": "",
    }]
    assert agentgraph_topology.direct_orchestrator_targets(
        "parent",
        {"parent": parent},
        [{"source": "parent", "target": "missing", "edgeType": "flow"}],
    ) == []

def test_enabled_callable_saved_cards_are_magnetic_workers() -> None:
    assert agentgraph_topology._is_callable_magnetic_worker_card(_agent(
        "delegate", runtime={"kind": "hermes", "mode": "delegate", "profile": "delegate"}
    )) is True
    assert agentgraph_topology._is_callable_magnetic_worker_card(_agent(
        "main", runtime={"kind": "hermes", "mode": "main", "profile": "main"}
    )) is False
    orchestrator = _agent(
        "orchestrator",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "orchestrator"},
    )
    orchestrator["runtimeOptions"]["orchestrator"] = True
    assert agentgraph_topology._is_callable_magnetic_worker_card(orchestrator) is True
    assert agentgraph_topology._is_callable_magnetic_worker_card(_agent(
        "mag-one",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag-one"},
    )) is False
    assert agentgraph_topology._is_callable_magnetic_worker_card(_agent(
        "disabled", enabled=False,
        runtime={"kind": "hermes", "mode": "delegate", "profile": "disabled"},
    )) is False
    assert agentgraph_topology._is_callable_magnetic_worker_card(_agent(
        "disabled-option", enabled=False,
        runtime={"kind": "hermes", "mode": "delegate", "profile": "disabled-option"},
    )) is False
    assert agentgraph_topology._is_callable_magnetic_worker_card(_agent(
        "unsupported", runtime={"kind": "hermes", "mode": "single", "profile": "unsupported"},
    )) is False

def test_connected_magnetic_worker_projects_exact_saved_card_binding() -> None:
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

    assert agentgraph_topology.connected_agent_targets(
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
    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="magnetic_worker_runtime_invalid",
    ):
        agentgraph_topology.connected_agent_targets(
            "mag-one", cards, edges, edge_type="magentic_option", strict=True,
        )
