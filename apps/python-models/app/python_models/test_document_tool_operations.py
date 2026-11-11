"""Real document handlers through the SDK/dispatcher; service I/O is isolated."""
# Entity: Document Retrieval
# Relationship: Proves saved grants and injected Project/Hermes identity reach document operations, while forged scope and missing execution references do not reach storage.
import asyncio
from unittest.mock import AsyncMock

import pytest
from mcp.types import CallToolRequestParams

from app import mcp_auth, mcp_catalog_runtime, mcp_host, mcp_request_dispatch
from app.python_models import document_tool_operations as operations


@pytest.fixture
def scope(monkeypatch):
    context = {"projectId": "project-a", "deckId": "deck-a", "callerCardId": "research-card",
               "conversationId": "conversation-a", "grantedTools": ["documents.ingest", "documents.search", "documents.get_passage"]}
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: context)
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: {"kind": "card-runtime", "profile": "research"})
    monkeypatch.setattr(mcp_catalog_runtime, "published_mcp_tool_names", lambda: frozenset(context["grantedTools"]))
    request = AsyncMock(return_value={"ok": True, "matches": []})
    monkeypatch.setattr(operations, "_document_request", request)
    return context, request


def call(name, args, meta=None):
    return asyncio.run(mcp_host._server_call_tool(None, CallToolRequestParams(
        name=name, arguments=args, meta=meta))).model_dump(by_alias=True)


def test_search_uses_authenticated_project_and_real_handler(scope):
    result = call("documents.search", {"query": "committed funding", "documentIds": ["filing"]})
    assert result["isError"] is False
    scope[1].assert_awaited_once_with("/documents/search", {"project_id": "project-a",
        "query": "committed funding", "document_ids": ["filing"], "limit": 5})


def test_ingest_retains_actual_execution_and_author_without_granting_know_writes(scope):
    execution = {"profile": "research", "sessionId": "session", "turnId": "turn", "toolCallId": "call"}
    result = call("documents.ingest", {"documentId": "filing", "sourceName": "Annual report",
        "sourceUrl": "https://example.test/report", "text": "Original source text"}, {"hermes.execution": execution})
    assert result["isError"] is False
    path, payload = scope[1].await_args.args
    assert path == "/documents/ingest"
    assert payload["source_execution"] == {"card_id": "research-card", "deck_id": "deck-a",
        "runtime": "hermes", **execution}
    assert "graphiti.add_know" not in scope[0]["grantedTools"]


@pytest.mark.parametrize("forged", [{"projectId": "other"}, {"_callerCardId": "builder"},
                                     {"_sourceExecution": {}}, {"source_execution": {"profile": "main"}}])
def test_caller_cannot_override_document_scope(scope, forged):
    result = call("documents.search", {"query": "funding", **forged})
    assert result["isError"] is True
    scope[1].assert_not_awaited()


def test_ungranted_document_reads_do_not_reach_the_service(scope):
    scope[0]["grantedTools"] = []
    result = call("documents.get_passage", {"passageId": "some-id"})
    assert result["isError"] is True
    scope[1].assert_not_awaited()


def test_import_without_native_execution_reference_cannot_publish(scope):
    result = call("documents.ingest", {"documentId": "doc", "sourceName": "Source",
        "sourceUrl": "https://example.test/source", "text": "Original text"})
    assert result["isError"] is True
    assert result["structuredContent"]["failureCode"] == "hermes_execution_reference_required"
    scope[1].assert_not_awaited()


def test_document_import_has_a_bounded_embedding_budget_without_relaxing_reads():
    assert mcp_request_dispatch.mcp_tool_timeout_seconds("documents.ingest") == 270.0
    assert mcp_request_dispatch.mcp_tool_timeout_seconds("documents.search") == 30.0
    assert mcp_request_dispatch.mcp_tool_timeout_seconds("documents.get_passage") == 30.0
