"""Unit tests for KnowGraph hybrid retrieval (Python rails).

No live Neo4j and no live embedding endpoint: a fake driver routes each fixed
Cypher shape to in-memory fixtures and records calls; the embedder is injected.
These prove project scoping, source-identity preservation across channels,
honest per-channel unavailability, rank-based fusion, dedupe/diversity, bounded
one-hop expansion, and that no query shape contains a write clause.
"""

from __future__ import annotations

import unittest
from types import SimpleNamespace

import hybrid_retrieval as hr
from hybrid_retrieval import (
    KnowGraphRetrievalRequest,
    WRITE_CLAUSE_RE,
    assert_all_read_only,
    build_lucene_query,
    lucene_escape,
    retrieve_knowgraph_context,
    _fuse,
)

PROJECT = "20ac92da-01fd-4cf6-97cc-0672421e751a"


def _result(rows):
    return SimpleNamespace(records=list(rows), summary=None)


def _assertion(**overrides):
    base = {
        "id": "a-rdw", "subject": "Redwire Corporation", "predicate": "has_ticker_symbol",
        "object": "RDW", "outcome": "supported",
        "evidence_text": "Redwire Corporation (RDW) Stock Quote - NYSE ticker symbol",
        "retrieval_summary": "Redwire Corporation (RDW) Stock Quote — has_ticker_symbol RDW",
        "source_ref": "s1", "source_title": "Redwire Corporation (RDW) Stock Quote - NYSE ticker symbol",
        "source_url": "https://finance.yahoo.com/quote/RDW",
    }
    base.update(overrides)
    return base


RDW = _assertion()
RWE = _assertion(id="a-rwe", object="RWE", outcome="contradicted", source_ref="s2",
                 source_title="Redwire Space trades under ticker symbol RWE on the exchange",
                 source_url="https://example.com/redwire-rwe")
SPACEX = _assertion(id="a-spacex", subject="SpaceX", predicate="has_current_valuation",
                    object="unknown", outcome="uncertain", source_ref="s3",
                    source_title="SpaceX private company valuation news on the secondary market",
                    source_url="https://forgeglobal.com/spacex")


class FakeDriver:
    def __init__(self, *, exact=None, fulltext_assertion=None, fulltext_source=None,
                 vector=None, expansion=None, fulltext_raises=False, vector_raises=False):
        self.exact = exact or []
        self.fulltext_assertion = fulltext_assertion or []
        self.fulltext_source = fulltext_source or []
        self.vector = vector or []
        self.expansion = expansion or []
        self.fulltext_raises = fulltext_raises
        self.vector_raises = vector_raises
        self.calls: list[tuple[str, dict]] = []

    def execute_query(self, cypher, parameters_=None, database_=None, **kwargs):
        params = dict(parameters_ or {})
        params.update(kwargs)
        self.calls.append((cypher, params))
        if "queryNodes('kg_assertion_fulltext'" in cypher:
            if self.fulltext_raises:
                raise RuntimeError("no such fulltext index")
            return _result(self.fulltext_assertion)
        if "queryNodes('kg_source_fulltext'" in cypher:
            if self.fulltext_raises:
                raise RuntimeError("no such fulltext index")
            return _result(self.fulltext_source)
        if "queryNodes('kg_assertion_embedding_idx'" in cypher:
            if self.vector_raises:
                raise RuntimeError("vector index dimension mismatch")
            return _result(self.vector)
        if "CONTRADICTS" in cypher and "collect(DISTINCT" in cypher:
            return _result(self.expansion)
        if "CONTAINS anchor" in cypher:
            return _result(self.exact)
        raise AssertionError(f"unrouted cypher: {cypher[:60]}")

    def close(self):
        pass

    def cyphers(self):
        return [c for c, _ in self.calls]


def fake_embed(texts):
    return [[0.01] * 768 for _ in texts]


def _request(**overrides):
    base = dict(project_id=PROJECT, query="Redwire RDW SpaceX evidence and contradictions",
                anchors=["Redwire Corporation", "RDW", "SpaceX"], max_results=12)
    base.update(overrides)
    return KnowGraphRetrievalRequest(**base)


class LuceneTests(unittest.TestCase):
    def test_escapes_special_chars(self):
        escaped = lucene_escape('AT&T (NYSE: T) +foo')
        for ch in ["(", ")", ":", "+"]:
            self.assertIn("\\" + ch, escaped)

    def test_build_query_quotes_anchors_and_is_safe(self):
        q = build_lucene_query(['Redwire Corporation', 'RDW'], 'ticker symbol (NYSE)')
        self.assertIn('"Redwire Corporation"', q)
        self.assertIn(" OR ", q)
        self.assertIn("\\(", q)  # the query paren is escaped

    def test_empty_inputs_match_any(self):
        self.assertEqual(build_lucene_query([], ""), "*")


class ReadOnlyTests(unittest.TestCase):
    def test_no_query_shape_contains_write_clause(self):
        assert_all_read_only()  # raises if any write clause present
        for cypher in hr.all_cyphers():
            self.assertIsNone(WRITE_CLAUSE_RE.search(cypher), cypher)


class FusionTests(unittest.TestCase):
    def test_rrf_uses_rank_not_raw_score(self):
        # vector channel pre-ordered [A, B]; A must outrank B purely by rank.
        fused = _fuse({"vector": [_assertion(id="A"), _assertion(id="B")]})
        self.assertAlmostEqual(fused["A"].rrf, 1.0 / (hr.RRF_K + 1))
        self.assertAlmostEqual(fused["B"].rrf, 1.0 / (hr.RRF_K + 2))
        self.assertGreater(fused["A"].rrf, fused["B"].rrf)

    def test_multi_channel_keeps_all_reasons(self):
        fused = _fuse({"exact": [RDW], "fulltext": [RDW], "vector": [RDW]})
        reasons = fused["a-rdw"].reasons
        self.assertIn("exact_anchor_match", reasons)
        self.assertIn("fulltext_match", reasons)
        self.assertIn("semantic_match", reasons)


class RetrievalTests(unittest.TestCase):
    def test_anchored_retrieval_is_project_scoped(self):
        driver = FakeDriver(exact=[RDW])
        retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        exact_calls = [(c, p) for c, p in driver.calls if "CONTAINS anchor" in c]
        self.assertTrue(exact_calls)
        for cypher, params in exact_calls:
            self.assertIn("project_id: $projectId", cypher)
            self.assertEqual(params["projectId"], PROJECT)

    def test_source_identity_survives_all_channels(self):
        driver = FakeDriver(exact=[RDW], fulltext_assertion=[RWE], vector=[SPACEX])
        result = retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        by_id = {a["id"]: a for a in result.assertions}
        self.assertEqual(set(by_id), {"a-rdw", "a-rwe", "a-spacex"})
        for a in result.assertions:
            self.assertTrue(a["source_ref"])
            self.assertTrue(a["source_title"])
            self.assertTrue(a["source_url"])
            self.assertIn(a["outcome"], ("supported", "contradicted", "uncertain"))
            self.assertTrue(a["retrieval_reasons"])

    def test_supported_contradicted_uncertain_all_present(self):
        driver = FakeDriver(exact=[RDW, RWE, SPACEX])
        result = retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        outcomes = {a["outcome"] for a in result.assertions}
        self.assertEqual(outcomes, {"supported", "contradicted", "uncertain"})
        self.assertTrue(result.uncertainties)
        self.assertEqual(result.uncertainties[0]["subject"], "SpaceX")

    def test_one_hop_contradiction_and_relations_surface(self):
        expansion = [{
            "source_id": "a-rdw",
            "contradicts": [{"id": "a-rwe", "subject": "Redwire Corporation",
                             "predicate": "has_ticker_symbol", "object": "RWE",
                             "outcome": "contradicted", "source_ref": "s2"}],
            "entities": [{"label": "Redwire Corporation", "id": "e1"}],
        }]
        driver = FakeDriver(exact=[RDW], expansion=expansion)
        result = retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        self.assertEqual(result.contradictions[0]["contradicts_id"], "a-rwe")
        rel_types = {r["rel_type"] for r in result.relations}
        self.assertIn("CONTRADICTS", rel_types)
        self.assertIn("RELATES_TO_ENTITY", rel_types)

    def test_prior_refs_excluded_and_echoed(self):
        driver = FakeDriver(exact=[RDW])
        req = _request(prior_assertion_ids=["seen-1"], prior_source_refs=["seen-ref"])
        result = retrieve_knowgraph_context(req, driver=driver, embed_fn=fake_embed)
        # passed to every channel as exclusion params
        for cypher, params in driver.calls:
            if "CONTAINS anchor" in cypher or "queryNodes" in cypher:
                self.assertEqual(params["priorIds"], ["seen-1"])
                self.assertEqual(params["priorRefs"], ["seen-ref"])
        self.assertIn("seen-1", result.excluded_as_seen)
        self.assertIn("seen-ref", result.excluded_as_seen)

    def test_fulltext_unavailable_is_honest_others_still_work(self):
        driver = FakeDriver(exact=[RDW], vector=[SPACEX], fulltext_raises=True)
        result = retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        self.assertEqual(result.retrieval_modes["fulltext"], False)
        self.assertEqual(result.retrieval_modes["vector"], "available")
        self.assertTrue(any("fulltext_unavailable" in n for n in result.retrieval_notes))
        self.assertTrue(result.assertions)  # exact + vector still produced results

    def test_vector_unavailable_when_embedding_fails(self):
        def broken_embed(texts):
            raise hr.embeddinggemma.EmbeddingGemmaError("DMR down")

        driver = FakeDriver(exact=[RDW], fulltext_assertion=[RWE])
        result = retrieve_knowgraph_context(_request(), driver=driver, embed_fn=broken_embed)
        self.assertEqual(result.retrieval_modes["vector"], "unavailable")
        self.assertTrue(any("vector unavailable" in n for n in result.retrieval_notes))
        self.assertTrue(result.assertions)  # exact + fulltext still work

    def test_vector_unavailable_when_index_errors(self):
        driver = FakeDriver(exact=[RDW], vector_raises=True)
        result = retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        self.assertEqual(result.retrieval_modes["vector"], "unavailable")

    def test_results_are_bounded(self):
        many = [_assertion(id=f"a-{i}", source_ref=f"s-{i}",
                           source_url=f"https://d{i}.example.com/x") for i in range(40)]
        driver = FakeDriver(exact=many)
        result = retrieve_knowgraph_context(_request(max_results=5), driver=driver, embed_fn=fake_embed)
        self.assertLessEqual(len(result.assertions), 5)

    def test_duplicate_source_ref_is_downranked(self):
        dup_a = _assertion(id="a-1", source_ref="dup", source_url="https://x.com/a")
        dup_b = _assertion(id="a-2", source_ref="dup", source_url="https://x.com/a")
        driver = FakeDriver(exact=[dup_a, dup_b])
        result = retrieve_knowgraph_context(_request(), driver=driver, embed_fn=fake_embed)
        reasons_blob = " ".join(r for a in result.assertions for r in a["retrieval_reasons"])
        self.assertIn("duplicate_source_ref", reasons_blob)

    def test_vector_result_merges_into_output_shape(self):
        driver = FakeDriver(vector=[RDW])
        result = retrieve_knowgraph_context(_request(anchors=[]), driver=driver, embed_fn=fake_embed)
        self.assertEqual(result.assertions[0]["id"], "a-rdw")
        self.assertIn("semantic_match", result.assertions[0]["retrieval_reasons"])
        self.assertEqual(result.evidence[0]["source_url"], "https://finance.yahoo.com/quote/RDW")

    def test_expansion_cypher_is_bounded_one_hop(self):
        # The expansion shape caps collected neighbors and traverses a single hop.
        expansion_cypher = hr.EXPANSION_CYPHER.format(hop_cap=4)
        self.assertIn("[..4]", expansion_cypher)
        self.assertNotIn("*", expansion_cypher)  # no variable-length traversal


if __name__ == "__main__":
    unittest.main()
