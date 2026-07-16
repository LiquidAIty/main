from __future__ import annotations

import asyncio
import os
from unittest.mock import patch

import pytest

from analysis import (
    AnalysisOptions,
    AnalysisRequest,
    AnalysisStatement,
    SourceScope,
    _persist_result,
    analyze_infranodus,
    analyze_local,
    normalize_infranodus_result,
)


def request(*, window: int = 3, phrases: list[str] | None = None) -> AnalysisRequest:
    return AnalysisRequest(
        request_id="fixture-request",
        project_id="fixture-project",
        source_scope=SourceScope(project_id="fixture-project"),
        persist=False,
        options=AnalysisOptions(
            window_size=window,
            distance_weighting="flat",
            minimum_topic_frequency=1,
            minimum_edge_weight=1,
            use_default_stopwords=True,
            phrases=phrases or [],
            community_seed=7,
            gateway_threshold=0,
        ),
    )


def statement(statement_id: str, text: str, *, concepts: list[str] | None = None) -> AnalysisStatement:
    return AnalysisStatement(
        statement_id=statement_id,
        text=text,
        source_document_ref="know:document:fixture",
        provenance_refs=[f"know:chunk:{statement_id}"],
        approved_concepts=concepts or [],
    )


def edge_by_labels(result, left: str, right: str):
    ids = {node.label: node.id for node in result.nodes}
    pair = {ids[left], ids[right]}
    return next((edge for edge in result.edges if {edge.source, edge.target} == pair), None)


def test_repeated_nearby_concepts_increase_edge_weight() -> None:
    result = analyze_local(request(window=3), [statement("s1", "graph memory graph memory")])
    edge = edge_by_labels(result, "graph", "memory")
    assert edge is not None
    assert edge.weight == 3
    assert edge.occurrences == 3


def test_concepts_outside_window_do_not_create_edge() -> None:
    result = analyze_local(request(window=2), [statement("s1", "alpha middle omega")])
    assert edge_by_labels(result, "alpha", "omega") is None


def test_stopwords_do_not_become_topics() -> None:
    result = analyze_local(request(), [statement("s1", "the graph and the network")])
    assert {node.label for node in result.nodes} == {"graph", "network"}


def test_explicit_and_canonical_multiword_phrases_remain_intact() -> None:
    explicit = analyze_local(request(phrases=["knowledge graph"]), [statement("s1", "knowledge graph supports retrieval")])
    canonical = analyze_local(request(), [statement("s1", "graph neural network retrieval", concepts=["graph neural network"])])
    assert "knowledge graph" in {node.label for node in explicit.nodes}
    assert "graph neural network" in {node.label for node in canonical.nodes}


def test_every_topic_has_canonical_statement_provenance() -> None:
    result = analyze_local(request(), [statement("chunk-1", "graph evidence provenance")])
    assert result.provenance_refs == ["know:chunk:chunk-1"]
    assert all(node.supporting_statement_ids for node in result.nodes)


def test_community_and_gateway_output_is_reproducible() -> None:
    statements = [
        statement("s1", "alpha beta gamma alpha beta"),
        statement("s2", "delta epsilon zeta delta epsilon"),
        statement("s3", "gamma bridge delta"),
    ]
    first = analyze_local(request(window=3), statements)
    second = analyze_local(request(window=3), statements)
    assert first.communities == second.communities
    assert first.conceptual_gateways == second.conceptual_gateways
    assert first.configuration_hash == second.configuration_hash
    assert first.analysis_id == second.analysis_id


def test_gap_candidate_references_separated_communities() -> None:
    statements = [
        statement("s1", "alpha beta alpha beta"),
        statement("s2", "gamma delta gamma delta"),
        statement("s3", "beta connector gamma"),
        statement("s4", "alpha connector delta"),
    ]
    result = analyze_local(request(window=2), statements)
    assert all(gap.source_community != gap.target_community for gap in result.content_gap_candidates)
    assert all(gap.path_length >= 2 and len(gap.path) >= 3 for gap in result.content_gap_candidates)


def test_external_result_normalizes_to_the_same_contract() -> None:
    req = request()
    req.requested_provider = "infranodus_mcp"
    req.external_provider_permission = True
    result = normalize_infranodus_result(
        req,
        [statement("s1", "alpha beta")],
        {
            "statistics": {"nodes": 2, "edges": 1, "modularity": 0.2},
            "mainConcepts": ["alpha", "beta"],
            "conceptualGateways": ["alpha"],
            "graph": {
                "nodes": [{"id": "a", "label": "alpha"}, {"id": "b", "label": "beta"}],
                "edges": [{"source": "a", "target": "b", "weight": 2}],
            },
        },
        12.5,
    )
    assert result.schema_version == "knowgraph.analysis.v1"
    assert result.provider == "infranodus_mcp"
    assert result.node_count == 2
    assert result.edge_count == 1
    assert result.raw_provider_result_ref.startswith("sha256:")


def test_external_unavailable_is_an_error_not_local_success() -> None:
    req = request()
    req.requested_provider = "infranodus_mcp"
    req.external_provider_permission = True
    with patch.dict(os.environ, {}, clear=True):
        with pytest.raises(RuntimeError, match="INFRANODUS_MCP_COMMAND_JSON"):
            asyncio.run(analyze_infranodus(req, [statement("s1", "alpha beta")]))


class RecordingDriver:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def execute_query(self, query: str, **parameters):
        self.calls.append((query, parameters))
        return ([], None, None)

    def close(self) -> None:
        raise AssertionError("borrowed driver must not be closed")


def test_analysis_persistence_never_overwrites_canonical_graph() -> None:
    statements = [statement("s1", "alpha beta")]
    result = analyze_local(request(), statements)
    driver = RecordingDriver()
    _persist_result(result, statements, driver)
    query = driver.calls[0][0]
    assert "MERGE (run:KnowGraphAnalysisRun" in query
    assert "SET chunk" not in query
    assert "SET doc" not in query
    assert "MERGE (chunk" not in query
    assert driver.calls[0][1]["statement_ids"] == ["s1"]
