"""Focused no-provider proof for the shared internal MCP Card client."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import jwt
import pytest

from app.python_models import internal_mcp


def test_query_graph_text_transport_does_not_relax_other_tool_results():
    result = SimpleNamespace(content=[SimpleNamespace(text="rows: 0  (cols: a)\ntotal: 0")])
    assert internal_mcp._json_result(result, "cbm.query_graph")["text"].startswith("rows: 0")
    with pytest.raises(RuntimeError, match="invalid_json_result"):
        internal_mcp._json_result(result, "cbm.search_graph")


@pytest.mark.parametrize("url", ["https://127.0.0.1:8765/mcp", "http://example.com/mcp", "http://localhost/other"])
def test_preload_rejects_nonlocal_transport_before_constructing_client(monkeypatch, url):
    monkeypatch.setenv("LIQUIDAITY_INTERNAL_MCP_SECRET", "0" * 32)
    monkeypatch.setenv("LIQUIDAITY_INTERNAL_MCP_URL", url)
    monkeypatch.setattr(internal_mcp.httpx, "AsyncClient", lambda **_: pytest.fail("invalid transport constructed"))
    with pytest.raises(RuntimeError, match="internal_mcp_url_"):
        internal_mcp.call_read_tools_via_mcp(
            project_id="p", deck_id="d", card_id="main",
            calls=[("cbm.search_graph", {})], deadline_seconds=2,
        )


def test_materializer_read_token_has_no_fake_run_and_expires_quickly(monkeypatch):
    secret = "0123456789abcdef0123456789abcdef"
    monkeypatch.setenv("LIQUIDAITY_INTERNAL_MCP_SECRET", secret)
    token = internal_mcp.create_materializer_read_token(
        project_id="project-1",
        deck_id="deck_builder",
        card_id="card-helper",
    )
    claims = jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        issuer="liquidaity-runtime",
        audience="liquidaity-internal-mcp",
    )
    assert claims["principal"] == {
        "kind": "materializer-read",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "callerCardId": "card-helper",
    }
    assert claims["exp"] - claims["iat"] == 60
    assert "runId" not in claims["principal"]


def test_materializer_read_client_reuses_one_official_session_and_rejects_writes(monkeypatch):
    monkeypatch.setenv(
        "LIQUIDAITY_INTERNAL_MCP_SECRET",
        "0123456789abcdef0123456789abcdef",
    )
    observed = {"sessions": 0, "calls": []}

    class HttpClient:
        def __init__(self, *, headers, timeout):
            assert str(headers["Authorization"]).startswith("Bearer ")
            assert timeout.connect == 30.0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

    @asynccontextmanager
    async def transport(_url, *, http_client):
        assert isinstance(http_client, HttpClient)
        yield object(), object(), lambda: None

    class Session:
        def __init__(self, *_args):
            observed["sessions"] += 1

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def initialize(self):
            return None

        async def call_tool(self, name, arguments):
            observed["calls"].append((name, arguments))
            if name == "cbm.index_repository":
                return SimpleNamespace(
                    content=[SimpleNamespace(text='{"error":"tool_not_granted"}')],
                    isError=True,
                )
            return SimpleNamespace(
                content=[SimpleNamespace(text='{"ok":true}')],
                isError=False,
            )

    monkeypatch.setattr(internal_mcp.httpx, "AsyncClient", HttpClient)
    monkeypatch.setattr(internal_mcp, "streamable_http_client", transport)
    monkeypatch.setattr(internal_mcp, "ClientSession", Session)

    results = internal_mcp.call_read_tools_via_mcp(
        project_id="project-1",
        deck_id="deck_builder",
        card_id="card-helper",
        calls=[
            ("cbm.index_status", {"project": "core"}),
            ("cbm.get_code_snippet", {"project": "core", "qualified_name": "symbol"}),
        ],
    )
    assert results == [{"ok": True}, {"ok": True}]
    assert observed["sessions"] == 1
    assert [name for name, _args in observed["calls"]] == [
        "cbm.index_status", "cbm.get_code_snippet",
    ]
    try:
        internal_mcp.call_read_tools_via_mcp(
            project_id="project-1",
            deck_id="deck_builder",
            card_id="card-helper",
            calls=[("cbm.index_repository", {"repo_path": "x"})],
        )
    except RuntimeError as error:
        assert str(error) == "materializer_mcp_read_failed:cbm.index_repository"
    else:
        raise AssertionError("write tool was accepted by the authoritative MCP host")
    assert observed["calls"][-1][0] == "cbm.index_repository"


def test_preload_deadline_preserves_successful_reads_and_cancels_slow_source(monkeypatch):
    import time
    monkeypatch.setenv("LIQUIDAITY_INTERNAL_MCP_SECRET", "0" * 32)
    cancelled = []

    class HttpClient:
        def __init__(self, **kwargs):
            assert kwargs["verify"] is False
        async def __aenter__(self):
            return self
        async def __aexit__(self, *_args):
            pass

    @asynccontextmanager
    async def transport(*_args, **_kwargs):
        yield None, None, None

    class Session:
        def __init__(self, *_args):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *_args):
            pass
        async def initialize(self):
            pass
        async def call_tool(self, *_args):
            raise AssertionError("preload must not request the tool catalog")
        async def send_request(self, request, response_type):
            assert response_type is internal_mcp.mcp_types.CallToolResult
            assert request.root.method == "tools/call"
            name = request.root.params.name
            if name == "graphiti.search_memory_facts":
                try:
                    await asyncio.sleep(20)
                finally:
                    cancelled.append(name)
            if name == "cbm.search_graph":
                raise RuntimeError("source unavailable")
            return SimpleNamespace(content=[SimpleNamespace(text='{"nodes":[{"id":"decision-1"}]}')], isError=False)

    monkeypatch.setattr(internal_mcp, "streamable_http_client", transport)
    monkeypatch.setattr(internal_mcp, "ClientSession", Session)
    monkeypatch.setattr(internal_mcp.httpx, "AsyncClient", HttpClient)
    started = time.monotonic()
    results = internal_mcp.call_read_tools_via_mcp(
        project_id="p", deck_id="d", card_id="main", conversation_id="conversation-1",
        calls=[("engraphis_recall_context", {}), ("graphiti.search_memory_facts", {}), ("cbm.search_graph", {})],
        concurrent=True, deadline_seconds=0.1,
    )
    assert time.monotonic() - started < 1
    assert results[0]["nodes"] == [{"id": "decision-1"}]
    assert results[1]["error"] == "read_timeout"
    assert results[2]["error"] == "read_failed"
    assert cancelled == ["graphiti.search_memory_facts"]
