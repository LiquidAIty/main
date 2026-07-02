"""Offline unit tests for the research-memory delta loop (Python rails).

No live Neo4j / Postgres / Gemma / embeddings: fake drivers + injected chunk/
embed functions prove the truth/provenance rules, the KnowGraph vs ThinkGraph
write boundary, that only retained material reaches the local chunker, that local
vectors preserve parent/source/store refs, and that the local-index stage has no
cloud fallback and no second frontier call. Live end-to-end proof lives in
research_memory_delta_probe.py.
"""

from __future__ import annotations

import inspect
import unittest
from types import SimpleNamespace

import gemma_chunker
import research_memory_delta as rmd
from research_memory_delta import (
    DeltaAssertion,
    Observation,
    ResearchMemoryDelta,
    RetainedChunkInput,
    SourceRef,
    index_retained_material,
    validate_delta,
    write_knowgraph_external,
)


def _result(rows):
    return SimpleNamespace(records=list(rows), summary=None)


def _delta(**over):
    base = dict(
        project_id="p", run_id="r1", research_summary="summary",
        project_consequence="consequence",
        assertions=[DeltaAssertion("Redwire", "has_ticker_symbol", "RDW", "supported",
                                   evidence_text="RDW NYSE quote", source_ref="s1",
                                   source_url="https://finance.yahoo.com/quote/RDW")],
    )
    base.update(over)
    return ResearchMemoryDelta(**base)


class FakeNeo4jDriver:
    def __init__(self, readback=None):
        self.calls = []
        self.readback = readback or []

    def execute_query(self, cypher, parameters_=None, database_=None, **kw):
        params = dict(parameters_ or {})
        params.update(kw)
        self.calls.append((cypher, params))
        if "RETURN a.id AS id, a.subject" in cypher:
            return _result(self.readback)
        if "SHOW VECTOR INDEXES" in cypher:
            return _result([])
        return _result([{"id": "x"}])

    def close(self):
        pass

    def cyphers(self):
        return [c for c, _ in self.calls]


# --------------------------------------------------------------------------- #
# truth / provenance validation
# --------------------------------------------------------------------------- #
class ValidationTests(unittest.TestCase):
    def test_valid_delta_passes(self):
        self.assertTrue(validate_delta(_delta()).ok)

    def test_external_assertion_without_source_is_rejected(self):
        v = validate_delta(_delta(assertions=[DeltaAssertion("X", "y", "z", "supported")]))
        self.assertFalse(v.ok)
        self.assertTrue(any("external_without_source" in e for e in v.errors))

    def test_unknown_outcome_is_rejected_not_coerced(self):
        v = validate_delta(_delta(assertions=[DeltaAssertion("X", "y", "z", "true", source_ref="s")]))
        self.assertFalse(v.ok)
        self.assertTrue(any("unknown_outcome" in e for e in v.errors))

    def test_hypothesis_is_kept_as_interpretation_not_fact(self):
        v = validate_delta(_delta(assertions=[
            DeltaAssertion("SpaceX", "has_current_valuation", "unknown", "unresolved",
                           interpretation="no dated figure grounded"),
        ]))
        self.assertTrue(v.ok)  # interpretation allowed without a source
        self.assertEqual(len(v.interpretation_assertions), 1)
        self.assertEqual(len(v.evidence_assertions), 0)
        self.assertEqual(v.interpretation_assertions[0].kind, "interpretation")

    def test_missing_required_fields_rejected(self):
        self.assertFalse(validate_delta(_delta(project_id="")).ok)
        self.assertFalse(validate_delta(_delta(research_summary="")).ok)


# --------------------------------------------------------------------------- #
# KnowGraph write: source refs survive, no project-meaning / signal records
# --------------------------------------------------------------------------- #
class KnowGraphWriteTests(unittest.TestCase):
    def test_source_refs_carried_into_write_and_readback(self):
        readback = [{"id": "a0", "subject": "Redwire", "predicate": "has_ticker_symbol", "object": "RDW",
                     "outcome": "supported", "evidence_text": "RDW NYSE", "interpretation": "",
                     "source_ref": "s1", "source_title": "Redwire (RDW)", "source_url": "https://finance.yahoo.com/quote/RDW"}]
        driver = FakeNeo4jDriver(readback=readback)
        delta = _delta()
        v = validate_delta(delta)
        write_knowgraph_external(driver, delta, validation=v)
        write_params = [p for c, p in driver.calls if "SourceBackedAssertion" in c and "sourceRef" in p]
        self.assertTrue(any(p["sourceRef"] == "s1" and "yahoo" in p["sourceUrl"] for p in write_params))
        rows = rmd.read_knowgraph_external(driver, "p", "r1")
        self.assertEqual(rows[0]["source_ref"], "s1")
        self.assertTrue(rows[0]["source_url"])

    def test_knowgraph_write_has_no_thinkgraph_or_signal_records(self):
        driver = FakeNeo4jDriver()
        delta = _delta(observations=[Observation("obs", source_ref="s1", entity="Redwire")])
        write_knowgraph_external(driver, delta, validation=validate_delta(delta))
        blob = "\n".join(driver.cyphers())
        self.assertNotIn("ResearchNote", blob)      # project meaning is ThinkGraph-only
        self.assertNotIn("Candle", blob)
        self.assertNotIn("Signal", blob)
        self.assertIn("SourceBackedAssertion", blob)

    def test_module_cyphers_carry_no_chat_history_or_candles(self):
        source = inspect.getsource(rmd)
        for banned in ["Candle", "SignalBar", "chat_history", "chatHistory"]:
            self.assertNotIn(banned, source)


# --------------------------------------------------------------------------- #
# local index: retained-only input, refs preserved, no cloud fallback
# --------------------------------------------------------------------------- #
class LocalIndexTests(unittest.TestCase):
    def test_only_retained_material_is_sent_to_chunker(self):
        captured = []

        def spy_chunk(text):
            captured.append(text)
            return [text]

        delta = _delta(
            research_summary="THE USER ANSWER should not be chunked",
            retained_material=[RetainedChunkInput("retained evidence text", kind="source_evidence",
                                                  store="knowgraph", source_ref="s1")],
        )
        index_retained_material(FakeNeo4jDriver(), delta, chunk_fn=spy_chunk,
                                embed_fn=lambda texts: [[0.0] * 768 for _ in texts], expected_dim=768)
        self.assertEqual(captured, ["retained evidence text"])  # only retained material, not the answer

    def test_chunk_vectors_preserve_parent_source_store_refs(self):
        driver = FakeNeo4jDriver()
        delta = _delta(retained_material=[
            RetainedChunkInput("chunk text here", kind="source_evidence", store="knowgraph",
                               source_ref="s1", parent_id="parent-1")])
        index_retained_material(driver, delta, chunk_fn=lambda t: [t],
                                embed_fn=lambda texts: [[0.1] * 768 for _ in texts], expected_dim=768)
        chunk_writes = [p for c, p in driver.calls if "RetainedChunk" in c and "parentId" in p]
        self.assertTrue(chunk_writes)
        w = chunk_writes[0]
        self.assertEqual(w["parentId"], "parent-1")
        self.assertEqual(w["store"], "knowgraph")
        self.assertEqual(w["sourceRef"], "s1")
        self.assertEqual(w["indexingState"], "indexed")

    def test_embedding_failure_marks_pending_not_indexed_no_fallback(self):
        driver = FakeNeo4jDriver()
        delta = _delta(retained_material=[RetainedChunkInput("t", kind="research_note", store="thinkgraph")])

        def embed_unavailable(texts):
            raise rmd.embeddinggemma.EmbeddingGemmaError("DMR down")

        report = index_retained_material(driver, delta, chunk_fn=lambda t: [t],
                                         embed_fn=embed_unavailable, expected_dim=768)
        states = [p["indexingState"] for c, p in driver.calls if "RetainedChunk" in c]
        self.assertIn("pending", states)
        self.assertNotIn("indexed", states)  # never fake indexed
        self.assertEqual(report["counts"]["indexed"], 0)

    def test_orchestration_takes_no_frontier_model_client(self):
        params = set(inspect.signature(rmd.write_research_memory_delta).parameters)
        self.assertNotIn("model_client", params)
        self.assertIn("chunk_fn", params)
        self.assertIn("embed_fn", params)


# --------------------------------------------------------------------------- #
# local Gemma chunker: faithful, honest failure, no cloud fallback
# --------------------------------------------------------------------------- #
class GemmaChunkerTests(unittest.TestCase):
    def _transport(self, content):
        def t(url, payload, timeout):
            return {"choices": [{"message": {"content": content}}]}
        return t

    def test_faithful_chunks_pass(self):
        text = "Redwire trades on NYSE under RDW. SpaceX is private."
        out = gemma_chunker.chunk_text(text, transport=self._transport(
            '["Redwire trades on NYSE under RDW.", "SpaceX is private."]'))
        self.assertEqual(len(out), 2)

    def test_fabricated_content_is_rejected_no_fallback(self):
        with self.assertRaises(gemma_chunker.GemmaChunkerError):
            gemma_chunker.chunk_text("Redwire trades on NYSE under RDW.",
                                     transport=self._transport('["SpaceX has ticker SPCE worth $200B"]'))

    def test_unreachable_endpoint_fails_honestly(self):
        def boom(url, payload, timeout):
            raise gemma_chunker.GemmaChunkerError("unreachable")
        with self.assertRaises(gemma_chunker.GemmaChunkerError):
            gemma_chunker.chunk_text("x y z", transport=boom)

    def test_chunker_has_no_cloud_provider_reference(self):
        source = inspect.getsource(gemma_chunker).lower()
        for banned in ["openai_api_key", "anthropic", "openrouter", "tavily"]:
            self.assertNotIn(banned, source)


# --------------------------------------------------------------------------- #
# ThinkGraph note write: project meaning only, prior-reasoning link
# --------------------------------------------------------------------------- #

if __name__ == "__main__":
    unittest.main()
