from __future__ import annotations

# Entity: Project Knowledge Graph
# Relationship: This file verifies exact Entity-directory reads and bounded Relevant plus distinct Recent context from separate graph authorities.
# Entity: ThinkGraph
# Relationship: This file verifies exact Engraphis Entity references return bounded Recent and Relevant Thinks.
# Entity: KnowGraph
# Relationship: This file verifies exact Graphiti Entity references return bounded Recent and Relevant two-sided Knows.
# Entity: Jev Decisions
# Relationship: This file verifies stale or nonexact Entity references are rejected before bounded relevance ranking.
# Entity: Tool Catalog
# Relationship: This file verifies the two Project graph read operations expose exact read-only definitions and schemas.

import pytest

from app import project_graph_operations
from app.python_models import engraphis, knowgraph_exact_reads, project_graph_relevance


def _directory() -> dict:
    return {
        "schemaVersion": "graph-entity-directory",
        "projectId": "project-1",
        "complete": True,
        "counts": {"engraphis": 1, "graphiti": 1, "total": 1},
        "revisions": {"engraphis": "think-rev", "graphiti": "know-rev"},
        "entities": [{
            "canonicalName": "Rocket Lab",
            "authority": "both",
            "engraphisEntityId": "eng-1",
            "graphitiEntityId": "graph-1",
        }],
        "sha256": "a" * 64,
        "bytes": 100,
        "estimatedTokens": 25,
        "readDurationMs": 1.0,
    }


def test_project_graph_definitions_expose_exact_list_and_context_reads() -> None:
    definitions = project_graph_operations.project_graph_operation_definitions(
        frozenset({"external-mcp"})
    )

    assert [definition.canonical_id for definition in definitions] == [
        "project_graph.list_entities",
        "project_graph.read_entity_context",
    ]
    assert all(definition.access == "read" for definition in definitions)
    assert all(definition.annotations["readOnlyHint"] is True for definition in definitions)
    assert "entityKind" not in str([definition.parameters_schema for definition in definitions])


def test_read_entity_context_returns_one_most_relevant_and_one_distinct_recent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        project_graph_operations,
        "build_canonical_entity_directory",
        lambda _project_id: _directory(),
    )
    monkeypatch.setattr(
        engraphis,
        "read_entity_thinks",
        lambda project, entity_id, limit: [{
            "memory_id": f"think-{index}",
            "entity_id": entity_id,
            "content": f"Think {index}",
            "valid_from": index,
            "valid_to": None,
            "ingested_at": index,
        } for index in range(1, limit + 1)],
    )
    monkeypatch.setattr(
        project_graph_relevance,
        "build_project_graph_grounding",
        lambda project, query, context="", **_kwargs: {
            "querySha256": "b" * 64,
            "revision": "c" * 64,
            "authorities": {
                "thinkgraph": {
                    "relevanceStatus": "success",
                    "decisionId": "decision-one",
                    "recent": [{
                        "engraphisMemoryId": "think-1",
                        "engraphisEntityId": "eng-1",
                        "body": "Think 1",
                    }],
                    "relevant": [{
                        "engraphisMemoryId": f"think-relevant-{index}",
                        "engraphisEntityId": "eng-1",
                        "body": f"Relevant Think {index}",
                        "relevance": 0.7 - index / 10,
                        "relevanceRank": index,
                    } for index in (1,)],
                },
                "knowgraph": {
                    "relevanceStatus": "success",
                    "decisionId": "decision-one",
                    "recent": [{
                        "graphitiEpisodeId": "know-1",
                        "graphitiEntityId": "graph-1",
                        "idea": {
                            "body": "For 1",
                            "citations": [{"url": "https://example.test/for-1"}],
                        },
                        "counterIdea": {
                            "body": "Against 1",
                            "citations": [{"url": "https://example.test/against-1"}],
                        },
                    }],
                    "relevant": [{
                        "graphitiEpisodeId": f"know-relevant-{index}",
                        "graphitiEntityId": "graph-1",
                        "idea": {
                            "body": f"Relevant For {index}",
                            "citations": [{
                                "url": f"https://example.test/relevant-for-{index}",
                            }],
                        },
                        "counterIdea": {
                            "body": f"Relevant Against {index}",
                            "citations": [{
                                "url": f"https://example.test/relevant-against-{index}",
                            }],
                        },
                        "relevance": 0.7 - index / 10,
                        "relevanceRank": index,
                    } for index in (1,)],
                },
            },
        },
    )
    monkeypatch.setattr(
        knowgraph_exact_reads,
        "read_knowgraph_entity_knows",
        lambda project, entity_id, limit: [{
            "graphitiEpisodeId": f"know-{index}",
            "graphitiEntityId": entity_id,
            "idea": {
                "body": f"For {index}",
                "citations": [{"url": f"https://example.test/for-{index}"}],
            },
            "counterIdea": {
                "body": f"Against {index}",
                "citations": [{"url": f"https://example.test/against-{index}"}],
            },
            "validFrom": index,
            "ingestedAt": index,
        } for index in range(1, limit + 1)],
    )

    entity = _directory()["entities"][0]
    result = project_graph_operations.read_entity_context(
        projectId="project-1",
        entities=[entity],
        query="current request",
    )

    assert result["directorySha256"] == "a" * 64
    assert len(result["entities"]) == 1
    context = result["entities"][0]
    assert [think["engraphisMemoryId"] for think in context["thinks"]["recent"]] == [
        "think-1",
    ]
    assert [think["engraphisMemoryId"] for think in context["thinks"]["relevant"]] == [
        "think-relevant-1",
    ]
    assert [know["graphitiEpisodeId"] for know in context["knows"]["recent"]] == [
        "know-1",
    ]
    assert [know["graphitiEpisodeId"] for know in context["knows"]["relevant"]] == [
        "know-relevant-1",
    ]
    assert len(result["querySha256"]) == 64
    assert len(result["groundingRevision"]) == 64
    assert result["limit"] == 1


def test_read_entity_context_rejects_non_exact_or_stale_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        project_graph_operations,
        "build_canonical_entity_directory",
        lambda _project_id: _directory(),
    )

    with pytest.raises(ValueError, match="entity_reference_not_current_or_exact"):
        project_graph_operations.read_entity_context(
            projectId="project-1",
            entities=[{
                **_directory()["entities"][0],
                "canonicalName": "rocket lab",
            }],
            query="current request",
        )
