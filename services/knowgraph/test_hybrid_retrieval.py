"""Unit proof for the canonical :Chunk evidence reader (Path B)."""

from __future__ import annotations

import json
import unittest
from datetime import timezone
from types import SimpleNamespace

import hybrid_retrieval as hr
from neo4j.time import DateTime

PROJECT = "stagea-unit"
# Explicit scopes so unit tests never touch Postgres scope resolution.
SCOPES = [PROJECT]


def _result(rows):
    return SimpleNamespace(records=list(rows), summary=None)


def _chunk(chunk_id="chunk-1", **overrides):
    """A row shaped exactly as the Path B channels RETURN it (chunk = evidence)."""
    row = {
        "assertion_id": chunk_id,  # RETURN aliases chunk.chunk_id AS assertion_id
        "text": "A knowledge graph organizes entities and their relationships.",
        "assertion_kind": "source_chunk",
        "document_id": "doc-1",
        "chapter": None,
        "section": None,
        "pages": "chars 0-1400",
        "chunk_refs": [chunk_id],
        "epistemic_level": "source_text",
        "created_at": "2026-07-15T00:00:00Z",
        "source_title": "Building Knowledge Graphs",
        "source_url": "file:///corpus/book.pdf",
        "related_entities": [{"name": "Knowledge Graph", "labels": ["Concept"]}],
    }
    row.update(overrides)
    return row


class FakeDriver:
    # corpus_size defaults non-zero: a test describes a PREPARED corpus unless it
    # says otherwise, so the readiness probe is transparent to channel tests.
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
    values = dict(
        project_id=PROJECT,
        query="knowledge graph organizing principle",
        anchors=["knowledge graph"],
        project_scopes=list(SCOPES),
    )
    values.update(overrides)
    return hr.KnowGraphRetrievalRequest(**values)


class ContractTests(unittest.TestCase):
    def test_queries_are_read_only_and_target_the_chunk_corpus(self):
        hr.assert_all_read_only()
        blob = "\n".join(hr.all_cyphers())
        self.assertIn("chunk_embedding_idx", blob)
        self.assertIn("chunk_text_fulltext_idx", blob)
        self.assertIn("chunk.project_id IN $projectScopes", blob)
        # Path B: the dead assertion corpus and its invented trust flags are gone.
        self.assertNotIn("KnowledgeAssertion", blob)
        self.assertNotIn("SourceBackedAssertion", blob)
        self.assertNotIn("ka.trusted", blob)
        self.assertNotIn("knowledge_assertion_fulltext_idx", blob)

    def test_chunk_evidence_carries_real_provenance(self):
        driver = FakeDriver(vector=[_chunk()])
        result = hr.retrieve_knowgraph_context(_request(anchors=[]), driver=driver, embed_fn=fake_embed)
        self.assertEqual(result.retrieval_state, "evidence")
        self.assertEqual(result.assertions[0]["assertion_kind"], "source_chunk")
        self.assertEqual(result.assertions[0]["epistemic_level"], "source_text")
        self.assertEqual(result.evidence[0]["document_id"], "doc-1")
        self.assertEqual(result.evidence[0]["pages"], "chars 0-1400")
        self.assertEqual(result.evidence[0]["chunk_refs"], ["chunk-1"])
        # Mentioned entities become relations + next anchors, never the evidence.
        self.assertEqual(result.relations[0]["target"], "Knowledge Graph")

    def test_neo4j_datetime_is_iso_serialized_at_record_boundary(self):
        ingested_at = DateTime(
            2026, 7, 16, 1, 36, 8, 319_000_000, tzinfo=timezone.utc
        )
        driver = FakeDriver(
            vector=[
                _chunk(
                    created_at=ingested_at,
                    related_entities=[{"name": "Knowledge Graph", "labels": ["Concept"]}],
                )
            ]
        )

        result = hr.retrieve_knowgraph_context(
            _request(anchors=[]), driver=driver, embed_fn=fake_embed
        )
        payload = result.to_dict()

        self.assertEqual(payload["assertions"][0]["created_at"], ingested_at.iso_format())
        serialized = json.loads(json.dumps(payload))
        self.assertEqual(
            serialized["assertions"][0]["created_at"], ingested_at.iso_format()
        )
        self.assertEqual(
            hr._json_contract_value({"history": [ingested_at]}),
            {"history": [ingested_at.iso_format()]},
        )

    def test_vector_channel_applies_a_similarity_floor(self):
        driver = FakeDriver(vector=[_chunk()])
        hr.retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        vector_query, vector_params = next(
            (c, p) for c, p in driver.calls if "db.index.vector.queryNodes" in c
        )
        self.assertIn("score >= $scoreFloor", vector_query)
        self.assertEqual(vector_params["scoreFloor"], hr.VECTOR_SCORE_FLOOR)

    def test_fulltext_channel_applies_a_bm25_floor(self):
        driver = FakeDriver(fulltext=[_chunk()])
        hr.retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        ft_query, ft_params = next(
            (c, p) for c, p in driver.calls if "db.index.fulltext.queryNodes" in c
        )
        self.assertIn("score >= $ftFloor", ft_query)
        self.assertEqual(ft_params["ftFloor"], hr.FULLTEXT_SCORE_FLOOR)

    def test_channels_fuse_and_dedupe_by_chunk_id(self):
        same = _chunk()
        driver = FakeDriver(vector=[same], fulltext=[same], exact=[same])
        result = hr.retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        self.assertEqual(len(result.assertions), 1)
        self.assertEqual(
            set(result.assertions[0]["retrieval_reasons"]),
            {"semantic_chunk_match", "fulltext_match", "exact_anchor_match"},
        )

    def test_anchor_context_cannot_outrank_query_relevance(self):
        anchor_only = _chunk("anchor-only", text="Document title repeated throughout")
        substantive = _chunk(
            "substantive",
            text="Extracted facts retain source-document references for provenance.",
        )
        relevant_exact = _chunk(
            "relevant-exact",
            text="The anchor appears in a passage that also answers the query.",
        )

        fused = hr._fuse(
            {
                "vector": [substantive, relevant_exact],
                "fulltext": [substantive, relevant_exact],
                "exact": [anchor_only, relevant_exact],
            }
        )
        by_id = {candidate.record["assertion_id"]: candidate for candidate in fused}

        self.assertLess(by_id["anchor-only"].score, by_id["substantive"].score)
        self.assertEqual(by_id["anchor-only"].reasons, ["exact_anchor_match"])
        self.assertGreater(
            by_id["relevant-exact"].score,
            (1.0 / (hr.RRF_K + 2)) * 2,
        )
        self.assertEqual(
            by_id["relevant-exact"].ranks,
            {"vector": 2, "fulltext": 2, "exact": 2},
        )

    def test_empty_result_is_structured_and_not_failure(self):
        result = hr.retrieve_knowgraph_context(_request(), driver=FakeDriver(), embed_fn=fake_embed)
        self.assertEqual(result.retrieval_state, "empty")
        self.assertEqual(result.assertions, [])
        self.assertIn("no evidence found", result.retrieval_notes)
        self.assertTrue(result.retryable)

    def test_missing_fulltext_index_does_not_erase_vector_evidence(self):
        class NoFulltextDriver(FakeDriver):
            def execute_query(self, cypher, parameters_=None, database_=None, **kwargs):
                if "db.index.fulltext.queryNodes" in cypher:
                    self.calls.append((cypher, dict(parameters_ or {})))
                    raise RuntimeError(f"NoSuchIndexException: {hr.CHUNK_FULLTEXT_INDEX}")
                return super().execute_query(cypher, parameters_, database_, **kwargs)

        driver = NoFulltextDriver(vector=[_chunk()])
        result = hr.retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        self.assertEqual(result.retrieval_state, "evidence")
        self.assertFalse(result.retrieval_modes["fulltext"])
        self.assertTrue(any("fulltext channel unavailable" in n for n in result.retrieval_notes))

    def test_runtime_failure_is_not_returned_as_empty(self):
        with self.assertRaisesRegex(hr.HybridRetrievalError, "retrieval query failed"):
            hr.retrieve_knowgraph_context(_request(), driver=FakeDriver(fail=True), embed_fn=fake_embed)

    def test_embedding_failure_has_no_channel_fallback(self):
        def fail(_texts):
            raise RuntimeError("provider down")

        with self.assertRaisesRegex(hr.HybridRetrievalError, "query embedding failed"):
            hr.retrieve_knowgraph_context(_request(), driver=FakeDriver(), embed_fn=fail)

    def test_scopes_and_prior_ids_reach_every_channel(self):
        driver = FakeDriver()
        request = _request(prior_assertion_ids=["seen"], prior_source_refs=["doc-seen"])
        hr.retrieve_knowgraph_context(request, driver=driver, embed_fn=fake_embed)
        channels = [(c, p) for c, p in driver.calls if "corpus_size" not in c]
        self.assertTrue(channels)
        for _cypher, params in channels:
            self.assertEqual(params["projectScopes"], SCOPES)
            self.assertEqual(params["priorIds"], ["seen"])
            self.assertEqual(params["priorRefs"], ["doc-seen"])

    def test_query_embedding_dimension_is_enforced(self):
        with self.assertRaisesRegex(hr.HybridRetrievalError, "dimension mismatch"):
            hr.retrieve_knowgraph_context(
                _request(), driver=FakeDriver(), embed_fn=lambda _texts: [[0.1] * 3]
            )


class ScopeResolutionTests(unittest.TestCase):
    def test_explicit_scopes_bypass_postgres(self):
        # project_scopes set => resolve_project_scopes is never called (no DB).
        driver = FakeDriver(vector=[_chunk()])
        hr.retrieve_knowgraph_context(
            _request(project_id="app-uuid", project_scopes=["canonical-scope"]),
            driver=driver,
            embed_fn=fake_embed,
        )
        _cypher, params = next((c, p) for c, p in driver.calls if "queryNodes" in c)
        self.assertEqual(params["projectScopes"], ["canonical-scope"])

    def test_readiness_counts_chunks_across_all_scopes(self):
        driver = FakeDriver(corpus_size=0)
        hr.retrieve_knowgraph_context(
            _request(project_scopes=["s1", "s2"]), driver=driver, embed_fn=fake_embed
        )
        _cypher, params = driver.calls[0]
        self.assertIn("corpus_size", _cypher)
        self.assertEqual(params["projectScopes"], ["s1", "s2"])


class CorpusReadinessTests(unittest.TestCase):
    """An unpopulated scope is UNAVAILABLE, not 'no evidence'."""

    def test_zero_chunks_returns_typed_unavailable_not_empty(self):
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
        self.assertLess(len(notes), 600)

    def test_readiness_probe_is_not_trust_filtered(self):
        self.assertNotIn("trusted", hr._CORPUS_READINESS_CYPHER)
        self.assertNotIn("superseded", hr._CORPUS_READINESS_CYPHER)


class LuceneTests(unittest.TestCase):
    def test_special_characters_are_escaped(self):
        query = hr.build_lucene_query(["A (B)"], "C+D")
        self.assertIn("\\(", query)
        self.assertIn("\\+", query)

    def test_stopwords_are_dropped_but_anchors_are_kept(self):
        # "off"/"the"/"of" carry no signal; the anchor phrase always survives.
        query = hr.build_lucene_query(["submarine cable"], "cable off the coast of Peru")
        self.assertIn('"submarine cable"', query)
        self.assertNotIn("OR off", query)
        self.assertNotIn("OR the", query)
        self.assertIn("coast", query)
        self.assertIn("Peru", query)


if __name__ == "__main__":
    unittest.main()
