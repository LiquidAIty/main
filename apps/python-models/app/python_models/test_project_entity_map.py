"""Focused proof for the automatically injected Entity/Relationship map."""
# Entity: Project Knowledge Graph
# Relationship: This file verifies the injected Project Entity map contains canonical identities and relationship state without copying Think, Know, citation, or episode bodies.
# Entity: ThinkGraph
# Relationship: This file verifies only current Jev-authored ThinkGraph relationships enter the shared map.
# Entity: KnowGraph
# Relationship: This file verifies KnowGraph relationships retain exact Entity identities while excluding episode and fact bodies from the shared map.

from __future__ import annotations

import json
from typing import Any

import pytest

from app.python_models import project_entity_map
from engraphis.core.interfaces import Edge, Node


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


def test_project_entity_map_contains_only_identity_and_relationship_state(
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
        "state": {"labelConfidence": 0.9, "distribution": {"OPERATES": 0.9}},
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
        project_entity_map, "build_canonical_entity_directory", lambda _project: _directory()
    )
    monkeypatch.setattr(
        project_entity_map, "_thinkgraph_relationships", lambda _project: [think_relationship]
    )
    monkeypatch.setattr(
        project_entity_map, "_knowgraph_relationships", lambda _project: [know_relationship]
    )

    result = project_entity_map.build_project_entity_map("project-one")

    assert result["schemaVersion"] == "project-entity-map"
    assert result["entities"] == _directory()["entities"]
    assert result["relationships"] == [think_relationship, know_relationship]
    assert result["counts"]["relationships"] == 2
    assert len(result["sha256"]) == 64
    encoded = json.dumps(result, sort_keys=True).casefold()
    assert '"body"' not in encoded
    assert '"citation"' not in encoded
    assert '"engraphismemoryid"' not in encoded
    assert '"graphitiepisodeid"' not in encoded


def test_thinkgraph_map_keeps_only_jev_relationships(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from engraphis.service import MemoryService

    service = MemoryService.create(":memory:", extractor="none", graph_extractor="none")
    try:
        workspace_id = service.store.get_or_create_workspace("project-one")
        rocket = service.store.upsert_entity(Node(
            id="", name="Rocket Lab", ntype="person_or_concept",
            workspace_id=workspace_id,
        ))
        electron = service.store.upsert_entity(Node(
            id="", name="Electron", ntype="person_or_concept",
            workspace_id=workspace_id,
        ))
        service.store.upsert_edge(Edge(
            id="", src=rocket, dst=electron, relation="OPERATES", weight=0.8,
            workspace_id=workspace_id,
            provenance={"jev": {
                "winner": "OPERATES",
                "distribution": {"OPERATES": 0.8, "USES": 0.2},
                "label_confidence": 0.8,
                "relationship_strength": 0.8,
            }},
        ))
        service.store.upsert_edge(Edge(
            id="", src=electron, dst=rocket, relation="generic", weight=0.2,
            workspace_id=workspace_id,
            provenance={"source": "generic"},
        ))
        monkeypatch.setattr(project_entity_map, "get_service", lambda: service)

        relationships = project_entity_map._thinkgraph_relationships("project-one")

        assert len(relationships) == 1
        assert relationships[0]["label"] == "OPERATES"
        assert relationships[0]["sourceCanonicalName"] == "Rocket Lab"
        assert relationships[0]["targetCanonicalName"] == "Electron"
        assert relationships[0]["state"]["distribution"] == {
            "OPERATES": 0.8, "USES": 0.2,
        }
    finally:
        service.close()


def test_knowgraph_map_reads_relationships_without_episode_or_fact_bodies(
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
                    "fact": "This full relationship fact stays out of the map.",
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
            self.value = Session()
            self.closed = False

        def session(self, **_kwargs):
            return self.value

        def close(self):
            self.closed = True

    driver = Driver()
    monkeypatch.setattr(project_entity_map, "knowgraph_driver", lambda: (driver, "neo4j"))

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


def test_project_entity_map_appends_once_without_property_bodies() -> None:
    entity_map = {
        **_directory(),
        "schemaVersion": "project-entity-map",
        "relationships": [],
    }

    rendered = project_entity_map.append_project_entity_map("", entity_map)

    assert rendered.count("Current Project Entity Map") == 1
    assert "no Think or Know bodies" in rendered
    assert "Rocket Lab" in rendered
