"""Unit proof for the canonical Chunk -> KnowledgeAssertion reader."""

from __future__ import annotations

import unittest
from types import SimpleNamespace

import hybrid_retrieval as hr

PROJECT = "stagea-unit"


def _result(rows):
    return SimpleNamespace(records=list(rows), summary=None)


def _assertion(assertion_id="claim-1", **overrides):
    row = {
        "assertion_id": assertion_id,
        "text": "Stable identities prevent duplicate graph assertions.",
        "assertion_kind": "claim",
        "document_id": "doc-1",
        "chapter": "Foundations",
        "section": "Identity",
        "pages": "1",
        "chunk_refs": ["chunk-1"],
        "trusted": True,
        "status": "active",
        "created_at": "2026-07-15T00:00:00Z",
        "extraction_run": "run-1",
        "source_title": "Stage A pilot",
        "source_url": "https://example.test/stage-a",
        "related_entities": [{"name": "Stable identity", "labels": ["Concept"]}],
    }
    row.update(overrides)
    return row


class FakeDriver:
    # corpus_size defaults non-zero: every pre-existing test describes a PREPARED
    # corpus, so the readiness probe must be transparent to them.
    def __init__(self, *, vector=None, fulltext=None, exact=None, fail=False, corpus_size=7):
        self.vector = vector or []
        self.fulltext = fulltext or []
        self.exact = exact or []
        self.fail = fail
        self.corpus_size = corpus_size
        self.calls = []

    def execute_query(self, cypher, parameters_=None, database_=None, **kwargs):
        params = dict(parameters_ or {})
        params.update(kwargs)
        self.calls.append((cypher, params))
        # Answered before `fail`: a channel-level outage must still reach the
        # channel, which is exactly what the runtime-failure test asserts.
        if "corpus_size" in cypher:
            return _result([{"corpus_size": self.corpus_size}])
        if self.fail:
            raise RuntimeError("schema unavailable")
        if "db.index.vector.queryNodes" in cypher:
            return _result(self.vector)
        if "db.index.fulltext.queryNodes" in cypher:
            return _result(self.fulltext)
        if "CONTAINS anchor" in cypher:
            return _result(self.exact)
        raise AssertionError(cypher)

    def close(self):
        pass


def fake_embed(texts):
    return [[0.01] * hr.EMBEDDING_DIMENSIONS for _ in texts]


def _request(**overrides):
    values = dict(project_id=PROJECT, query="stable graph identity", anchors=["identity"])
    values.update(overrides)
    return hr.KnowGraphRetrievalRequest(**values)


class ContractTests(unittest.TestCase):
    def test_queries_are_read_only_and_apply_shared_trust_filter(self):
        hr.assert_all_read_only()
        blob = "\n".join(hr.all_cyphers())
        self.assertIn("chunk_embedding_idx", blob)
        self.assertIn("KnowledgeAssertion", blob)
        self.assertIn("ka.trusted = true", blob)
        self.assertIn("status, 'active') <> 'superseded'", blob)
        self.assertIn("extraction_mode, '') <> 'anchor'", blob)
        self.assertNotIn("SourceBackedAssertion", blob)
        self.assertNotIn("kg_assertion_embedding_idx", blob)

    def test_claim_reached_through_chunk_vector_hop_with_provenance(self):
        driver = FakeDriver(vector=[_assertion()])
        result = hr.retrieve_knowgraph_context(_request(anchors=[]), driver=driver, embed_fn=fake_embed)
        self.assertEqual(result.retrieval_state, "evidence")
        self.assertEqual(result.assertions[0]["assertion_kind"], "claim")
        self.assertEqual(result.assertions[0]["chunk_refs"], ["chunk-1"])
        self.assertEqual(result.evidence[0]["chapter"], "Foundations")
        vector_query = next(c for c, _ in driver.calls if "db.index.vector.queryNodes" in c)
        self.assertIn("(chunk)-[:MENTIONS]->(ka:KnowledgeAssertion)", vector_query)

    def test_fulltext_and_anchor_channels_fuse_and_dedupe_by_assertion_id(self):
        same = _assertion()
        driver = FakeDriver(vector=[same], fulltext=[same], exact=[same])
        result = hr.retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        self.assertEqual(len(result.assertions), 1)
        self.assertEqual(
            set(result.assertions[0]["retrieval_reasons"]),
            {"semantic_chunk_match", "fulltext_match", "exact_anchor_match"},
        )

    def test_empty_result_is_structured_and_not_failure(self):
        result = hr.retrieve_knowgraph_context(_request(), driver=FakeDriver(), embed_fn=fake_embed)
        self.assertEqual(result.retrieval_state, "empty")
        self.assertEqual(result.assertions, [])
        self.assertIn("no evidence found", result.retrieval_notes)
        # A prepared corpus that simply did not match stays retryable.
        self.assertTrue(result.retryable)


    def test_runtime_failure_is_not_returned_as_empty(self):
        with self.assertRaisesRegex(hr.HybridRetrievalError, "retrieval query failed"):
            hr.retrieve_knowgraph_context(_request(), driver=FakeDriver(fail=True), embed_fn=fake_embed)

    def test_embedding_failure_has_no_channel_fallback(self):
        def fail(_texts):
            raise RuntimeError("provider down")

        with self.assertRaisesRegex(hr.HybridRetrievalError, "query embedding failed"):
            hr.retrieve_knowgraph_context(_request(), driver=FakeDriver(), embed_fn=fail)

    def test_project_scope_and_prior_ids_reach_every_channel(self):
        driver = FakeDriver()
        request = _request(prior_assertion_ids=["seen"], prior_source_refs=["doc-seen"])
        hr.retrieve_knowgraph_context(request, driver=driver, embed_fn=fake_embed)
        # The readiness probe is a scope COUNT, not a retrieval channel, so it
        # carries projectId only. Every actual channel still gets the full scope.
        channels = [(c, p) for c, p in driver.calls if "corpus_size" not in c]
        self.assertTrue(channels)
        for _cypher, params in channels:
            self.assertEqual(params["projectId"], PROJECT)
            self.assertEqual(params["priorIds"], ["seen"])
            self.assertEqual(params["priorRefs"], ["doc-seen"])

    def test_query_embedding_dimension_is_enforced(self):
        with self.assertRaisesRegex(hr.HybridRetrievalError, "dimension mismatch"):
            hr.retrieve_knowgraph_context(
                _request(), driver=FakeDriver(), embed_fn=lambda _texts: [[0.1] * 3]
            )


class CorpusReadinessTests(unittest.TestCase):
    """PL-7: an unpopulated assertion corpus is UNAVAILABLE, not 'no evidence'."""

    def test_zero_assertion_nodes_returns_typed_unavailable_not_empty(self):
        result = hr.retrieve_knowgraph_context(
            _request(), driver=FakeDriver(corpus_size=0), embed_fn=fake_embed
        )
        self.assertEqual(result.retrieval_state, hr.CORPUS_UNPREPARED_STATE)
        self.assertNotEqual(result.retrieval_state, "empty")
        self.assertEqual(result.assertions, [])

    def test_unprepared_corpus_never_requests_an_embedding(self):
        def exploding_embed(_texts):
            raise AssertionError("embedding must not be requested for an unprepared corpus")

        result = hr.retrieve_knowgraph_context(
            _request(), driver=FakeDriver(corpus_size=0), embed_fn=exploding_embed
        )
        self.assertEqual(result.retrieval_state, hr.CORPUS_UNPREPARED_STATE)

    def test_unprepared_corpus_runs_no_retrieval_channel(self):
        driver = FakeDriver(corpus_size=0)
        hr.retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        # Exactly one query: the readiness COUNT. No vector/fulltext/exact channel.
        self.assertEqual(len(driver.calls), 1)
        self.assertIn("corpus_size", driver.calls[0][0])
        self.assertFalse(any("queryNodes" in cypher for cypher, _ in driver.calls))

    def test_unprepared_corpus_tells_the_caller_not_to_retry(self):
        result = hr.retrieve_knowgraph_context(
            _request(), driver=FakeDriver(corpus_size=0), embed_fn=fake_embed
        )
        self.assertFalse(result.retryable)
        self.assertFalse(result.to_dict()["retryable"])
        notes = " ".join(result.retrieval_notes)
        self.assertIn(hr.CORPUS_UNPREPARED_ERROR, notes)
        self.assertIn("Do not retry", notes)

    def test_unprepared_notes_are_bounded_and_actionable(self):
        result = hr.retrieve_knowgraph_context(
            _request(), driver=FakeDriver(corpus_size=0), embed_fn=fake_embed
        )
        notes = " ".join(result.retrieval_notes)
        self.assertIn(f":{hr.ASSERTION_LABEL}", notes)
        self.assertIn("matching_nodes=0", notes)
        self.assertIn(PROJECT, notes)
        self.assertIn("remediation", notes)
        # Bounded: a diagnosis, not a schema dump into the model's context.
        self.assertLess(len(notes), 600)

    def test_readiness_probe_is_scoped_to_the_requested_project(self):
        driver = FakeDriver(corpus_size=0)
        hr.retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        _cypher, params = driver.calls[0]
        self.assertEqual(params["projectId"], PROJECT)

    def test_readiness_probe_is_not_trust_filtered(self):
        # A corpus whose rows are all untrusted/superseded is PREPARED; that is a
        # real "empty" answer, so readiness must not apply the trust filter.
        self.assertNotIn("ka.trusted", hr._CORPUS_READINESS_CYPHER)
        self.assertNotIn("superseded", hr._CORPUS_READINESS_CYPHER)


class LuceneTests(unittest.TestCase):
    def test_special_characters_are_escaped(self):
        query = hr.build_lucene_query(["A (B)"], "C+D")
        self.assertIn("\\(", query)
        self.assertIn("\\+", query)


if __name__ == "__main__":
    unittest.main()
