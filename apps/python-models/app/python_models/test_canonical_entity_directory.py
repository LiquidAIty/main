"""Focused contracts for the complete cross-authority Entity directory."""

# Entity: Project Knowledge Graph
# Relationship: This file verifies the complete shared directory preserves provider identities, rejects incomplete or ambiguous inputs, and joins only exact canonical-name bytes.
# Entity: ThinkGraph
# Relationship: This file verifies all Engraphis identities and their source revision remain present without truncation.
# Entity: KnowGraph
# Relationship: This file verifies all Graphiti identities and their source revision remain present without truncation.

from __future__ import annotations

import pytest

from app.python_models.canonical_entity_directory import (
    assemble_canonical_entity_directory,
)
from app.python_models.data_anchor_contract import (
    GRAPH_CONTEXT_BYTE_LIMIT,
    DataAnchorError,
)


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
def test_entity_directory_exact_name_merge_preserves_provider_ids_and_authority() -> None:
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
