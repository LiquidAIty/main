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
    yield
    maps._VISIBLE_MAPS.clear()


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
    assert result == snapshot
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
    assert result["map"] == snapshot
    assert set(result) == {"ok", "projectId", "map", "openNode"}


def test_publication_keeps_displayed_detail_without_requerying_provider(monkeypatch):
    from app.python_models import thinkgraph_projection
    monkeypatch.setattr(thinkgraph_projection, "projection", lambda *_: pytest.fail("Map context must not query a provider"))
    snapshot = view()
    selected = {"id": "think-rocket", "name": "Rocket Lab", "authority": "thinkgraph",
                "thinks": [{"id": "selected-think", "text": "Already displayed provider detail"}]}
    maps.publish_project_entity_map("project-one", snapshot, selected)
    snapshot["entities"].clear()
    selected["thinks"][0]["text"] = "Later Inspector change"
    for profile in ("main", "builder", "thinkgraph", "knowgraph"):
        result = asyncio.run(graph_routes.project_entity_map_read({"projectId": "project-one", "profile": profile}))
        assert result["map"] == view()
        if profile == "main":
            assert result["openNode"]["thinks"] == [{"id": "selected-think", "text": "Already displayed provider detail"}]
        else:
            assert result["openNode"] is None
    assert maps.build_project_entity_map("other-project", include_open_node=True)["openNode"] is None


def test_closing_node_removes_detail_and_empty_map_remains_valid():
    selected = {"id": "think-rocket", "name": "Rocket Lab", "authority": "thinkgraph", "thinks": []}
    maps.publish_project_entity_map("project-one", view(), selected)
    maps.publish_project_entity_map("project-one", view())
    result = maps.build_project_entity_map("project-one", include_open_node=True)
    assert result["openNode"] is None
    maps.publish_project_entity_map("project-one", maps.empty_project_entity_map("project-one"))
    assert maps.build_project_entity_map("project-one")["entities"] == []


def test_selected_node_must_belong_to_displayed_map():
    with pytest.raises(ValueError, match="selection_not_visible"):
        maps.publish_project_entity_map("project-one", view(), {
            "id": "foreign-entity", "name": "Other", "authority": "thinkgraph", "thinks": [],
        })
