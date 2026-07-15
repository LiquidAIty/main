"""Tests for canonical existing-chunk enrichment (no re-import / re-embed / re-chunk).

Run: services/knowgraph/.venv/Scripts/python.exe -m unittest test_enrich_chunks -v
"""

from __future__ import annotations

import os
import unittest

from dotenv import load_dotenv
load_dotenv()

from neo4j import GraphDatabase

import enrich_chunks

P = "standin-enrich-test-0714"


def _drv():
    return GraphDatabase.driver(os.environ["NEO4J_URI"], auth=(os.environ["NEO4J_USER"], os.environ["NEO4J_PASSWORD"]))


class EnrichTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        d = _drv()
        with d.session() as s:
            s.run("MATCH (n {project_id:$p}) DETACH DELETE n", p=P)
            # Seed an EXISTING chunk as a fixture — the enrichment function must never create these.
            s.run("CREATE (:Chunk {project_id:$p, chunk_id:'c1', text:'A metadata knowledge graph maps data, systems, consumers.'})", p=P)
        d.close()

    @classmethod
    def tearDownClass(cls) -> None:
        d = _drv()
        with d.session() as s:
            s.run("MATCH (n {project_id:$p}) DETACH DELETE n", p=P)
        d.close()

    def _counts(self):
        d = _drv()
        with d.session() as s:
            c = s.run("MATCH (x:Concept {project_id:$p}) RETURN count(x) AS n", p=P).single()["n"]
            m = s.run("MATCH (:Chunk {project_id:$p})-[r:MENTIONS]->(:Concept) RETURN count(r) AS n", p=P).single()["n"]
            cl = s.run("MATCH (q:Claim {project_id:$p}) RETURN count(q) AS n", p=P).single()["n"]
        d.close()
        return c, m, cl

    def _args(self):
        return dict(
            project_id=P, document_id="d1", chunk_ids=["c1"],
            concepts=[{"name": "Metadata Knowledge Graph", "summary": "map of data/systems/consumers"},
                      {"name": "Data Lineage"}],
            claims=[{"id": "cl1", "text": "A metadata KG maps data, systems, consumers.", "claim_type": "definition", "chunk_ids": ["c1"]}],
            relationships=[{"type": "ENABLES", "start": "Metadata Knowledge Graph", "end": "Data Lineage"}],
            chapter="8", section="intro", pages="127", extraction_run="run-test",
        )

    def _rel_count(self):
        d = _drv()
        with d.session() as s:
            n = s.run("MATCH (:Concept {project_id:$p})-[r:ENABLES]->(:Concept {project_id:$p}) RETURN count(r) AS n", p=P).single()["n"]
        d.close()
        return n

    def test_enrich_writes_genuine_and_is_idempotent(self):
        r1 = enrich_chunks.enrich_existing_chunks(**self._args())  # exercises apoc.merge.relationship
        self.assertEqual(r1["chunks_grounded"], 1)
        self.assertEqual(r1["relationships"], 1)
        c1, m1, cl1 = self._counts()
        self.assertEqual((c1, cl1), (2, 1))
        self.assertGreaterEqual(m1, 1)
        self.assertEqual(self._rel_count(), 1)
        enrich_chunks.enrich_existing_chunks(**self._args())  # replay
        c2, m2, cl2 = self._counts()
        self.assertEqual((c2, cl2), (2, 1), "idempotent replay must not duplicate")
        self.assertEqual(self._rel_count(), 1, "apoc.merge.relationship must be idempotent")

    def test_rejects_type_outside_schema_allowlist(self):
        a = self._args()
        a["relationships"] = [{"type": "TOTALLY_MADE_UP", "start": "Metadata Knowledge Graph", "end": "Data Lineage"}]
        with self.assertRaises(ValueError):
            enrich_chunks.enrich_existing_chunks(**a)

    def test_refuses_when_no_existing_chunks(self):
        a = self._args()
        a["chunk_ids"] = ["MISSING"]
        with self.assertRaises(ValueError):
            enrich_chunks.enrich_existing_chunks(**a)

    def test_no_reparse_reembed_rechunk_dependency(self):
        src = open(os.path.join(os.path.dirname(__file__), "enrich_chunks.py"), encoding="utf-8").read()
        for forbidden in ("Embedding", "SimpleKGPipeline", "PdfReader", "PdfLoader", "splitter", "OpenAILLM"):
            self.assertNotIn(forbidden, src, f"enrichment must not {forbidden}")


if __name__ == "__main__":
    unittest.main()
