"""Regression test for dedup-safe ingestion (idempotent Document upsert).

Repeat ingestion of the same (project_id, document_id) must keep exactly one
Document node — _delete_prior_document removes the prior lexical Document/Chunks
before each write. Uses the real Neo4j (dev) + the inspection extraction provider
(no paid model call).

Run: services/knowgraph/.venv/Scripts/python.exe -m unittest test_dedup_reingest -v
"""

from __future__ import annotations

import asyncio
import os
import unittest

os.environ.setdefault("KNOWGRAPH_INSPECTION_MODE", "1")
os.environ.setdefault(
    "KNOWGRAPH_INSPECTION_EXTRACTION_PATH",
    r"C:/Projects/main/services/knowgraph/inspection_plans/organizing_principle_discovery.json",
)

from dotenv import load_dotenv  # noqa: E402
load_dotenv()

import ingest  # noqa: E402
from neo4j import GraphDatabase  # noqa: E402

PROJECT = "standin-dedup-test-0714"
DOCID = "dedup-doc-1"
TEXT = "The organizing principle of a knowledge graph relies on stable identity to prevent duplicates."


def _driver():
    return GraphDatabase.driver(os.getenv("NEO4J_URI"), auth=(os.getenv("NEO4J_USER"), os.getenv("NEO4J_PASSWORD")))


def _doc_count() -> int:
    d = _driver()
    with d.session() as s:
        n = s.run(
            "MATCH (x:Document {project_id:$p, document_id:$id}) RETURN count(x) AS c", p=PROJECT, id=DOCID
        ).single()["c"]
    d.close()
    return n


class DedupReingestTest(unittest.TestCase):
    def test_repeat_ingest_keeps_single_document(self) -> None:
        for _ in range(2):
            asyncio.run(
                ingest.ingest_text_document(
                    project_id=PROJECT, document_id=DOCID, text=TEXT,
                    title="dedup", source_url="https://example.test/dedup", source_type="web_research",
                )
            )
        self.assertEqual(_doc_count(), 1, "repeat ingest must keep exactly one Document per (project_id, document_id)")

    @classmethod
    def tearDownClass(cls) -> None:
        d = _driver()
        with d.session() as s:
            s.run(
                "MATCH (x:Document {project_id:$p}) OPTIONAL MATCH (x)-[:HAS_CHUNK]->(c:Chunk) DETACH DELETE x, c",
                p=PROJECT,
            )
        d.close()


if __name__ == "__main__":
    unittest.main()
