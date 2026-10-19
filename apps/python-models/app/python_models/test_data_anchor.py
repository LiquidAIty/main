"""Focused contracts for bounded Data Anchor materialization."""

# Entity: Data Anchors
# Relationship: This file verifies selected graph references materialize bounded provider data and stable references, deduplicate repeated payloads, populate projections, and fail closed when required records are missing.

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.python_models import data_anchor, engraphis
from app.python_models.data_anchor import (
    empty_graph_projection,
    resolve_data_anchors,
)
from app.python_models.data_anchor_contract import DataAnchorError, json_safe
from app.python_models.thinkgraph_reference_reads import read_thinkgraph_exact


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
