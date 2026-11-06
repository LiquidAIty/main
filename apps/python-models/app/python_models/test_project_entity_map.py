"""Focused proof for the provider-owned Project Entity map."""

# Entity: Project Knowledge Graph
# Relationship: Verifies the shared map carries complete canonical identities and provider relationships without Think, Know, citation, or episode bodies.

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from app.python_models import project_entity_map
from app import graph_routes


def _directory() -> dict[str, Any]:
    return {
        "schemaVersion": "graph-entity-directory",
        "projectId": "project-one",
        "complete": True,
        "counts": {"engraphis": 1, "graphiti": 1, "total": 1},
        "revisions": {"engraphis": "think-r1", "graphiti": "know-r1"},
        "entities": [{
            "canonicalName": "Rocket Lab",
            "authority": "both",
            "engraphisEntityId": "think-rocket",
            "graphitiEntityId": "know-rocket",
        }],
        "sha256": "a" * 64,
        "bytes": 256,
        "estimatedTokens": 64,
        "readDurationMs": 1.0,
    }


def test_project_entity_map_contains_identity_and_relationship_state_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    think_relationship = {
        "authority": "thinkgraph",
        "engraphisRelationshipId": "think-edge",
        "sourceEngraphisEntityId": "think-rocket",
        "sourceCanonicalName": "Rocket Lab",
        "targetEngraphisEntityId": "think-electron",
        "targetCanonicalName": "Electron",
        "label": "OPERATES",
        "state": {"labelConfidence": 0.9},
    }
    know_relationship = {
        "authority": "knowgraph",
        "graphitiRelationshipId": "know-edge",
        "sourceGraphitiEntityId": "know-rocket",
        "sourceCanonicalName": "Rocket Lab",
        "targetGraphitiEntityId": "know-electron",
        "targetCanonicalName": "Electron",
        "label": "OPERATES",
        "state": {"validAt": "2026-01-01T00:00:00Z"},
    }
    monkeypatch.setattr(
        project_entity_map,
        "build_canonical_entity_directory",
        lambda _project: _directory(),
    )
    monkeypatch.setattr(
        project_entity_map,
        "_thinkgraph_relationships",
        lambda _project: [think_relationship],
    )
    monkeypatch.setattr(
        project_entity_map,
        "_knowgraph_relationships",
        lambda _project: [know_relationship],
    )

    result = project_entity_map.build_project_entity_map("project-one")
    rendered = project_entity_map.render_project_entity_map(result)

    assert result["entities"] == _directory()["entities"]
    assert result["relationships"] == [think_relationship, know_relationship]
    assert result["counts"]["relationships"] == 2
    assert "Current Project Entity Map" in rendered
    assert "shared names do not merge graph ownership" in rendered
    encoded = json.dumps(result, sort_keys=True).casefold()
    assert '"body"' not in encoded
    assert '"citation"' not in encoded
    assert '"engraphismemoryid"' not in encoded
    assert '"graphitiepisodeid"' not in encoded


def test_knowgraph_relationship_read_keeps_exact_entity_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Session:
        calls = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def run(self, _query: str, **_arguments: Any):
            self.calls += 1
            if self.calls == 1:
                return [{"count": 1}]
            return [{
                "relationshipId": "know-edge",
                "relationshipType": "RELATES_TO",
                "relationshipProperties": {
                    "name": "OPERATES",
                    "fact": "Excluded relationship evidence body.",
                    "episodes": ["episode-one"],
                    "valid_at": "2026-01-01T00:00:00Z",
                },
                "sourceId": "know-rocket",
                "sourceName": "Rocket Lab",
                "targetId": "know-electron",
                "targetName": "Electron",
            }]

    class Driver:
        def __init__(self):
            self.session_value = Session()
            self.closed = False

        def session(self, **_kwargs):
            return self.session_value

        def close(self):
            self.closed = True

    driver = Driver()
    monkeypatch.setattr(
        project_entity_map,
        "knowgraph_driver",
        lambda: (driver, "neo4j"),
    )

    relationships = project_entity_map._knowgraph_relationships("project-one")

    assert relationships == [{
        "authority": "knowgraph",
        "graphitiRelationshipId": "know-edge",
        "sourceGraphitiEntityId": "know-rocket",
        "sourceCanonicalName": "Rocket Lab",
        "targetGraphitiEntityId": "know-electron",
        "targetCanonicalName": "Electron",
        "label": "OPERATES",
        "state": {"validAt": "2026-01-01T00:00:00Z"},
    }]
    assert driver.closed is True


def test_project_entity_map_route_returns_provider_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entity_map = {
        **_directory(),
        "schemaVersion": "project-entity-map",
        "relationships": [],
        "counts": {**_directory()["counts"], "relationships": 0},
    }
    monkeypatch.setattr(
        project_entity_map,
        "build_project_entity_map",
        lambda _project: entity_map,
    )

    result = asyncio.run(graph_routes.project_entity_map_read({
        "projectId": "project-one",
    }))

    assert result["ok"] is True
    assert result["projectId"] == "project-one"
    assert result["sha256"] == entity_map["sha256"]
    assert result["context"].startswith("### Current Project Entity Map")
