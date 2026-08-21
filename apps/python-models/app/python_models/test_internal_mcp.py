"""Focused no-provider proof for the shared internal MCP Card client."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import jwt

from app.python_models import internal_mcp


def test_card_runtime_token_is_scoped_and_signed(monkeypatch):
    secret = "0123456789abcdef0123456789abcdef"
    monkeypatch.setenv("LIQUIDAITY_INTERNAL_MCP_SECRET", secret)
    token = internal_mcp.create_card_runtime_token(
        project_id="project-1",
        deck_id="deck_builder",
        conversation_id="conversation-1",
        parent_run_id="run-1",
        caller_card_id="card-mag-one",
        caller_runtime_kind="autogen",
        caller_runtime_mode="magentic_one",
        granted_tools=["card.run_assistant_agent"],
    )
    claims = jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        issuer="liquidaity-runtime",
        audience="liquidaity-internal-mcp",
    )
    assert claims["principal"] == {
        "kind": "card-runtime",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "run-1",
        "callerCardId": "card-mag-one",
        "callerRuntimeKind": "autogen",
        "callerRuntimeMode": "magentic_one",
        "grantedTools": ["card.run_assistant_agent"],
    }


def test_materializer_read_token_has_no_fake_run_and_expires_quickly(monkeypatch):
    secret = "0123456789abcdef0123456789abcdef"
    monkeypatch.setenv("LIQUIDAITY_INTERNAL_MCP_SECRET", secret)
    token = internal_mcp.create_materializer_read_token(
        project_id="project-1",
        deck_id="deck_builder",
        card_id="card-coder",
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
        "callerCardId": "card-coder",
    }
    assert claims["exp"] - claims["iat"] == 60
    assert "runId" not in claims["principal"]


def test_saved_card_call_uses_official_http_mcp_with_server_owned_identity(monkeypatch):
    monkeypatch.setenv(
        "LIQUIDAITY_INTERNAL_MCP_SECRET",
        "0123456789abcdef0123456789abcdef",
    )
    monkeypatch.setenv(
        "LIQUIDAITY_INTERNAL_MCP_URL",
        "http://127.0.0.1:8765/mcp",
    )
    observed = {"headers": None, "url": None, "call": None, "initialized": False}

    class HttpClient:
        def __init__(self, *, headers, timeout):
            observed["headers"] = headers
            assert timeout.connect == 300.0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

    @asynccontextmanager
    async def transport(url, *, http_client):
        observed["url"] = url
        assert isinstance(http_client, HttpClient)
        yield object(), object(), lambda: None

    class Session:
        def __init__(self, *_args):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def initialize(self):
            observed["initialized"] = True

        async def call_tool(self, name, arguments):
            observed["call"] = (name, arguments)
            return SimpleNamespace(content=[SimpleNamespace(text=(
                '{"ok":true,"result":{"status":"completed","output":"ok"}}'
            ))])

    monkeypatch.setattr(internal_mcp.httpx, "AsyncClient", HttpClient)
    monkeypatch.setattr(internal_mcp, "streamable_http_client", transport)
    monkeypatch.setattr(internal_mcp, "ClientSession", Session)

    result = asyncio.run(internal_mcp.call_saved_card_via_mcp(
        project_id="project-1",
        deck_id="deck_builder",
        conversation_id="conversation-1",
        parent_run_id="run-1",
        caller_card_id="card-mag-one",
        caller_runtime_kind="autogen",
        caller_runtime_mode="magentic_one",
        target_card_id="card-coder",
        input_text="bounded task",
    ))

    assert result["result"]["output"] == "ok"
    assert observed["url"] == "http://127.0.0.1:8765/mcp"
    assert str(observed["headers"]["Authorization"]).startswith("Bearer ")
    assert observed["initialized"] is True
    assert observed["call"] == (
        "card.run_assistant_agent",
        {"cardId": "card-coder", "input": "bounded task"},
    )


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
            return SimpleNamespace(
                content=[SimpleNamespace(text='{"ok":true}')],
                isError=False,
            )

    monkeypatch.setattr(internal_mcp.httpx, "AsyncClient", HttpClient)
    monkeypatch.setattr(internal_mcp, "streamable_http_client", transport)
    monkeypatch.setattr(internal_mcp, "ClientSession", Session)
    monkeypatch.setattr(
        "app.python_models.idd.tool_access",
        lambda name: "write" if name == "cbm.index_repository" else "read",
    )

    results = internal_mcp.call_read_tools_via_mcp(
        project_id="project-1",
        deck_id="deck_builder",
        card_id="card-coder",
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
            card_id="card-coder",
            calls=[("cbm.index_repository", {"repo_path": "x"})],
        )
    except RuntimeError as error:
        assert str(error) == "materializer_mcp_read_required:cbm.index_repository"
    else:
        raise AssertionError("write tool was accepted by the materializer client")
