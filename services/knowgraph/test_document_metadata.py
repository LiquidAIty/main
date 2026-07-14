"""Regression test: document metadata must satisfy neo4j_graphrag's DocumentInfo.

DocumentInfo.metadata is typed Optional[Dict[str, str]] (values must be strings),
so passing None for optional source fields raises a ValidationError before
extraction. _build_document_metadata drops None-valued keys to prevent that.

Run: services/knowgraph/.venv/Scripts/python.exe -m unittest test_document_metadata -v
"""

from __future__ import annotations

import unittest

import pydantic
from neo4j_graphrag.experimental.components.types import DocumentInfo

from ingest import _build_document_metadata


class DocumentMetadataTests(unittest.TestCase):
    def test_drops_none_valued_keys(self) -> None:
        md = _build_document_metadata(
            project_id="p", document_id="d", source_path="sp", source_name="sn",
            source_url=None, fetched_at=None, snippet=None, metadata_json=None,
            source_type="web_research",
        )
        self.assertEqual(set(md), {"project_id", "document_id", "source_path", "source_name", "source_type"})
        self.assertNotIn("snippet", md)
        self.assertNotIn("source_url", md)

    def test_keeps_present_provenance(self) -> None:
        md = _build_document_metadata(source_url="https://x/y", fetched_at="2026-07-14T00:00:00Z")
        self.assertEqual(md["source_url"], "https://x/y")
        self.assertEqual(md["fetched_at"], "2026-07-14T00:00:00Z")

    def test_result_validates_against_documentinfo(self) -> None:
        md = _build_document_metadata(project_id="p", document_id="d", source_url=None, snippet=None)
        DocumentInfo(path="x", metadata=md)  # must not raise

    def test_none_directly_would_still_break_documentinfo(self) -> None:
        # Proves the guard is load-bearing: raw None values fail the real contract.
        with self.assertRaises(pydantic.ValidationError):
            DocumentInfo(path="x", metadata={"snippet": None})


if __name__ == "__main__":
    unittest.main()
