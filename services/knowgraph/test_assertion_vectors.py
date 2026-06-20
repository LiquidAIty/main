"""Unit tests for the KnowGraph source-summary vector capability (Python rails).

No live Neo4j and no live embedding endpoint are required: a fake driver routes
the fixed Cypher over in-memory fixtures and records every executed query, and
the EmbeddingGemma transport is mocked. These prove:

* the local embedding client posts only to the /embeddings path, validates the
  dimension, and fails honestly (never fabricates a vector);
* retrieval_summary is built from existing source-backed fields only (no LLM);
* the vector index is scoped to (:SourceBackedAssertion) and never the :Chunk index;
* backfill is project-scoped, embeds only missing/changed assertions, skips
  text-less ones, writes only the new vector properties (never outcome/source),
  and propagates endpoint outages honestly; and
* read paths run no write clauses and preserve sourceRef + source title/url.
"""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest import mock

import assertion_vectors
import embeddinggemma
from assertion_vectors import (
    ASSERTION_VECTOR_INDEX_NAME,
    WRITE_CLAUSE_RE,
    backfill_assertion_embeddings,
    build_retrieval_summary,
    count_assertions,
    ensure_assertion_vector_index,
    read_assertion_vectors,
    scan_assertions,
    summary_content_hash,
)


def _result(rows):
    return SimpleNamespace(records=list(rows), summary=None)


def _scan_row(**overrides):
    base = {
        "id": "assert-rdw",
        "subject": "Redwire Corporation",
        "predicate": "has_ticker_symbol",
        "object": "RDW",
        "outcome": "supported",
        "evidence_text": "Redwire Corporation (RDW) Stock Quote - NYSE ticker symbol",
        "source_ref": "s1",
        "source_title": "Redwire Corporation (RDW) Stock Quote - NYSE ticker symbol",
        "source_url": "https://finance.yahoo.com/quote/RDW",
        "existing_hash": None,
        "existing_dim": None,
        "has_embedding": False,
        "linked_source_title": "Redwire Corporation (RDW) Stock Quote - NYSE ticker symbol",
        "linked_source_url": "https://finance.yahoo.com/quote/RDW",
    }
    base.update(overrides)
    return base


SPACEX_ROW = _scan_row(
    id="assert-spacex",
    subject="SpaceX",
    predicate="has_current_valuation",
    object="unknown",
    outcome="uncertain",
    evidence_text="SpaceX private company valuation news on the secondary market",
    source_ref="s3",
    source_title="SpaceX private company valuation news on the secondary market",
    source_url="https://forgeglobal.com/spacex",
    linked_source_title="SpaceX private company valuation news on the secondary market",
    linked_source_url="https://forgeglobal.com/spacex",
)

NO_TEXT_ROW = _scan_row(
    id="assert-empty",
    subject="X",
    predicate="y",
    object="z",
    evidence_text=None,
    source_title=None,
    linked_source_title=None,
)


class FakeDriver:
    """Routes the capability's fixed Cypher over in-memory fixtures."""

    def __init__(self, *, scan_rows=None, index_rows=None, readback_rows=None,
                 count_n=0, write_error_ids=None):
        self.scan_rows = scan_rows or []
        self.index_rows = index_rows or []
        self.readback_rows = readback_rows or []
        self.count_n = count_n
        self.write_error_ids = set(write_error_ids or [])
        self.calls: list[tuple[str, dict]] = []

    def execute_query(self, cypher, parameters_=None, database_=None, **kwargs):
        params = dict(parameters_ or {})
        params.update(kwargs)
        self.calls.append((cypher, params))
        if "SHOW VECTOR INDEXES" in cypher:
            return _result(self.index_rows)
        if "DROP INDEX" in cypher or "CREATE VECTOR INDEX" in cypher:
            return _result([])
        if "SET a.retrieval_summary" in cypher:
            if params.get("id") in self.write_error_ids:
                raise RuntimeError("simulated write failure")
            return _result([{"id": params.get("id")}])
        if "size(a.embedding)" in cypher:
            return _result(self.readback_rows)
        if "count(a)" in cypher:
            return _result([{"n": self.count_n}])
        if "AS has_embedding" in cypher:
            return _result(self.scan_rows)
        raise AssertionError(f"unrouted cypher: {cypher[:70]}")

    def close(self):
        pass

    def cyphers(self):
        return [cypher for cypher, _ in self.calls]


def fake_embed(texts):
    """Deterministic 768-dim vectors, one per text."""
    return [[round(0.001 * (i + 1), 4)] * 768 for i, _ in enumerate(texts)]


# --------------------------------------------------------------------------- #
# EmbeddingGemma client
# --------------------------------------------------------------------------- #
class EmbeddingGemmaTests(unittest.TestCase):
    def test_embed_posts_to_embeddings_path_with_model_and_input(self):
        with mock.patch.object(embeddinggemma, "_http_post_json") as post:
            post.return_value = {"data": [{"index": 0, "embedding": [0.1] * 768}]}
            vectors = embeddinggemma.embed_texts(["Redwire RDW"], expected_dim=768)
        url, payload, _timeout = post.call_args.args
        self.assertTrue(url.endswith("/embeddings"))
        self.assertNotIn("chat", url)
        self.assertEqual(payload["model"], "ai/embeddinggemma")
        self.assertEqual(payload["input"], ["Redwire RDW"])
        self.assertEqual(len(vectors), 1)
        self.assertEqual(len(vectors[0]), 768)

    def test_batch_returns_one_vector_per_input_in_order(self):
        with mock.patch.object(embeddinggemma, "_http_post_json") as post:
            post.return_value = {"data": [
                {"index": 1, "embedding": [0.2] * 768},
                {"index": 0, "embedding": [0.1] * 768},
            ]}
            vectors = embeddinggemma.embed_texts(["a", "b"], expected_dim=768)
        self.assertEqual(vectors[0][0], 0.1)  # reordered by index
        self.assertEqual(vectors[1][0], 0.2)

    def test_wrong_dimension_fails_honestly(self):
        with mock.patch.object(embeddinggemma, "_http_post_json") as post:
            post.return_value = {"data": [{"index": 0, "embedding": [0.1] * 512}]}
            with self.assertRaisesRegex(embeddinggemma.EmbeddingGemmaError, "expected 768"):
                embeddinggemma.embed_texts(["x"], expected_dim=768)

    def test_endpoint_unreachable_raises(self):
        with mock.patch.object(embeddinggemma, "_http_post_json") as post:
            post.side_effect = embeddinggemma.EmbeddingGemmaError("unreachable")
            with self.assertRaises(embeddinggemma.EmbeddingGemmaError):
                embeddinggemma.embed_texts(["x"], expected_dim=768)

    def test_probe_dimension_does_not_assume(self):
        with mock.patch.object(embeddinggemma, "_http_post_json") as post:
            post.return_value = {"data": [{"index": 0, "embedding": [0.0] * 1024}]}
            self.assertEqual(embeddinggemma.probe_dimension(), 1024)

    def test_empty_input_returns_empty_without_calling_endpoint(self):
        with mock.patch.object(embeddinggemma, "_http_post_json") as post:
            self.assertEqual(embeddinggemma.embed_texts([]), [])
            post.assert_not_called()

    def test_blank_text_rejected(self):
        with self.assertRaises(embeddinggemma.EmbeddingGemmaError):
            embeddinggemma.embed_texts(["   "])

    def test_oversize_batch_rejected(self):
        with self.assertRaises(embeddinggemma.EmbeddingGemmaError):
            embeddinggemma.embed_texts(["x"] * (embeddinggemma.MAX_BATCH + 1))

    def test_default_endpoint_is_local_embeddings_not_chat(self):
        self.assertTrue(embeddinggemma.DEFAULT_EMBEDDINGS_URL.endswith("/embeddings"))
        self.assertNotIn("chat", embeddinggemma.DEFAULT_EMBEDDINGS_URL)
        self.assertTrue(assertion_vectors._endpoint_is_local(embeddinggemma.DEFAULT_EMBEDDINGS_URL))


# --------------------------------------------------------------------------- #
# retrieval_summary (existing evidence only, no LLM)
# --------------------------------------------------------------------------- #
class RetrievalSummaryTests(unittest.TestCase):
    def test_summary_uses_source_fields_and_triple(self):
        summary = build_retrieval_summary(_scan_row())
        self.assertIn("Redwire Corporation (RDW) Stock Quote", summary)
        self.assertIn("has_ticker_symbol", summary)
        self.assertIn("RDW", summary)

    def test_summary_omits_unknown_object_but_keeps_subject(self):
        summary = build_retrieval_summary(SPACEX_ROW)
        self.assertIn("SpaceX", summary)
        self.assertIn("has_current_valuation", summary)
        self.assertNotIn("unknown", summary.lower())

    def test_summary_is_deterministic_no_llm(self):
        self.assertEqual(build_retrieval_summary(_scan_row()), build_retrieval_summary(_scan_row()))

    def test_summary_none_when_no_source_text(self):
        self.assertIsNone(build_retrieval_summary(NO_TEXT_ROW))

    def test_content_hash_changes_with_summary(self):
        a = summary_content_hash("one")
        self.assertEqual(a, summary_content_hash("one"))
        self.assertNotEqual(a, summary_content_hash("two"))


# --------------------------------------------------------------------------- #
# vector index (separate from the :Chunk chunk_embedding_idx)
# --------------------------------------------------------------------------- #
class IndexTests(unittest.TestCase):
    def test_index_targets_assertion_label_only(self):
        driver = FakeDriver()
        name = ensure_assertion_vector_index(driver, 768)
        self.assertEqual(name, ASSERTION_VECTOR_INDEX_NAME)
        blob = "\n".join(driver.cyphers())
        self.assertIn("CREATE VECTOR INDEX kg_assertion_embedding_idx", blob)
        self.assertIn("(a:SourceBackedAssertion) ON (a.embedding)", blob)
        self.assertIn("'cosine'", blob)
        self.assertIn("`vector.dimensions`: 768", blob)
        # never touches the unrelated :Chunk index
        self.assertNotIn("Chunk", blob)
        self.assertNotIn("chunk_embedding_idx", blob)

    def test_index_recreated_when_dimension_differs(self):
        driver = FakeDriver(index_rows=[{"options": {"indexConfig": {"vector.dimensions": 512}}}])
        ensure_assertion_vector_index(driver, 768)
        blob = "\n".join(driver.cyphers())
        self.assertIn("DROP INDEX kg_assertion_embedding_idx", blob)
        self.assertIn("CREATE VECTOR INDEX kg_assertion_embedding_idx", blob)

    def test_index_not_dropped_when_dimension_matches(self):
        driver = FakeDriver(index_rows=[{"options": {"indexConfig": {"vector.dimensions": 768}}}])
        ensure_assertion_vector_index(driver, 768)
        self.assertNotIn("DROP INDEX", "\n".join(driver.cyphers()))


# --------------------------------------------------------------------------- #
# backfill
# --------------------------------------------------------------------------- #
class BackfillTests(unittest.TestCase):
    def test_backfill_is_project_scoped(self):
        driver = FakeDriver(scan_rows=[_scan_row()])
        backfill_assertion_embeddings(
            driver, "proj-A", limit=3, embed_fn=fake_embed, expected_dim=768
        )
        for cypher, params in driver.calls:
            if "AS has_embedding" in cypher or "SET a.retrieval_summary" in cypher:
                self.assertEqual(params.get("projectId"), "proj-A")

    def test_backfill_embeds_missing_and_writes_only_vector_props(self):
        driver = FakeDriver(scan_rows=[_scan_row(), SPACEX_ROW])
        calls = []

        def recording_embed(texts):
            calls.append(list(texts))
            return fake_embed(texts)

        report = backfill_assertion_embeddings(
            driver, "proj-A", limit=5, embed_fn=recording_embed, expected_dim=768
        )
        self.assertEqual(report["counts"]["embedded"], 2)
        self.assertEqual(report["counts"]["skipped_missing_text"], 0)
        self.assertEqual(report["dim"], 768)
        self.assertEqual(len(calls), 1)  # one bounded batch
        # write cypher only SETs the new vector props, never outcome/source/Source
        write_cyphers = [c for c in driver.cyphers() if "SET a.retrieval_summary" in c]
        self.assertEqual(len(write_cyphers), 2)
        for cypher in write_cyphers:
            self.assertIn("a.retrieval_summary", cypher)
            self.assertIn("a.embedding", cypher)
            self.assertIn("a.embedding_model", cypher)
            self.assertNotIn("a.outcome", cypher)
            self.assertNotIn("a.subject", cypher)
            self.assertNotIn("a.source_ref", cypher)
            self.assertNotIn("(s:Source", cypher)  # never touches the Source node
            self.assertNotIn("MERGE", cypher)
            self.assertNotIn("ASSERTED_BY_SOURCE", cypher)

    def test_backfill_skips_textless_assertion(self):
        driver = FakeDriver(scan_rows=[NO_TEXT_ROW])
        report = backfill_assertion_embeddings(
            driver, "proj-A", limit=5, embed_fn=fake_embed, expected_dim=768
        )
        self.assertEqual(report["counts"]["skipped_missing_text"], 1)
        self.assertEqual(report["counts"]["embedded"], 0)
        self.assertEqual([c for c in driver.cyphers() if "SET a.retrieval_summary" in c], [])

    def test_backfill_leaves_unchanged_assertions_alone(self):
        row = _scan_row()
        summary = build_retrieval_summary(row)
        row["existing_hash"] = summary_content_hash(summary)
        row["existing_dim"] = 768
        row["has_embedding"] = True
        driver = FakeDriver(scan_rows=[row])
        calls = []

        def recording_embed(texts):
            calls.append(list(texts))
            return fake_embed(texts)

        report = backfill_assertion_embeddings(
            driver, "proj-A", limit=5, embed_fn=recording_embed, expected_dim=768
        )
        self.assertEqual(report["counts"]["unchanged"], 1)
        self.assertEqual(report["counts"]["embedded"], 0)
        self.assertEqual(calls, [])  # nothing re-embedded
        self.assertEqual([c for c in driver.cyphers() if "SET a.retrieval_summary" in c], [])

    def test_backfill_propagates_endpoint_outage_without_writing(self):
        driver = FakeDriver(scan_rows=[_scan_row()])

        def broken_embed(texts):
            raise embeddinggemma.EmbeddingGemmaError("endpoint down")

        with self.assertRaises(embeddinggemma.EmbeddingGemmaError):
            backfill_assertion_embeddings(
                driver, "proj-A", limit=5, embed_fn=broken_embed, expected_dim=768
            )
        # no fake vector was written
        self.assertEqual([c for c in driver.cyphers() if "SET a.retrieval_summary" in c], [])

    def test_backfill_counts_db_write_failure(self):
        driver = FakeDriver(scan_rows=[_scan_row()], write_error_ids=["assert-rdw"])
        report = backfill_assertion_embeddings(
            driver, "proj-A", limit=5, embed_fn=fake_embed, expected_dim=768
        )
        self.assertEqual(report["counts"]["failed"], 1)
        self.assertEqual(report["counts"]["embedded"], 0)

    def test_backfill_requires_project(self):
        with self.assertRaises(assertion_vectors.AssertionVectorError):
            backfill_assertion_embeddings(FakeDriver(), "", limit=3, embed_fn=fake_embed)


# --------------------------------------------------------------------------- #
# read-back + read-only guarantee
# --------------------------------------------------------------------------- #
class ReadBackTests(unittest.TestCase):
    READBACK_ROW = {
        "id": "assert-rdw", "subject": "Redwire Corporation", "predicate": "has_ticker_symbol",
        "object": "RDW", "outcome": "supported",
        "retrieval_summary": "Redwire Corporation (RDW) Stock Quote — has_ticker_symbol RDW",
        "embedding_model": "ai/embeddinggemma", "embedding_dim": 768, "vector_size": 768,
        "source_ref": "s1", "source_title": "Redwire Corporation (RDW) Stock Quote - NYSE ticker symbol",
        "source_url": "https://finance.yahoo.com/quote/RDW",
    }

    def test_read_back_returns_summary_dim_outcome_and_source_linkage(self):
        driver = FakeDriver(readback_rows=[self.READBACK_ROW])
        rows = read_assertion_vectors(driver, "proj-A", limit=5)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["outcome"], "supported")
        self.assertEqual(row["vector_size"], 768)
        self.assertEqual(row["source_ref"], "s1")
        self.assertTrue(row["source_title"])
        self.assertEqual(row["source_url"], "https://finance.yahoo.com/quote/RDW")
        self.assertIn("RDW", row["retrieval_summary"])

    def test_read_back_cypher_traverses_asserted_by_source(self):
        driver = FakeDriver(readback_rows=[self.READBACK_ROW])
        read_assertion_vectors(driver, "proj-A", limit=5)
        cypher = driver.cyphers()[0]
        self.assertIn("ASSERTED_BY_SOURCE", cypher)
        self.assertIn("size(a.embedding)", cypher)
        self.assertIn("a.retrieval_summary", cypher)

    def test_scan_and_readback_run_no_write_clause(self):
        scan_driver = FakeDriver(scan_rows=[_scan_row()])
        scan_assertions(scan_driver, "proj-A", limit=3)
        read_driver = FakeDriver(readback_rows=[self.READBACK_ROW])
        read_assertion_vectors(read_driver, "proj-A", limit=3)
        count_driver = FakeDriver(count_n=2)
        count_assertions(count_driver, "proj-A")
        for driver in (scan_driver, read_driver, count_driver):
            for cypher in driver.cyphers():
                self.assertIsNone(WRITE_CLAUSE_RE.search(cypher), cypher)

    def test_count_assertions(self):
        self.assertEqual(count_assertions(FakeDriver(count_n=3), "proj-A"), 3)


if __name__ == "__main__":
    unittest.main()
