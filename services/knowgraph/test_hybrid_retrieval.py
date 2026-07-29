"""Deterministic tests for Graphiti-only KnowGraph retrieval."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

import hybrid_retrieval as hr


def _request(**overrides):
    values = {
        "project_id": "project-1",
        "query": "What changed?",
        "anchors": ["Entity A"],
        "max_results": 2,
        "project_scopes": ["project-1"],
    }
    values.update(overrides)
    return hr.KnowGraphRetrievalRequest(**values)


def _fact(
    *,
    assertion_id: str = "fact-1",
    status: str = "current",
) -> dict:
    return {
        "assertion_id": assertion_id,
        "text": "Entity A now uses Entity B.",
        "assertion_kind": "temporal_fact",
        "document_id": "doc-1",
        "chapter": None,
        "section": None,
        "pages": None,
        "chunk_refs": ["episode-1"],
        "epistemic_level": "graphiti_temporal_fact",
        "created_at": datetime(2026, 7, 1, tzinfo=timezone.utc),
        "source_title": "Source title",
        "source_url": "https://example.test/source",
        "related_entities": [
            {"name": "Entity A", "labels": ["Entity"]},
            {"name": "Entity B", "labels": ["Entity"]},
        ],
        "valid_at": "2026-07-01T00:00:00+00:00",
        "invalid_at": (
            "2026-07-02T00:00:00+00:00"
            if status == "superseded"
            else None
        ),
        "expired_at": None,
        "temporal_status": status,
        "retrieval_score": 0.9,
    }


class GraphitiRetrievalTests(unittest.TestCase):
    def test_every_cypher_is_read_only_and_has_no_legacy_chunk_path(self):
        hr.assert_all_read_only()
        joined = "\n".join(hr.all_cyphers())
        self.assertNotIn(":Chunk", joined)
        self.assertNotIn("chunk_embedding_idx", joined)
        self.assertNotIn("KnowledgeAssertion", joined)

    def test_empty_graphiti_corpus_fails_closed_without_fake_evidence(self):
        calls = []

        def search(**kwargs):
            calls.append(kwargs)
            return 0, []

        result = hr.retrieve_knowgraph_context(
            _request(),
            graphiti_search_fn=search,
        )

        self.assertEqual(result.retrieval_state, hr.CORPUS_UNPREPARED_STATE)
        self.assertFalse(result.retryable)
        self.assertEqual(result.assertions, [])
        self.assertEqual(calls[0]["scopes"], ["project-1"])

    def test_graphiti_fact_preserves_source_temporal_and_entity_context(self):
        result = hr.retrieve_knowgraph_context(
            _request(),
            graphiti_search_fn=lambda **_: (1, [_fact()]),
        )

        self.assertEqual(result.retrieval_state, "evidence")
        self.assertFalse(result.retryable)
        self.assertEqual(result.assertions[0]["id"], "fact-1")
        self.assertEqual(
            result.evidence[0]["source_url"],
            "https://example.test/source",
        )
        self.assertEqual(result.evidence[0]["episode_refs"], ["episode-1"])
        self.assertEqual(result.next_anchor_suggestions, ["Entity A", "Entity B"])
        self.assertEqual(result.contradictions, [])

    def test_superseded_fact_remains_visible_as_history(self):
        result = hr.retrieve_knowgraph_context(
            _request(),
            graphiti_search_fn=lambda **_: (
                1,
                [_fact(status="superseded")],
            ),
        )

        self.assertEqual(result.retrieval_state, "evidence")
        self.assertEqual(result.contradictions[0]["status"], "superseded")
        self.assertEqual(
            result.contradictions[0]["assertion_id"],
            "fact-1",
        )

    def test_result_cap_and_omitted_count_are_enforced(self):
        rows = [_fact(assertion_id=f"fact-{index}") for index in range(5)]
        result = hr.retrieve_knowgraph_context(
            _request(max_results=2),
            graphiti_search_fn=lambda **_: (5, rows),
        )

        self.assertEqual(len(result.assertions), 2)
        self.assertEqual(result.omitted_neighbor_count, 3)

    def test_prior_identities_and_attached_scopes_reach_graphiti(self):
        captured = {}

        def search(**kwargs):
            captured.update(kwargs)
            return 1, []

        result = hr.retrieve_knowgraph_context(
            _request(
                project_scopes=["project-1", "research-scope"],
                prior_assertion_ids=["fact-old"],
                prior_source_refs=["doc-old"],
            ),
            graphiti_search_fn=search,
        )

        self.assertEqual(
            captured["scopes"],
            ["project-1", "research-scope"],
        )
        self.assertEqual(captured["prior_ids"], ["fact-old"])
        self.assertEqual(captured["prior_refs"], ["doc-old"])
        self.assertEqual(result.retrieval_state, "empty")
        self.assertTrue(result.retryable)

    def test_graphiti_failure_is_explicit(self):
        def fail(**_kwargs):
            raise RuntimeError("neo4j unavailable")

        with self.assertRaisesRegex(
            hr.HybridRetrievalError,
            "neo4j unavailable",
        ):
            hr.retrieve_knowgraph_context(
                _request(),
                graphiti_search_fn=fail,
            )

    def test_missing_query_and_anchor_is_rejected(self):
        with self.assertRaisesRegex(
            hr.HybridRetrievalError,
            "query or anchor is required",
        ):
            hr.retrieve_knowgraph_context(
                _request(query="", anchors=[]),
                graphiti_search_fn=lambda **_: (0, []),
            )


if __name__ == "__main__":
    unittest.main()
