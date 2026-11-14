"""Exact retained passage verification before the existing Know writer."""
# Entity: Document Retrieval
# Relationship: Tests same-Project passage identity, literal quotations and durable citation provenance without granting the researcher a Know writer.

import asyncio
import copy
from unittest.mock import AsyncMock

import pytest

from app import mcp_provider_operations
from app.python_models import document_tool_operations


@pytest.fixture
def passage(monkeypatch):
    value = {"chunk_id": "passage-one", "page_number": 129, "start": 0, "end": 1800,
             "text": "Premium reduces net cost.\nThe position still carries stock downside.",
             "document": {"document_id": "pdf:book", "document_version": "version-one",
                          "source_reference": "knowgraph-upload://sha256/checksum/book.pdf",
                          "source_name": "book.pdf", "document_checksum": "a" * 64,
                          "retrieval_date": "2026-11-13T23:54:37Z"}}
    reader = AsyncMock(return_value=value)
    monkeypatch.setattr(document_tool_operations, "read_document_passage", reader)
    return value, reader


def arguments(passage):
    return {"entity_name": "Covered call", "documentPassageId": "passage-one",
            "observation": "The example retains downside exposure.",
            "interpretation": "Premium is not full downside protection.",
            "citation": {"url": passage[0]["document"]["source_reference"],
                         "title": "Book example", "publisher": "Book author",
                         "evidence": passage[0]["text"], "locator": "Printed page 110"}}


def test_uploaded_passage_keeps_its_identity_without_a_web_url_or_local_file(passage):
    original = arguments(passage)
    before = copy.deepcopy(original)
    result = asyncio.run(mcp_provider_operations._entity_know_provider_arguments(original, "project-one"))
    passage[1].assert_awaited_once_with(passageId="passage-one", contextChars=0, projectId="project-one")
    assert original == before
    assert "documentPassageId" not in result
    citation = result["citation"]
    assert citation["url"] == original["citation"]["url"]
    assert citation["evidence"] == original["citation"]["evidence"]
    assert citation["contentFingerprint"] == "a" * 64
    assert citation["retrievedAt"] == "2026-11-13T23:54:37Z"
    assert citation["documentTitle"] == "book.pdf"
    assert "Document pdf:book; version version-one; passage passage-one; page 129; characters 0–1800" in citation["locator"]
    assert "publishedAt" not in citation


@pytest.mark.parametrize("field,value,error", [
    ("evidence", "An agent paraphrase is not source text.", "exact_passage_excerpt"),
    ("evidence", "Premium reduces net cost. The position still carries stock downside.", "exact_passage_excerpt"),
    ("url", "https://invented.example/book", "citation_url_mismatch"),
    ("resolvedUrl", "https://invented.example/book", "citation_url_mismatch"),
])
def test_mismatched_evidence_is_rejected_before_any_write(passage, field, value, error):
    args = arguments(passage)
    args["citation"][field] = value
    with pytest.raises(ValueError, match=error):
        asyncio.run(mcp_provider_operations._entity_know_provider_arguments(args, "project-one"))


def test_foreign_or_missing_passage_is_not_replaced_with_supplied_text(passage):
    passage[1].side_effect = LookupError("document_passage_not_found")
    with pytest.raises(LookupError, match="document_passage_not_found"):
        asyncio.run(mcp_provider_operations._entity_know_provider_arguments(arguments(passage), "other-project"))
    assert passage[1].await_args.kwargs["projectId"] == "other-project"


def test_known_publication_date_is_copied_from_retained_document(passage):
    passage[0]["document"]["publication_date"] = "2006"
    args = arguments(passage)
    args["citation"]["publishedAt"] = "2026"
    result = asyncio.run(mcp_provider_operations._entity_know_provider_arguments(args, "project-one"))
    assert result["citation"]["publishedAt"] == "2006"


def test_unknown_publication_date_does_not_become_caller_supplied_metadata(passage):
    args = arguments(passage)
    args["citation"]["publishedAt"] = "2026"
    result = asyncio.run(mcp_provider_operations._entity_know_provider_arguments(args, "project-one"))
    assert "publishedAt" not in result["citation"]
