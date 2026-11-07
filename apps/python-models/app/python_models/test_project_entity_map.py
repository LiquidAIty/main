"""The displayed map is bounded navigation context, never a second graph."""
# Entity: Project Knowledge Graph
# Relationship: Tests visible-source filtering, exact provider pointers, complete displayed edges, empty maps, and exclusion of hidden record bodies.

from __future__ import annotations

import asyncio
import copy
import json

import pytest
from app.python_models import project_entity_map as maps
from app import graph_routes


@pytest.fixture(autouse=True)
def clear_view():
    maps._VISIBLE_MAPS.clear()
    maps._TURN_REFERENCES.clear()
    yield
    maps._VISIBLE_MAPS.clear()
    maps._TURN_REFERENCES.clear()


def view():
    return {
        "schemaVersion": "project-entity-map", "projectId": "project-one",
        "sources": {"thinkgraph": True, "knowgraph": True, "codegraph": False},
        "entities": [
            {"id": "rocket", "name": "Rocket Lab", "providers": [
                {"authority": "thinkgraph", "id": "think-rocket"},
                {"authority": "knowgraph", "id": "know-rocket"}]},
            {"id": "electron", "name": "Electron", "providers": [
                {"authority": "thinkgraph", "id": "think-electron"}]},
        ],
        "relationships": [{"id": "edge", "source": "rocket", "target": "electron",
                           "authority": "thinkgraph", "label": "OPERATES", "probability": 0.9}],
    }


def test_map_retains_displayed_identity_and_single_top_relationship_only():
    snapshot = view()
    maps.publish_project_entity_map("project-one", snapshot)
    result = maps.build_project_entity_map("project-one")
    assert {k: v for k, v in result.items() if k != "sha256"} == snapshot
    assert len(result["relationships"]) == 1
    assert "distribution" not in json.dumps(result)
    snapshot["entities"].clear()
    assert len(maps.build_project_entity_map("project-one")["entities"]) == 2
    result["entities"].clear()
    assert len(maps.build_project_entity_map("project-one")["entities"]) == 2


def test_all_off_and_no_view_are_valid_empty_maps():
    empty = maps.empty_project_entity_map("project-one")
    assert maps.publish_project_entity_map("project-one", empty)["ok"]
    assert maps.build_project_entity_map("project-one")["entities"] == []
    assert maps.build_project_entity_map("other-project")["relationships"] == []
    assert "An empty map is valid" in maps.render_project_entity_map(empty)


@pytest.mark.parametrize("field", ["body", "citation", "openNode", "source", "toolGrants"])
def test_shared_map_rejects_details_and_authorization_fields(field):
    snapshot = view()
    snapshot[field] = "must not enter shared context"
    with pytest.raises(ValueError, match="fields_invalid"):
        maps.publish_project_entity_map("project-one", snapshot)


def test_hidden_authority_and_dangling_edges_are_rejected_without_replacing_view():
    snapshot = view()
    maps.publish_project_entity_map("project-one", snapshot)
    bad = copy.deepcopy(snapshot)
    bad["sources"]["knowgraph"] = False
    with pytest.raises(ValueError, match="pointer_invalid"):
        maps.publish_project_entity_map("project-one", bad)
    bad = copy.deepcopy(snapshot)
    bad["relationships"][0]["target"] = "not-displayed"
    with pytest.raises(ValueError, match="relationship_invalid"):
        maps.publish_project_entity_map("project-one", bad)
    assert maps.build_project_entity_map("project-one")["entities"] == snapshot["entities"]


def test_scope_and_duplicate_identity_are_rejected():
    with pytest.raises(ValueError, match="scope_invalid"):
        maps.publish_project_entity_map("different-project", view())
    snapshot = view()
    snapshot["entities"].append(copy.deepcopy(snapshot["entities"][0]))
    with pytest.raises(ValueError, match="entity_invalid"):
        maps.publish_project_entity_map("project-one", snapshot)


def test_routes_publish_and_read_the_same_display_context():
    snapshot = view()
    assert asyncio.run(graph_routes.project_entity_map_view({"projectId": "project-one", "map": snapshot}))["ok"]
    result = asyncio.run(graph_routes.project_entity_map_read({"projectId": "project-one"}))
    assert result["ok"] is True
    assert result["projectId"] == "project-one"
    assert "think-rocket" in result["context"] and "know-rocket" in result["context"]
    assert "OPERATES" in result["context"]
    assert "No map selection authorizes an edit" in result["context"]


def authorize_main(monkeypatch):
    from app.python_models import saved_cards
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_: {"deck": {"nodes": [
        {"enabled": True, "runtime": {"kind": "hermes", "profile": "main"}},
    ]}})


def test_reference_freezes_already_displayed_detail_without_requerying_provider(monkeypatch):
    from app.python_models import thinkgraph_projection
    authorize_main(monkeypatch)
    monkeypatch.setattr(thinkgraph_projection, "projection", lambda *_: pytest.fail("Send must not wait for a new provider read"))
    reference = "cb47ca84-c8af-4e81-b861-5b58294045c7"
    snapshot = view()
    selected = {"id": "think-rocket", "name": "Rocket Lab", "authority": "thinkgraph",
                "thinks": [{"id": "selected-think", "text": "Already displayed provider detail"}]}
    maps.capture_graph_reference("project-one", "main", reference, snapshot, selected)
    snapshot["entities"].clear()
    selected["thinks"][0]["text"] = "Later Inspector change"
    maps.publish_project_entity_map("project-one", maps.empty_project_entity_map("project-one"))
    frozen = maps.take_graph_reference("project-one", "main", reference)
    assert len(frozen["map"]["entities"]) == 2
    assert frozen["openNode"]["thinks"] == [{"id": "selected-think", "text": "Already displayed provider detail"}]
    assert not maps._TURN_REFERENCES
    with pytest.raises(ValueError, match="unavailable"):
        maps.take_graph_reference("project-one", "main", reference)


def test_empty_reference_and_closed_node_need_no_provider_read(monkeypatch):
    authorize_main(monkeypatch)
    monkeypatch.setattr(maps, "_selected_detail", lambda *args: None if args[2] is None else pytest.fail("Unexpected selection"))
    reference = "f29193d1-9989-43c4-8adf-7d8794b2516a"
    maps.capture_graph_reference("project-one", "main", reference, None)
    result = maps.take_graph_reference("project-one", "main", reference)
    assert result["map"]["entities"] == []
    assert result["openNode"] is None


def test_reference_cannot_change_scope_or_be_rebound(monkeypatch):
    authorize_main(monkeypatch)
    reference = "b49969f7-f9d5-4906-a838-3b014222508d"
    maps.capture_graph_reference("project-one", "main", reference, view())
    with pytest.raises(ValueError, match="conflict"):
        maps.capture_graph_reference("project-one", "main", reference, None)
    with pytest.raises(ValueError, match="unavailable"):
        maps.take_graph_reference("other-project", "main", reference)
    with pytest.raises(ValueError, match="unavailable"):
        maps.take_graph_reference("project-one", "builder", reference)
    with pytest.raises(ValueError, match="not_authorized"):
        maps.capture_graph_reference("project-one", "unknown", reference, view())
    assert maps.take_graph_reference("project-one", "main", reference)["map"] == view()
