from __future__ import annotations

from datetime import datetime, timezone
import json
import pytest


from app.python_models.canonical_entity_directory import (
    append_canonical_entity_directory,
    assemble_canonical_entity_directory,
)
from app.python_models.data_anchor import (
    empty_graph_projection,
    resolve_data_anchors,
)
from app.python_models.data_anchor_contract import (
    GRAPH_CONTEXT_BYTE_LIMIT,
    DataAnchorError,
    json_safe,
)
from app.python_models.codegraph_reference_reads import read_codegraph_exact
from app.python_models.knowgraph_exact_reads import (
    read_knowgraph_entity_knows,
    read_knowgraph_episodes_exact,
    read_knowgraph_exact,
)
from app.python_models.knowgraph_projection_reads import (
    read_knowgraph_neighborhood,
    read_knowgraph_projection,
)
from app.python_models.thinkgraph_reference_reads import read_thinkgraph_exact
from app.python_models import (
    codegraph_reference_reads,
    data_anchor,
    engraphis,
    knowgraph_exact_reads,
    knowgraph_projection_reads,
    thinkgraph_reference_reads,
)


def test_data_anchor_json_normalization_uses_python_datetime_contract() -> None:
    value = datetime(2026, 10, 8, 12, 34, 56, tzinfo=timezone.utc)

    assert json_safe(value) == "2026-10-08T12:34:56+00:00"


@pytest.fixture
def engraphis_graph(tmp_path, monkeypatch):
    from engraphis.service import MemoryService
    # Engraphis persistence/relationship fixture; hash embedding is not semantic proof.
    service = MemoryService.create(str(tmp_path / "memory.sqlite"), embed_model="hash",
                                   extractor="none", graph_extractor="none")
    monkeypatch.setattr(engraphis, "_service", service)
    first = service.remember("Current Engraphis graph content", workspace="project-1", title="Current fact")["id"]
    second = service.remember("Project-scoped Engraphis engine content", workspace="project-1", title="Engraphis memory")["id"]
    service.link(first, second, workspace="project-1", relation="supports", reason="Retained Engraphis evidence")
    yield service, first, second
    service.close()


def test_exact_thinkgraph_read_is_project_scoped_and_read_only(engraphis_graph) -> None:
    service, first, _ = engraphis_graph
    before = service.store.conn.total_changes
    record = read_thinkgraph_exact("project-1", "engraphisMemoryId", first)

    assert record is not None
    assert record["engraphisMemoryId"] == first
    assert record["content"] == "Current Engraphis graph content"
    assert read_thinkgraph_exact(
        "other-project", "engraphisMemoryId", first,
    ) is None
    assert service.store.conn.total_changes == before


def test_exact_thinkgraph_read_accepts_project_scoped_engraphis_id(engraphis_graph) -> None:
    _, _, second = engraphis_graph
    record = read_thinkgraph_exact("project-1", "engraphisMemoryId", second)

    assert record is not None
    assert record["engraphisMemoryId"] == second
    assert record["recordId"] == second
    assert record["content"] == "Project-scoped Engraphis engine content"


def test_think_handoff_prefers_self_contained_thinks_and_keeps_engraphis_evidence(
    monkeypatch,
) -> None:
    provider_payload = {
        "entity": {
            "canonical_id": "entity-one",
            "type": "person_or_concept",
            "label": "Jev",
            "member_ids": ["entity-one"],
            "relations": [],
            "history": [],
            "truncation": {"relations": False, "evidence": False, "history": False},
            "evidence": [
                {
                    "memory_id": "mem_think",
                    "excerpt": "Self-contained structured Think.",
                    "metadata": {"thinkgraph_origin": {"authority": "thinkgraph"}},
                },
                {
                    "memory_id": "mem_other",
                    "excerpt": "Other Engraphis evidence.",
                    "metadata": {"provenance": {"source": "test"}},
                },
            ],
        }
    }
    monkeypatch.setattr(
        thinkgraph_reference_reads,
        "private_operation",
        lambda *_args, **_kwargs: provider_payload,
    )

    record = read_thinkgraph_exact(
        "project-1", "engraphisEntityId", "entity-one",
    )

    assert "portableKind" not in record
    assert record["content"] == "Self-contained structured Think."
    assert [item["memory_id"] for item in record["metadata"]["thinks"]] == [
        "mem_think"
    ]
    assert [item["memory_id"] for item in record["metadata"]["evidence"]] == [
        "mem_other"
    ]


def test_required_anchor_materializes_real_data_and_stable_reference(engraphis_graph) -> None:
    _, first, _ = engraphis_graph
    seed, references = resolve_data_anchors(
        "project-1",
        [{
            "engraphisMemoryId": first,
            "reason": "start from the current fact",
            "boundedExpansion": 0,
            "required": True,
        }],
    )

    assert "Current Engraphis graph content" in seed
    assert "Selection reason (guidance, not verified fact)" in seed
    assert "Verified provider content" in seed
    assert references[0]["engraphisMemoryId"] == first
    assert references[0]["label"] == "Current fact"
    assert references[0]["selectionScope"] == {"boundedExpansion": 0}
    assert references[0]["materializedContentBytes"] == len(
        "Current Engraphis graph content".encode("utf-8")
    )


def test_exact_repeated_provider_payload_is_rendered_once_without_losing_distinct_records(
    monkeypatch,
) -> None:
    shared_metadata = {"thinkgraph_origin": {
        "authority": "thinkgraph", "body": "x" * 2_000,
    }}

    def read(_project_id, _deck_id, _card_id, anchor, **_kwargs):
        entity_id = anchor["engraphisEntityId"]
        distinct = entity_id == "entity-three"
        return {
            "graphSystem": "engraphis", "engraphisEntityId": entity_id,
            "recordKind": "entity", "type": "person_or_concept", "title": entity_id,
            "content": "different content" if distinct else "same exact content " * 40,
            "metadata": (
                {"thinkgraph_origin": {
                    "authority": "thinkgraph", "body": "different",
                }}
                if distinct else shared_metadata
            ),
            "provenance": {"engine": "engraphis", "memberIds": [entity_id]},
            "asOf": "current", "readOperation": "graph_entity",
            "relationshipEvidence": [], "resultLimit": 1, "truncated": False,
        }

    monkeypatch.setattr(data_anchor, "_read_exact_anchor_record", read)
    anchors = [{
        "engraphisEntityId": entity_id,
        "reason": f"select {entity_id}", "boundedExpansion": 0,
        "required": True,
    } for entity_id in ("entity-one", "entity-two", "entity-three")]
    seed, references = resolve_data_anchors("project-1", anchors)

    assert [reference["engraphisEntityId"] for reference in references] == [
        "entity-one", "entity-two", "entity-three",
    ]
    assert seed.count("\"body\":\"" + "x" * 2_000 + "\"") == 1
    assert seed.count(("same exact content " * 40).strip()) == 1
    assert '"engraphisEntityId":"entity-one"' in seed
    assert "different content" in seed and '"body":"different"' in seed
    assert len({reference["materializedRecordSha256"] for reference in references}) == 3


class _FakeNeo4jResult:
    def __init__(self, rows):
        self._rows = rows

    def data(self):
        return self._rows


def test_thinkgraph_memory_reference_does_not_materialize_memory_nodes(engraphis_graph):
    service, first, second = engraphis_graph
    before = service.store.conn.total_changes
    projection = empty_graph_projection("project-1")
    text, refs = resolve_data_anchors("project-1", [{
        "engraphisMemoryId": first, "reason": "Use related evidence",
        "boundedExpansion": 1, "resultLimit": 2, "required": True,
    }], graph_projection=projection)
    assert projection["nodes"] == []
    assert projection["edges"] == []
    assert first in text and second in text and "supports" in text
    assert refs[0]["engraphisMemoryId"] == first
    assert service.store.conn.total_changes == before
    bounded = read_thinkgraph_exact(
        "project-1", "engraphisMemoryId", first,
        bounded_expansion=1, result_limit=1,
    )
    assert bounded["relationshipEvidence"] == [] and bounded["truncated"] is True


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
    assert "evidence" not in nodes["entity-b"]["properties"]
    assert all("ABOUT" in query for query, _params in driver.calls if "episode:Episodic" in query
               and "entity:Entity" in query)
    assert all("MENTIONS" not in query for query, _params in driver.calls)


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


def _entity(
    graph_system: str,
    index: int,
    *,
    canonical_name: str | None = None,
) -> dict[str, str]:
    id_field = (
        "engraphisEntityId" if graph_system == "ThinkGraph" else "graphitiEntityId"
    )
    return {
        id_field: f"{graph_system.lower()}-{index:03d}",
        "canonicalName": canonical_name or f"Entity {graph_system} {index:03d}",
    }


def test_complete_entity_directory_keeps_all_37_plus_11_identities_without_truncation() -> None:
    directory = assemble_canonical_entity_directory(
        "project-1",
        {"complete": True, "count": 37, "revision": "think-r1",
         "entities": [_entity("ThinkGraph", index) for index in range(37)]},
        {"complete": True, "count": 11, "revision": "know-r1",
         "entities": [_entity("KnowGraph", index) for index in range(11)]},
        read_duration_ms=12.3456,
    )

    assert directory["schemaVersion"] == "graph-entity-directory"
    assert directory["complete"] is True
    assert directory["counts"] == {"engraphis": 37, "graphiti": 11, "total": 48}
    assert directory["revisions"] == {
        "engraphis": "think-r1", "graphiti": "know-r1",
    }
    assert len(directory["entities"]) == 48
    assert all(
        set(entity) in (
            {"engraphisEntityId", "canonicalName", "authority"},
            {"graphitiEntityId", "canonicalName", "authority"},
        )
        for entity in directory["entities"]
    )
    assert directory["bytes"] > 0
    assert directory["estimatedTokens"] == (directory["bytes"] + 3) // 4
    assert directory["bytes"] < GRAPH_CONTEXT_BYTE_LIMIT
    assert directory["readDurationMs"] == 12.346
    model_context = append_canonical_entity_directory("", directory)
    assert "Complete Cross-Graph Entity Directory" in model_context
    assert "Entity ThinkGraph 036" in model_context
    assert "Entity KnowGraph 010" in model_context


def test_entity_directory_exact_name_merge_preserves_native_ids_and_authority() -> None:
    directory = assemble_canonical_entity_directory(
        "project-1",
        {"complete": True, "count": 2, "revision": "think-r1", "entities": [
            _entity("ThinkGraph", 1, canonical_name="Rocket Lab"),
            _entity("ThinkGraph", 2, canonical_name="Electron"),
        ]},
        {"complete": True, "count": 2, "revision": "know-r1", "entities": [
            _entity("KnowGraph", 1, canonical_name="Rocket Lab"),
            _entity("KnowGraph", 2, canonical_name="NASA"),
        ]},
    )

    assert directory["counts"] == {"engraphis": 2, "graphiti": 2, "total": 3}
    assert directory["entities"] == [
        {
            "canonicalName": "Electron",
            "engraphisEntityId": "thinkgraph-002",
            "authority": "thinkgraph",
        },
        {
            "canonicalName": "NASA",
            "graphitiEntityId": "knowgraph-002",
            "authority": "knowgraph",
        },
        {
            "canonicalName": "Rocket Lab",
            "engraphisEntityId": "thinkgraph-001",
            "graphitiEntityId": "knowgraph-001",
            "authority": "both",
        },
    ]


@pytest.mark.parametrize(
    "mutate,error",
    [
        (lambda source: source.update(complete=False), "authority_incomplete"),
        (lambda source: source.update(count=2), "authority_invalid"),
    ],
)
def test_entity_directory_rejects_incomplete_or_count_mismatch(
    mutate,
    error: str,
) -> None:
    think = {"complete": True, "count": 1, "revision": "think-r1",
             "entities": [_entity("ThinkGraph", 1)]}
    mutate(think)
    with pytest.raises(DataAnchorError, match=error):
        assemble_canonical_entity_directory(
            "project-1", think,
            {"complete": True, "count": 0, "revision": "know-empty", "entities": []},
        )


def test_entity_directory_rejects_duplicate_authority_provider_identity() -> None:
    duplicate = _entity("ThinkGraph", 1)
    with pytest.raises(DataAnchorError, match="entity_duplicate"):
        assemble_canonical_entity_directory(
            "project-1",
            {"complete": True, "count": 2, "revision": "think-r1",
             "entities": [duplicate, dict(duplicate)]},
            {"complete": True, "count": 0, "revision": "know-empty", "entities": []},
        )


@pytest.mark.parametrize(
    "malformed",
    [
        {
            "engraphisEntityId": "think-001",
            "graphitiEntityId": "know-001",
            "canonicalName": "Dual identity",
        },
        {
            "canonicalName": "Missing identity",
        },
    ],
)
def test_entity_directory_source_rejects_dual_or_missing_provider_id(
    malformed: dict[str, str],
) -> None:
    with pytest.raises(DataAnchorError, match="entity_invalid"):
        assemble_canonical_entity_directory(
            "project-1",
            {"complete": True, "count": 1, "revision": "think-r1",
             "entities": [malformed]},
            {"complete": True, "count": 0, "revision": "know-empty", "entities": []},
        )


def test_entity_directory_rejects_ambiguous_same_authority_canonical_name() -> None:
    first = _entity("ThinkGraph", 1)
    second = {**_entity("ThinkGraph", 2), "canonicalName": first["canonicalName"]}
    with pytest.raises(DataAnchorError, match="entity_name_duplicate"):
        assemble_canonical_entity_directory(
            "project-1",
            {"complete": True, "count": 2, "revision": "think-r1",
             "entities": [first, second]},
            {"complete": True, "count": 0, "revision": "know-empty", "entities": []},
        )


def test_entity_directory_preserves_writer_canonical_name_bytes() -> None:
    think = _entity("ThinkGraph", 1)
    know = _entity("KnowGraph", 1)
    think["canonicalName"] = "  Writer-preserved Entity  "
    know["canonicalName"] = "Writer-preserved Entity"

    directory = assemble_canonical_entity_directory(
        "project-1",
        {"complete": True, "count": 1, "revision": "think-r1",
         "entities": [think]},
        {"complete": True, "count": 1, "revision": "know-r1",
         "entities": [know]},
    )

    assert [item["canonicalName"] for item in directory["entities"]] == [
        "  Writer-preserved Entity  ", "Writer-preserved Entity",
    ]


def test_entity_directory_rejects_combined_context_over_existing_limit() -> None:
    directory = assemble_canonical_entity_directory(
        "project-1",
        {"complete": True, "count": 0, "revision": "think-empty", "entities": []},
        {"complete": True, "count": 0, "revision": "know-empty", "entities": []},
    )
    with pytest.raises(DataAnchorError, match="data_anchor_seed_limit_exceeded"):
        append_canonical_entity_directory("x" * GRAPH_CONTEXT_BYTE_LIMIT, directory)


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


def test_provider_projection_contains_only_ids_returned_in_model_bound_graph_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = {
        "graphSystem": "graphiti",
        "graphitiEntityId": "entity-1",
        "recordKind": "entity",
        "type": "Entity",
        "title": "Alpha",
        "content": "current sourced Alpha record",
        "properties": {"name": "Alpha"},
        "relationshipEvidence": [{
            "nodes": [
                {"graphitiId": "entity-1", "labels": ["Entity"], "properties": {"name": "Alpha"}},
                {"graphitiId": "entity-2", "labels": ["Entity"], "properties": {"name": "Beta"}},
            ],
            "relationships": [{
                "graphitiId": "fact-1",
                "type": "SUPPORTS",
                    "sourceId": "entity-1",
                    "targetId": "entity-2",
                "properties": {"source": "primary"},
            }],
        }],
        "provenance": {"source": "primary"},
        "asOf": "current",
        "readOperation": "neo4j.project_scoped_exact",
        "resultLimit": 8,
        "truncated": False,
    }
    monkeypatch.setattr(
        data_anchor,
        "read_knowgraph_exact",
        lambda *_args, **_kwargs: record,
    )
    projection = empty_graph_projection("project-1")
    seed, references = resolve_data_anchors(
        "project-1",
            [{
                "graphitiEntityId": "entity-1",
            "reason": "start from sourced evidence",
            "boundedExpansion": 1,
            "resultLimit": 8,
            "required": True,
        }],
        graph_projection=projection,
    )

    assert {node["id"] for node in projection["nodes"]} == {"entity-1", "entity-2"}
    assert [(edge["id"], edge["source"], edge["target"]) for edge in projection["edges"]] == [
        ("fact-1", "entity-1", "entity-2"),
    ]
    assert all(graphiti_id in seed for graphiti_id in ("entity-1", "entity-2", "fact-1"))
    assert references[0]["graphitiEntityId"] == "entity-1"


def test_codegraph_exact_read_uses_official_mcp_calls_and_qualified_symbol(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed = {}

    def reader(**kwargs):
        observed.update(kwargs)
        return [
            {
                "qualified_name": "project.module.materialize_idf",
                "name": "materialize_idf",
                "label": "Function",
                "file_path": "C:/Projects/LiquidAIty/main/apps/python-models/app/python_models/idf.py",
                "start_line": 37,
                "end_line": 78,
                "source": "def materialize_idf():\n    pass",
                "signature": "()",
                "fp": "current-fingerprint",
            },
            {"callers": [{"qualified_name": "project.module.caller"}], "callees": []},
        ]

    monkeypatch.setattr(
        codegraph_reference_reads,
        "call_materializer_read_tools",
        reader,
    )
    record = read_codegraph_exact(
        "project-1",
        "deck_builder",
        "card_helper",
        "project.module.materialize_idf",
        bounded_expansion=1,
    )

    assert record is not None
    assert record["cbmQualifiedName"] == "project.module.materialize_idf"
    assert record["properties"]["file"] == "apps/python-models/app/python_models/idf.py"
    assert record["relationshipEvidence"]["callers"][0]["qualified_name"].endswith("caller")
    assert [name for name, _args in observed["calls"]] == [
        "cbm.get_code_snippet", "cbm.trace_path",
    ]
    assert all(arguments["format"] == "json" for _, arguments in observed["calls"])


def test_codegraph_exact_read_normalizes_provider_grouped_trace_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reader(**_kwargs):
        return [
            {
                "qualified_name": "project.module.materialize_idf",
                "name": "materialize_idf",
                "label": "Function",
                "file_path": "apps/python-models/app/python_models/idf.py",
                "source": "def materialize_idf():\n    pass",
            },
            {
                "callers": {
                    "cols": ["name", "hop"],
                    "groups": [{
                        "qn_prefix": "project.module",
                        "rows": [["caller", 1]],
                    }],
                },
                "callees": {"cols": ["name", "hop"], "groups": []},
            },
        ]

    monkeypatch.setattr(
        codegraph_reference_reads,
        "call_materializer_read_tools",
        reader,
    )
    record = read_codegraph_exact(
        "project-1",
        "deck_builder",
        "card_helper",
        "project.module.materialize_idf",
        bounded_expansion=1,
    )

    assert record is not None
    assert record["relationshipEvidence"]["callers"] == [{
        "name": "caller",
        "hop": 1,
        "qualified_name": "project.module.caller",
    }]


def test_missing_required_anchor_fails_before_provider(engraphis_graph, monkeypatch) -> None:
    monkeypatch.setattr(
        data_anchor,
        "read_knowgraph_exact",
        lambda *_args, **_kwargs: None,
    )
    with pytest.raises(DataAnchorError, match="data_anchor_required_not_found"):
        resolve_data_anchors("project-1", [{
            "graphitiEpisodeId": "episode:one", "reason": "required",
            "boundedExpansion": 0, "required": True,
        }])
    with pytest.raises(DataAnchorError, match="data_anchor_required_not_found"):
        resolve_data_anchors("project-1", [{
            "engraphisMemoryId": "missing", "reason": "required",
            "boundedExpansion": 0, "required": True,
        }])
