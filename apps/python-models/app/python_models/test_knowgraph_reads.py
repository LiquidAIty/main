"""Focused projection and exact-read contracts for Graphiti-backed KnowGraph."""

# Entity: KnowGraph
# Relationship: This file verifies Graphiti-backed KnowGraph projection, exact Entity and episode reads, citation containment, provider identity, provenance, and Project-scoped query behavior.
# Entity: Project Knowledge Graph
# Relationship: This file proves KnowGraph projections expose only valid Entity nodes, bounded relationships, and attached evidence to the shared graph surface.
# Entity: Data Anchors
# Relationship: This file proves exact selected KnowGraph references hydrate only requested Project-scoped records and provenance.
# Entity: Jev Decisions
# Relationship: This file verifies valid persisted Jev relationship decisions enrich KnowGraph edges while malformed decisions do not replace provider facts.

from __future__ import annotations

import json

import pytest

from app.python_models import knowgraph_exact_reads, knowgraph_projection_reads
from app.python_models.knowgraph_exact_reads import (
    read_knowgraph_entity_directory,
    read_knowgraph_entity_knows,
    read_knowgraph_episodes_exact,
    read_knowgraph_exact,
)
from app.python_models.knowgraph_projection_reads import (
    read_knowgraph_neighborhood,
    read_knowgraph_projection,
)


class _FakeNeo4jResult:
    def __init__(self, rows):
        self._rows = rows

    def data(self):
        return self._rows


class _FakeNeo4jSession:
    def __init__(self, rows, calls):
        self._rows = list(rows)
        self._calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def run(self, query, **params):
        self._calls.append((query, params))
        return _FakeNeo4jResult(self._rows.pop(0))


class _FakeNeo4jDriver:
    def __init__(self, rows):
        self._rows = rows
        self.calls = []
        self.closed = False

    def session(self, **_kwargs):
        return _FakeNeo4jSession(self._rows, self.calls)

    def close(self):
        self.closed = True


def _projection_node_rows() -> list[dict]:
    return [{
        "node_id": "entity-a",
        "node_labels": ["Entity"],
        "community_id": "community-one",
        "node_props": {
            "name": "Alpha",
            "source": "Graphiti",
            "name_embedding": [0.1, 0.2],
            "embedding": [0.3],
            "embedding_1024": [0.4],
            "nested": {"fact_embedding": [0.5], "retained": "yes"},
        },
    }, {
        "node_id": "entity-b",
        "node_labels": ["Entity", "Company"],
        "node_props": {"name": "Beta", "owlClass": "Organization"},
    }]


def _projection_relationship_rows() -> list[dict]:
    return [{
        "rel_id": "fact-1",
        "rel_type": "RELATES_TO",
        "rel_props": {
            "name": "was awarded a launch services contract by",
            "fact": "NASA awarded Rocket Lab a launch services contract.",
            "episodes": ["episode-1"],
            "created_at": "2026-09-23T12:00:00Z",
            "reference_time": "2026-09-01T00:00:00Z",
            "valid_at": "2026-09-01T00:00:00Z",
            "jev_relation_winner": "PROVIDES",
            "jev_relation_distribution_json": json.dumps({
                "PROVIDES": 0.92,
                "ASSOCIATED_WITH": 0.08,
            }),
            "jev_label_confidence": 0.92,
            "jev_requested_model": "typesafe/jev-1.13",
            "jev_resolved_model": "typesafe/jev-1.13",
            "jev_evaluated_at": "2026-09-24T12:00:00Z",
            "jev_question_schema_version": "knowgraph.relationship-choice.v2",
            "jev_ontology_version": "jev.semantic-relationships.v1",
            "jev_ontology_hash": "hash-1",
        },
        "from_id": "entity-a",
        "from_labels": ["Entity"],
        "from_props": {"name": "Alpha"},
        "to_id": "entity-b",
        "to_labels": ["Entity", "Company"],
        "to_props": {"name": "Beta", "owlClass": "Organization"},
    }]


def _attached_know_rows() -> list[dict]:
    return [{
        "entity_id": "entity-a",
        "episode_id": f"know-{index}",
        "episode_labels": ["Episodic"],
        "episode_props": {
            "name": f"Know {index}",
            "content": json.dumps({
                "schemaVersion": "know.v1",
                "idea": {
                    "body": f"Compact For {index}.",
                    "detail": "Supporting detail.",
                    "citations": [{
                        "url": f"https://example.test/for-{index}",
                        "supports": f"Supports For {index}.",
                    }],
                },
                "counterIdea": {
                    "body": f"Compact Against {index}.",
                    "citations": [{
                        "url": f"https://example.test/against-{index}",
                        "supports": f"Supports Against {index}.",
                    }],
                },
            }),
            "source_description": json.dumps([
                f"https://example.test/for-{index}",
                f"https://example.test/against-{index}",
            ]),
            "created_at": f"2026-10-0{index}T12:00:00Z",
            "valid_at": f"2026-10-0{index}T00:00:00Z",
        },
    } for index in (3, 2, 1)]


def test_knowgraph_projection_preserves_only_entity_nodes_and_relationship_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver = _FakeNeo4jDriver([
        _projection_node_rows(),
        [],
        _projection_relationship_rows(),
    ])
    monkeypatch.setattr(
        knowgraph_projection_reads,
        "knowgraph_driver",
        lambda: (driver, "neo4j"),
    )
    projection = read_knowgraph_projection("project-1", 200)

    nodes = {node["id"]: node for node in projection["nodes"]}
    assert list(nodes) == ["entity-a", "entity-b"]
    assert nodes["entity-a"] == {
        "id": "entity-a",
        "label": "Alpha",
        "type": "Entity",
        "source": "knowgraph",
        "community_id": "community-one",
        "properties": {
            "name": "Alpha",
            "source": "Graphiti",
            "nested": {"retained": "yes"},
            "communityId": "community-one",
        },
    }
    assert nodes["entity-b"]["type"] == "Entity"
    assert nodes["entity-b"]["properties"]["providerType"] == "Organization"
    assert [
        (
            relationship["id"], relationship["from"], relationship["to"],
            relationship["type"],
        )
        for relationship in projection["relationships"]
    ] == [("fact-1", "entity-a", "entity-b", "PROVIDES")]
    properties = projection["relationships"][0]["properties"]
    assert properties["authority"] == "knowgraph"
    assert properties["graphitiStore"] == "neo4j"
    assert "portableKind" not in properties
    assert properties["graphitiFactUuid"] == "fact-1"
    assert properties["graphitiRelationshipType"] == "RELATES_TO"
    assert properties["graphitiRelation"] == "was awarded a launch services contract by"
    assert properties["supportingEpisodeUuids"] == ["episode-1"]
    assert properties["temporalStatus"] == "current"
    assert properties["jevCanonicalRelation"] == "PROVIDES"
    assert properties["relationship_strength"] == 0.92
    assert properties["jev"]["distribution"] == {
        "PROVIDES": 0.92, "ASSOCIATED_WITH": 0.08,
    }
    assert driver.calls[0][1]["projectScopeIds"] == ["liquidaity-project-1"]
    assert driver.calls[0][1]["limit"] == 200
    assert driver.closed is True


def test_knowgraph_projection_keeps_citation_urls_inside_knows_not_graph_nodes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url_id = "citation-url"
    url = "https://example.test/rocket-lab-source"
    node_rows = [*_projection_node_rows(), {
        "node_id": url_id,
        "node_labels": ["Entity"],
        "community_id": None,
        "node_props": {"name": url},
    }]
    relationship_rows = [*_projection_relationship_rows(), {
        "rel_id": "citation-support-edge",
        "rel_type": "RELATES_TO",
        "rel_props": {
            "name": "SUPPORTS",
            "fact": "The cited document supports Alpha.",
            "episodes": ["know-3"],
        },
        "from_id": url_id,
        "from_labels": ["Entity"],
        "from_props": {"name": url},
        "to_id": "entity-a",
        "to_labels": ["Entity"],
        "to_props": {"name": "Alpha"},
    }]
    driver = _FakeNeo4jDriver([
        node_rows,
        _attached_know_rows(),
        relationship_rows,
    ])
    monkeypatch.setattr(
        knowgraph_projection_reads,
        "knowgraph_driver",
        lambda: (driver, "neo4j"),
    )

    projection = read_knowgraph_projection("project-1", 200)

    assert {node["id"] for node in projection["nodes"]} == {
        "entity-a", "entity-b",
    }
    assert {relationship["id"] for relationship in projection["relationships"]} == {
        "fact-1",
    }
    attached = next(
        node for node in projection["nodes"] if node["id"] == "entity-a"
    )["properties"]["evidence"]
    assert attached[0]["idea"]["citations"][0]["url"] == (
        "https://example.test/for-3"
    )
    assert attached[0]["counterIdea"]["citations"][0]["url"] == (
        "https://example.test/against-3"
    )


def test_knowgraph_entity_directory_excludes_citation_url_entities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver = _FakeNeo4jDriver([[
        {"count": 3},
    ], [
        {"entityId": "entity-a", "canonicalName": "Alpha"},
        {"entityId": "entity-b", "canonicalName": "Beta"},
        {
            "entityId": "citation-url",
            "canonicalName": "https://example.test/source",
        },
    ]])
    monkeypatch.setattr(
        knowgraph_exact_reads,
        "knowgraph_driver",
        lambda: (driver, "neo4j"),
    )

    directory = read_knowgraph_entity_directory("project-1")

    assert directory["complete"] is True
    assert directory["count"] == 2
    assert directory["entities"] == [
        {"graphitiEntityId": "entity-a", "canonicalName": "Alpha"},
        {"graphitiEntityId": "entity-b", "canonicalName": "Beta"},
    ]


def test_knowgraph_neighborhood_preserves_one_hop_direction_with_entity_nodes_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver = _FakeNeo4jDriver([
        [_projection_node_rows()[0]],
        _projection_relationship_rows(),
        [],
    ])
    monkeypatch.setattr(
        knowgraph_projection_reads,
        "knowgraph_driver",
        lambda: (driver, "neo4j"),
    )
    neighborhood = read_knowgraph_neighborhood("project-1", "entity-a", 50)

    assert {node["id"] for node in neighborhood["nodes"]} == {
        "entity-a", "entity-b",
    }
    assert neighborhood["relationships"][0]["from"] == "entity-a"
    assert neighborhood["relationships"][0]["to"] == "entity-b"
    assert "MATCH (a:Entity)-[r:RELATES_TO]-(b:Entity)" in driver.calls[1][0]
    assert driver.calls[1][1] == {
        "nodeId": "entity-a",
        "projectScopeIds": ["liquidaity-project-1"],
        "limit": 50,
    }
    assert driver.closed is True


def test_knowgraph_projection_attaches_only_two_exact_about_knows_to_owner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver = _FakeNeo4jDriver([
        _projection_node_rows(),
        _attached_know_rows(),
        _projection_relationship_rows(),
    ])
    monkeypatch.setattr(
        knowgraph_projection_reads,
        "knowgraph_driver",
        lambda: (driver, "neo4j"),
    )

    projection = read_knowgraph_projection("project-1", 200)
    nodes = {node["id"]: node for node in projection["nodes"]}

    evidence = nodes["entity-a"]["properties"]["evidence"]
    assert [item["graphitiEpisodeId"] for item in evidence] == ["know-3", "know-2"]
    assert all(item["graphitiEntityId"] == "entity-a" for item in evidence)
    assert nodes["entity-a"]["properties"]["attachedWordCount"] == 24
    assert all("body" not in item and "content" not in item and "properties" not in item
               for item in evidence)
    assert "evidence" not in nodes["entity-b"]["properties"]
    assert all("ABOUT" in query for query, _params in driver.calls if "episode:Episodic" in query
               and "entity:Entity" in query)
    assert all("MENTIONS" not in query for query, _params in driver.calls)


def test_knowgraph_projection_refuses_non_entity_provider_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver = _FakeNeo4jDriver([[
        {
            "node_id": "episode-one",
            "node_labels": ["Episodic"],
            "node_props": {"name": "Not a visible Entity"},
            "community_id": None,
        },
    ]])
    monkeypatch.setattr(
        knowgraph_projection_reads,
        "knowgraph_driver",
        lambda: (driver, "neo4j"),
    )

    projection = read_knowgraph_projection("project-1", 200)

    assert projection == {"nodes": [], "relationships": []}
    assert driver.closed is True


def test_exact_entity_know_read_returns_one_literal_two_sided_know_and_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver = _FakeNeo4jDriver([[{
        "episodeId": row["episode_id"],
        "entityId": row["entity_id"],
        "properties": row["episode_props"],
    } for row in _attached_know_rows()[:2]]])
    monkeypatch.setattr(
        knowgraph_exact_reads,
        "knowgraph_driver",
        lambda: (driver, "neo4j"),
    )

    knows = read_knowgraph_entity_knows("project-1", "entity-a", limit=2)

    assert [know["graphitiEpisodeId"] for know in knows] == ["know-3", "know-2"]
    assert all(know["graphitiEntityId"] == "entity-a" for know in knows)
    assert knows[0]["idea"]["body"] == "Compact For 3."
    assert knows[0]["idea"]["citations"] == [{
        "url": "https://example.test/for-3",
        "supports": "Supports For 3.",
    }]
    assert knows[0]["counterIdea"]["body"] == "Compact Against 3."
    assert knows[0]["counterIdea"]["citations"] == [{
        "url": "https://example.test/against-3",
        "supports": "Supports Against 3.",
    }]
    assert "ABOUT" in driver.calls[0][0]
    assert driver.calls[0][1]["limit"] == 2


def test_knowgraph_exact_read_preserves_project_graphiti_identity_and_provenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver = _FakeNeo4jDriver([[{
        "graphitiId": "entity-1",
        "labels": ["Entity"],
        "properties": {
            "name": "Bounded entity",
            "group_id": "liquidaity-project-1",
            "source": "graphiti-test",
            "name_embedding": [0.1] * 4096,
        },
    }], [{
        "nodes": [{"graphitiId": "entity-1", "labels": ["Entity"], "properties": {
            "name_embedding": [0.1] * 4096,
        }}],
        "relationships": [],
    }]])

    monkeypatch.setattr(
        knowgraph_exact_reads,
        "knowgraph_driver",
        lambda: (driver, "neo4j"),
    )
    record = read_knowgraph_exact(
        "project-1",
        "graphitiEntityId",
        "entity-1",
        bounded_expansion=1,
    )

    assert record is not None
    assert record["graphitiEntityId"] == "entity-1"
    assert record["provenance"]["group_id"] == "liquidaity-project-1"
    assert record["relationshipEvidence"][0]["nodes"][0]["graphitiId"] == "entity-1"
    assert "name_embedding" not in record["properties"]
    assert "name_embedding" not in record["relationshipEvidence"][0]["nodes"][0]["properties"]
    assert driver.closed is True


def test_knowgraph_exact_episode_hydration_uses_requested_ids_and_project_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver = _FakeNeo4jDriver([[{
        "uuid": "episode-2",
        "properties": {
            "name": "Primary source",
            "group_id": "liquidaity-project-1",
            "source_url": "https://example.test/source",
            "valid_at": "2026-09-23T12:00:00Z",
            "content": "source body",
            "content_embedding": [0.1] * 12,
        },
    }, {
        "uuid": "unrequested",
        "properties": {"group_id": "liquidaity-project-1"},
    }]])

    monkeypatch.setattr(
        knowgraph_exact_reads,
        "knowgraph_driver",
        lambda: (driver, "neo4j"),
    )
    episodes = read_knowgraph_episodes_exact("project-1", ["episode-1", "episode-2"])

    assert [episode["uuid"] for episode in episodes] == ["episode-2"]
    assert episodes[0]["source_url"] == "https://example.test/source"
    assert episodes[0]["content_preview"] == "source body"
    assert "content_embedding" not in episodes[0]
    query, params = driver.calls[0]
    assert "MATCH (episode:Episodic)" in query
    assert params["episodeIds"] == ["episode-1", "episode-2"]
    assert params["scopeIds"] == ["liquidaity-project-1"]
    assert driver.closed is True


def test_knowgraph_exact_relationship_preserves_endpoints_sources_and_jev(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver = _FakeNeo4jDriver([[], [{
        "graphitiId": "fact-1",
        "labels": ["RELATES_TO"],
        "properties": {
            "name": "partners with",
            "fact": "Alpha partners with Beta.",
            "group_id": "liquidaity-project-1",
            "episodes": ["episode-1"],
            "created_at": "2026-09-23T12:00:00Z",
            "valid_at": "2026-09-01T00:00:00Z",
            "jev_relation_winner": "ASSOCIATED_WITH",
            "jev_relation_distribution_json": json.dumps({"ASSOCIATED_WITH": 1.0}),
            "jev_label_confidence": 1.0,
            "jev_requested_model": "typesafe/jev-1.13",
            "jev_resolved_model": "typesafe/jev-1.13",
            "jev_evaluated_at": "2026-09-24T12:00:00Z",
            "jev_question_schema_version": "knowgraph.relationship-choice.v2",
            "jev_ontology_version": "jev.semantic-relationships.v1",
            "jev_ontology_hash": "hash-1",
        },
        "sourceGraphitiId": "entity-a",
        "targetGraphitiId": "entity-b",
        "endpointNodes": [
            {"graphitiId": "entity-a", "labels": ["Entity"], "properties": {"name": "Alpha"}},
            {"graphitiId": "entity-b", "labels": ["Entity"], "properties": {"name": "Beta"}},
        ],
    }]])
    episode = {
        "uuid": "episode-1", "source_url": "https://example.test/alpha-beta",
        "valid_at": "2026-09-01T00:00:00Z",
    }

    monkeypatch.setattr(
        knowgraph_exact_reads,
        "knowgraph_driver",
        lambda: (driver, "neo4j"),
    )
    monkeypatch.setattr(
        knowgraph_exact_reads,
        "read_knowgraph_episodes_exact",
        lambda project_id, ids: [episode]
        if project_id == "project-1" and ids == ["episode-1"] else [],
    )
    record = read_knowgraph_exact(
        "project-1", "graphitiRelationshipId", "fact-1",
    )

    assert record is not None
    assert record["graphitiRelationshipId"] == "fact-1"
    assert record["recordKind"] == "relationship"
    assert record["sourceId"] == "entity-a"
    assert record["targetId"] == "entity-b"
    assert record["properties"]["name"] == "partners with"
    assert record["properties"]["fact"] == "Alpha partners with Beta."
    assert "portableKind" not in record
    assert "know" not in record
    assert record["jev"]["winner"] == "ASSOCIATED_WITH"
    assert record["provenance"]["episodes"] == [episode]


def test_knowgraph_exact_relationship_preserves_provider_text_when_jev_is_malformed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver = _FakeNeo4jDriver([[], [{
        "graphitiId": "fact-malformed",
        "labels": ["RELATES_TO"],
        "properties": {
            "name": "supports",
            "fact": "Alpha supports Beta.",
            "group_id": "liquidaity-project-1",
            "episodes": ["episode-1"],
            "jev_relation_winner": "PROVIDES",
            # A persisted Jev annotation is optional enrichment. This malformed
            # distribution must not erase or reinterpret the Graphiti fact.
            "jev_relation_distribution_json": json.dumps({"ASSOCIATED_WITH": 1.0}),
            "jev_label_confidence": 1.0,
        },
        "sourceGraphitiId": "entity-a",
        "targetGraphitiId": "entity-b",
        "endpointNodes": [
            {"graphitiId": "entity-a", "labels": ["Entity"], "properties": {"name": "Alpha"}},
            {"graphitiId": "entity-b", "labels": ["Entity"], "properties": {"name": "Beta"}},
        ],
    }]])
    episode = {"uuid": "episode-1", "source_url": "https://example.test/source"}

    monkeypatch.setattr(
        knowgraph_exact_reads,
        "knowgraph_driver",
        lambda: (driver, "neo4j"),
    )
    monkeypatch.setattr(
        knowgraph_exact_reads,
        "read_knowgraph_episodes_exact",
        lambda project_id, ids: [episode]
        if project_id == "project-1" and ids == ["episode-1"] else [],
    )
    record = read_knowgraph_exact(
        "project-1",
        "graphitiRelationshipId",
        "fact-malformed",
    )

    assert record is not None
    assert record["graphitiRelationshipId"] == "fact-malformed"
    assert record["properties"]["name"] == "supports"
    assert record["properties"]["fact"] == "Alpha supports Beta."
    assert record["sourceId"] == "entity-a"
    assert record["targetId"] == "entity-b"
    assert record["provenance"]["episodes"] == [episode]
    assert "portableKind" not in record
    assert "know" not in record
    assert "jev" not in record
    assert driver.closed is True
