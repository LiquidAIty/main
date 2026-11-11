"""Saved-Card document retrieval through the existing KnowGraph service."""
# Entity: Document Retrieval
# Relationship: Publishes explicitly granted Project-scoped source ingestion, semantic passage search and exact source reads without granting canonical Know writes.
# Entity: Tool Catalog
# Relationship: Supplies typed document operations to the existing application MCP registry and injects authenticated Project/Card provenance rather than accepting caller identity.

from __future__ import annotations

import os
from typing import Any

import httpx

from app.application_tool_error import ApplicationToolError
from app.python_models.operation_definition import OperationDefinition


async def _document_request(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    from app.mcp_auth import INTERNAL_MCP_SECRET

    if len(INTERNAL_MCP_SECRET) < 32:
        raise ApplicationToolError("document_service_authorization_unavailable")
    origin = os.environ.get("KNOWGRAPH_URL", "http://127.0.0.1:8001").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=300, follow_redirects=False) as client:
            response = await client.post(origin + path, json=payload,
                headers={"X-LiquidAIty-Internal-MCP-Secret": INTERNAL_MCP_SECRET})
        if not response.is_success:
            allowed = {"document_ingest_busy", "document_embedding_space_changed",
                       "document_vector_index_unavailable", "document_passage_not_found",
                       "document_input_or_embedding_invalid"}
            failure = response.json()
            detail = failure.get("detail") if isinstance(failure, dict) else None
            raise ApplicationToolError(detail if isinstance(detail, str) and detail in allowed else "document_service_request_failed")
        result = response.json()
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise ApplicationToolError("document_service_response_invalid")
        return result
    except (httpx.HTTPError, ValueError):
        raise ApplicationToolError("document_service_unavailable") from None


async def ingest_document(documentId: str, sourceName: str, sourceUrl: str, text: str,
                          publicationDate: str | None = None, *, projectId: str, deckId: str,
                          _callerCardId: str, _sourceExecution: dict[str, Any]) -> dict[str, Any]:
    return await _document_request("/documents/ingest", {"project_id": projectId,
        "document_id": documentId, "source_name": sourceName, "source_url": sourceUrl,
        "text": text, "publication_date": publicationDate,
        "source_execution": {"card_id": _callerCardId, "deck_id": deckId, **_sourceExecution}})


async def search_documents(query: str, limit: int = 5, documentIds: list[str] | None = None,
                           *, projectId: str) -> dict[str, Any]:
    return await _document_request("/documents/search", {"project_id": projectId,
        "query": query, "limit": limit, "document_ids": documentIds})


async def read_document_passage(passageId: str, contextChars: int = 1200,
                                *, projectId: str) -> dict[str, Any]:
    return await _document_request("/documents/passage", {"project_id": projectId,
        "passage_id": passageId, "context_chars": contextChars})


def document_tool_operation_definitions() -> list[OperationDefinition]:
    common = {"output_schema": {"type": "object"}, "available": True,
              "publishers": frozenset({"internal-plugin"}), "namespace": "documents",
              "grant_eligible": True, "external_source_id": "python_runtime"}
    read = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}
    return [
        OperationDefinition(**common, canonical_id="documents.ingest", title="Index source document text",
            description="Retain supplied verbatim source text as an immutable, Project-scoped document version with exact passages and vector embeddings. "
                "Use a stable documentId and the actual source URL; this tool does not fetch URLs or read server files. "
                "Do not substitute an agent-written summary for source text. PDFs use the existing upload control. "
                "Unknown publication dates stay unknown. This creates no Know, Entity or semantic relationship; KnowGraph verifies selected findings separately.",
            parameters_schema={"type": "object", "properties": {
                "documentId": {"type": "string", "minLength": 1, "maxLength": 256},
                "sourceName": {"type": "string", "minLength": 1, "maxLength": 512},
                "sourceUrl": {"type": "string", "format": "uri", "maxLength": 4096},
                "text": {"type": "string", "minLength": 1, "maxLength": 2_000_000},
                "publicationDate": {"type": ["string", "null"], "format": "date"},
            }, "required": ["documentId", "sourceName", "sourceUrl", "text"], "additionalProperties": False},
            access="write", handler=ingest_document,
            annotations={**read, "readOnlyHint": False, "openWorldHint": True},
            dispatcher_context_arguments=frozenset({"projectId", "deckId", "_callerCardId", "_sourceExecution"})),
        OperationDefinition(**common, canonical_id="documents.search", title="Search source passages",
            description="Semantic vector search over source passages in this Project, optionally restricted to document IDs. "
                "Returns exact passage identifiers, provenance and similarity, not verified facts or probability. "
                "Check source dates/version and use documents.get_passage to inspect surrounding text before authoring a Know.",
            parameters_schema={"type": "object", "properties": {
                "query": {"type": "string", "minLength": 1, "maxLength": 2000},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
                "documentIds": {"type": ["array", "null"], "maxItems": 32, "items": {"type": "string"}},
            }, "required": ["query"], "additionalProperties": False},
            access="read", handler=search_documents, annotations=read,
            dispatcher_context_arguments=frozenset({"projectId"})),
        OperationDefinition(**common, canonical_id="documents.get_passage", title="Read exact source passage",
            description="Read one exact chunk_id returned by documents.search within this Project, including bounded surrounding original page text and source/version metadata. No new research or graph write.",
            parameters_schema={"type": "object", "properties": {
                "passageId": {"type": "string", "minLength": 1, "maxLength": 256},
                "contextChars": {"type": "integer", "minimum": 0, "maximum": 4000, "default": 1200},
            }, "required": ["passageId"], "additionalProperties": False},
            access="read", handler=read_document_passage, annotations=read,
            dispatcher_context_arguments=frozenset({"projectId"})),
    ]
