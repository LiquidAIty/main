"""Application-owned Know ranking preserves evidence when the optional ranker fails."""
# Entity: KnowGraph
# Relationship: Verifies candidate identity, stable degraded ordering, citations, scope, and cancellation without paid provider calls.

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app import mcp_auth, mcp_graphiti_provider
from graphiti_core.knows import KnowNode


@pytest.fixture
def search(monkeypatch):
    candidates = [SimpleNamespace(uuid="a", content="Alpha", citation="source-a"),
                  SimpleNamespace(uuid="b", content="Beta", citation="source-b"),
                  SimpleNamespace(uuid="c", content="Alpha", citation="source-c")]
    retrieve = AsyncMock(return_value=candidates)
    rank = AsyncMock(return_value=[("Beta", 0.8), ("Alpha", 0.2)])
    provider = SimpleNamespace(graphiti_client=SimpleNamespace(driver=object(),
        cross_encoder=SimpleNamespace(rank=rank)),
        _know_result=lambda know: {"uuid": know.uuid, "citation": know.citation})
    monkeypatch.setattr(KnowNode, "search", retrieve)
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_MODULE", provider)
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: {"projectId": "project-a"})
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: None)
    return candidates, retrieve, rank


def run(**overrides):
    return asyncio.run(mcp_graphiti_provider.call_graphiti_tool("search_knows", {
        "query": "evidence", "group_id": "liquidaity-project-a", "max_knows": 3, **overrides,
    })).model_dump(by_alias=True)


def test_valid_scores_keep_distinct_know_identities_and_citations(search):
    result = run()
    payload = result["structuredContent"]["result"]
    assert result["isError"] is False
    assert payload["knows"] == [{"uuid": "b", "citation": "source-b"},
                                {"uuid": "a", "citation": "source-a"},
                                {"uuid": "c", "citation": "source-c"}]
    assert payload["retrieval"]["reranked"] is True
    search[2].assert_awaited_once_with("evidence", ["Alpha", "Beta"])
    assert search[1].await_args.kwargs == {"group_id": "liquidaity-project-a", "limit": 6}


@pytest.mark.parametrize("scores", [[], [("Beta", 0.8)], [("Beta", 0.8), ("Beta", 0.2)],
    [("Unknown", 0.8), ("Alpha", 0.2)], [("Alpha", None), ("Beta", 0.2)],
    [("Alpha", float("nan")), ("Beta", 0.2)], [("Alpha", float("inf")), ("Beta", 0.2)],
    [("Alpha", True), ("Beta", 0.2)], [("Alpha", 0.1, "extra"), ("Beta", 0.2)]])
def test_bad_scores_never_drop_or_mispair_evidence(search, scores):
    search[2].return_value = scores
    payload = run()["structuredContent"]["result"]
    assert [know["uuid"] for know in payload["knows"]] == ["a", "b", "c"]
    assert [know["citation"] for know in payload["knows"]] == ["source-a", "source-b", "source-c"]
    assert payload["retrieval"]["status"] == "degraded"
    assert payload["retrieval"]["reranked"] is False
    assert payload["retrieval"]["reason"] == "reranker_invalid_scores"
    assert "not reranked" in payload["message"]


@pytest.mark.parametrize("error,reason", [(TimeoutError(), "reranker_timeout"),
    (ValueError("missing logprobs"), "reranker_invalid_scores"),
    (RuntimeError("provider unavailable"), "reranker_unavailable")])
def test_provider_failures_return_explicit_candidate_order(search, error, reason):
    search[2].side_effect = error
    payload = run(max_knows=2)["structuredContent"]["result"]
    assert [know["uuid"] for know in payload["knows"]] == ["a", "b"]
    assert payload["retrieval"]["reason"] == reason
    assert payload["retrieval"]["limitation"]


def test_equal_scores_preserve_candidate_order(search):
    search[2].return_value = [("Beta", 0.5), ("Alpha", 0.5)]
    assert [k["uuid"] for k in run()["structuredContent"]["result"]["knows"]] == ["a", "b", "c"]


def test_no_candidates_do_not_call_provider(search):
    search[1].return_value = []
    assert run()["structuredContent"]["result"]["retrieval"]["status"] == "empty"
    search[2].assert_not_awaited()


def test_foreign_project_is_rejected_before_read(search):
    with pytest.raises(PermissionError, match="scope_mismatch"):
        run(group_id="liquidaity-other")
    search[1].assert_not_awaited()


def test_database_failure_and_request_cancellation_are_not_fake_search_success(search):
    search[1].side_effect = RuntimeError("database unavailable")
    with pytest.raises(RuntimeError, match="database unavailable"):
        run()
    search[1].side_effect = None
    search[2].side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        run()
