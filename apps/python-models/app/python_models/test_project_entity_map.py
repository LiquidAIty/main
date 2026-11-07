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
