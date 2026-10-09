"""MCP authentication, principal, and saved-Card scope contract tests."""

import json
import os
import sys
import time
from types import SimpleNamespace

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.python_models.provider_config import ensure_env_loaded

ensure_env_loaded()

from app import (
    mcp_auth,
    mcp_catalog_runtime,
    mcp_cbm_provider,
    mcp_graphiti_provider,
    mcp_provider_operations,
)
from app.python_models.mcp_contract_test_support import (
    clear_live_provider_operations,
    tool_result_wire_text,
)
from mcp.types import Tool


def test_call_tool_preserves_exact_results_without_runtime_observation_leak(monkeypatch):
    import asyncio
    import mcp_host

    async def dispatch(name, _arguments):
        if name == "graphiti.search_nodes":
            return mcp_provider_operations._normalize_graphiti_result(
                [mcp_host.TextContent(type="text", text=json.dumps({
                    "error": "OpenAI insufficient credits for embeddings"
                }))]
            )
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)
    monkeypatch.setattr(mcp_host, "_request_tool_is_allowed", lambda _name: True)
    failed = asyncio.run(mcp_host.call_tool("graphiti.search_nodes", {"query": "x"}))
    assert failed.is_error is True
    failure = json.loads(failed.content[0].text)
    assert failure["failureCode"] == "insufficient_credits"
    assert failure["retryable"] is False
    assert len(failed.content) == 1
    assert "executionReceipt" not in tool_result_wire_text(failed)

    later = asyncio.run(mcp_host.call_tool("main.context", {}))
    assert json.loads(later[0].text)["ok"] is True
    assert len(later) == 1
    assert "executionReceipt" not in tool_result_wire_text(later)

def test_main_context_reads_only_the_current_request_claims(monkeypatch):
    import mcp_host
    from mcp.server.auth.provider import AccessToken

    contexts = [{
        "projectId": f"project-{index}",
        "deckId": "deck_builder",
        "conversationId": f"external-mcp:grant-{index}",
        "parentRunId": f"external-main:grant-{index}",
        "mainCardId": "card_main_chat",
    } for index in (1, 2)]
    current = {"token": AccessToken(
        token="first",
        client_id="chatgpt-client",
        scopes=["main"],
        expires_at=int(time.time()) + 60,
        claims={"main": contexts[0]},
    )}
    monkeypatch.setattr(mcp_auth, "get_access_token", lambda: current["token"])

    assert mcp_auth._authenticated_main_context() == contexts[0]
    current["token"] = AccessToken(
        token="second",
        client_id="chatgpt-client",
        scopes=["main"],
        expires_at=int(time.time()) + 60,
        claims={"main": contexts[1]},
    )
    assert mcp_auth._authenticated_main_context() == contexts[1]
    current["token"] = None
    assert mcp_auth._authenticated_main_context() is None
    assert not hasattr(mcp_host, "_VERIFIED_CONTEXTS")
    assert not hasattr(mcp_host, "_MAIN_CONNECTION_CONTEXTS")

def test_main_context_rejects_expired_or_incomplete_request_claims(monkeypatch):
    import mcp_host
    from mcp.server.auth.provider import AccessToken

    current = {"token": AccessToken(
        token="expired",
        client_id="chatgpt-client",
        scopes=["main"],
        expires_at=int(time.time()) - 1,
        claims={"main": {
            "projectId": "stale-project",
            "deckId": "deck_builder",
            "conversationId": "external-mcp:stale",
            "parentRunId": "external-main:stale",
            "mainCardId": "card_main_chat",
        }},
    )}
    monkeypatch.setattr(mcp_auth, "get_access_token", lambda: current["token"])
    assert mcp_auth._authenticated_main_context() is None

def test_internal_mcp_token_binds_card_context_without_auth0_or_provider_calls(monkeypatch):
    import jwt
    import mcp_host

    secret = "0123456789abcdef0123456789abcdef"
    now = int(time.time())
    principal = {
        "kind": "card-runtime",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "run-1",
        "callerCardId": "card-main",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "main",
        "grantedTools": ["canvas.inspect"],
        "presentedTools": ["canvas.inspect"],
    }
    token = jwt.encode({
        "iss": "liquidaity-runtime",
        "aud": "liquidaity-internal-mcp",
        "sub": "card-runtime:card-main",
        "iat": now,
        "exp": now + 60,
        "principal": principal,
    }, secret, algorithm="HS256")

    class NoAuth0Jwks:
        def get_signing_key_from_jwt(self, _token):
            raise AssertionError("Auth0 JWKS must not run for internal MCP")

    monkeypatch.setattr(mcp_auth, "INTERNAL_MCP_SECRET", secret)
    verifier = mcp_auth.Auth0TokenVerifier(
        mcp_auth.OAuthConfig(
            resource_url="https://example.ngrok.dev/mcp",
            issuer_url="https://auth.example/",
            audience="https://example.ngrok.dev/mcp",
            client_id="chatgpt-client",
            required_scope="liquidaity.main",
        ),
        jwk_client=NoAuth0Jwks(),
    )
    verified = verifier._verify_sync(token)
    assert verified is not None
    monkeypatch.setattr(mcp_auth, "get_access_token", lambda: verified)
    assert mcp_auth._authenticated_main_context() == {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "run-1",
        "mainCardId": "card-main",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "main",
        "principalKind": "card-runtime",
        "grantedTools": ["canvas.inspect"],
        "presentedTools": ["canvas.inspect"],
    }
    assert mcp_host._request_tool_is_allowed("canvas.inspect") is True
    assert mcp_host._request_tool_is_allowed("run_mag_one") is False

def test_card_run_token_uses_direct_saved_authority_and_exact_presentation(monkeypatch):
    import jwt
    import mcp_host
    secret = "0123456789abcdef0123456789abcdef"
    monkeypatch.setattr(mcp_auth, "INTERNAL_MCP_SECRET", secret)
    verifier = mcp_auth.Auth0TokenVerifier(mcp_auth.OAuthConfig(
        resource_url="https://example.ngrok.dev/mcp", issuer_url="https://auth.example/",
        audience="https://example.ngrok.dev/mcp", client_id="chatgpt-client",
        required_scope="liquidaity.main"), jwk_client=SimpleNamespace())
    principal = {"kind": "card-runtime", "projectId": "project-1", "deckId": "deck-1",
        "conversationId": "conversation-1", "parentRunId": "persisted-run", "callerCardId": "signal",
        "callerRuntimeKind": "hermes", "callerRuntimeMode": "delegate",
        "grantedTools": ["worldsignals.package"],
        "presentedTools": ["worldsignals.package"]}
    def verify(value):
        now = int(time.time())
        return verifier._verify_sync(jwt.encode({"iss": "liquidaity-runtime", "aud": "liquidaity-internal-mcp",
            "sub": "card-runtime:signal", "iat": now, "exp": now + 60, "principal": value}, secret, algorithm="HS256"))
    token = verify(principal)
    assert token is not None
    for card_id in ("card_main_chat", "builder"):
        accepted = {**principal, "callerCardId": card_id}
        assert verify(accepted) is not None
    for invalid in ({field: ""} for field in (
        "projectId", "deckId", "conversationId", "parentRunId", "callerCardId",
        "callerRuntimeKind", "callerRuntimeMode",
    )):
        assert verify({**principal, **invalid}) is None
    monkeypatch.setattr(mcp_auth, "get_access_token", lambda: token)
    resolved = mcp_auth._authenticated_main_context()
    assert resolved["parentRunId"] == "persisted-run"
    assert resolved["conversationId"] == "conversation-1"
    assert resolved["presentedTools"] == ["worldsignals.package"]
    assert mcp_host._request_tool_is_allowed("card.create") is False

    assert verify({**principal, "presentedTools": []}) is not None
    assert verify({**principal, "presentedTools": ["card.create"]}) is None
    assert verify({**principal, "presentedTools": [
        "worldsignals.package", "worldsignals.package",
    ]}) is None
    without_presentation = dict(principal)
    without_presentation.pop("presentedTools")
    assert verify(without_presentation) is None

def test_replaced_runless_agent_terminal_token_is_rejected(monkeypatch):
    import asyncio
    import jwt
    import mcp_host

    secret = "0123456789abcdef0123456789abcdef"
    now = int(time.time())
    principal = {
        "kind": "agent-terminal",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "callerCardId": "card_hermes_steward",
        "terminalSessionId": "terminal-session-1",
        "profile": "liquidaity-hermes-steward",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "delegate",
        "grantedTools": ["canvas.inspect"],
        "presentedTools": ["canvas.inspect"],
    }
    token = jwt.encode({
        "iss": "liquidaity-runtime",
        "aud": "liquidaity-internal-mcp",
        "sub": "agent-terminal:card_hermes_steward:terminal-session-1",
        "iat": now,
        "exp": now + 60,
        "principal": principal,
    }, secret, algorithm="HS256")
    monkeypatch.setattr(mcp_auth, "INTERNAL_MCP_SECRET", secret)
    verifier = mcp_auth.Auth0TokenVerifier(
        mcp_auth.OAuthConfig(
            resource_url="https://example.ngrok.dev/mcp", issuer_url="https://auth.example/",
            audience="https://example.ngrok.dev/mcp", client_id="chatgpt-client",
            required_scope="liquidaity.main",
        ), jwk_client=SimpleNamespace(),
    )
    assert verifier._verify_sync(token) is None

def test_materializer_principal_can_only_use_live_catalog_reads(
    monkeypatch, clear_live_provider_operations,
):
    import asyncio
    import jwt
    import mcp_host

    mcp_provider_operations._register_cbm_catalog(mcp_provider_operations._namespace_provider_tools("cbm", [
        Tool(
            name="get_code_snippet",
            description="Read current source.",
            inputSchema={"type": "object"},
            annotations={"readOnlyHint": True},
        ),
        Tool(
            name="search_graph",
            description="Search current source.",
            inputSchema={"type": "object"},
            annotations={"readOnlyHint": True},
        ),
        Tool(
            name="index_repository",
            description="Update the provider index.",
            inputSchema={"type": "object"},
            annotations={"readOnlyHint": False},
        ),
    ]))

    secret = "0123456789abcdef0123456789abcdef"
    now = int(time.time())
    principal = {
        "kind": "materializer-read",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "callerCardId": "card-helper",
        "grantedTools": ["cbm.get_code_snippet", "cbm.index_repository"],
    }
    token = jwt.encode({
        "iss": "liquidaity-runtime",
        "aud": "liquidaity-internal-mcp",
        "sub": "materializer-read:card-helper",
        "iat": now,
        "exp": now + 60,
        "principal": principal,
    }, secret, algorithm="HS256")
    monkeypatch.setattr(mcp_auth, "INTERNAL_MCP_SECRET", secret)
    verifier = mcp_auth.Auth0TokenVerifier(
        mcp_auth.OAuthConfig(
            resource_url="https://example.ngrok.dev/mcp",
            issuer_url="https://auth.example/",
            audience="https://example.ngrok.dev/mcp",
            client_id="chatgpt-client",
            required_scope="liquidaity.main",
        ),
        jwk_client=SimpleNamespace(),
    )
    verified = verifier._verify_sync(token)
    assert verified is not None
    monkeypatch.setattr(mcp_auth, "get_access_token", lambda: verified)
    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", (
        Tool(name="canvas.inspect", description="base", inputSchema={"type": "object"}),
        Tool(name="cbm.get_code_snippet", description="read",
                      inputSchema={"type": "object"}, annotations={"readOnlyHint": True}),
        Tool(name="cbm.search_graph", description="ungranted read",
                      inputSchema={"type": "object"}, annotations={"readOnlyHint": True}),
        Tool(name="graphiti.search_nodes", description="graph read",
                      inputSchema={"type": "object"}, annotations={"readOnlyHint": True}),
    ))
    assert mcp_auth._authenticated_main_context() is None
    assert mcp_host._request_tool_is_allowed("cbm.get_code_snippet") is True
    assert mcp_host._request_tool_is_allowed("cbm.search_graph") is False
    assert mcp_host._request_tool_is_allowed("cbm.index_repository") is False
    assert mcp_host._request_tool_is_allowed("run_mag_one") is False

    assert [tool.name for tool in asyncio.run(mcp_catalog_runtime.list_tools())] == [
        "cbm.get_code_snippet",
    ]

    duplicate_grants = {**principal, "grantedTools": [
        "cbm.get_code_snippet", "cbm.get_code_snippet",
    ]}
    duplicate_token = jwt.encode({
        "iss": "liquidaity-runtime",
        "aud": "liquidaity-internal-mcp",
        "sub": "materializer-read:card-helper",
        "iat": now,
        "exp": now + 60,
        "principal": duplicate_grants,
    }, secret, algorithm="HS256")
    assert verifier._verify_sync(duplicate_token) is None

def test_materializer_provider_reads_keep_project_scope_without_a_fake_run(
    monkeypatch, clear_live_provider_operations,
):
    import asyncio
    import mcp_host
    calls = []
    monkeypatch.setattr(mcp_auth, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(mcp_auth, "_internal_mcp_principal", lambda: {
        "kind": "materializer-read", "projectId": "project-1", "deckId": "d",
        "callerCardId": "main", "conversationId": "conversation-1",
        "grantedTools": ["graphiti.search_memory_facts"],
    })
    async def initialize():
        return None
    async def graphiti_tools():
        return [Tool(name="search_memory_facts", description="facts", inputSchema={
            "type": "object", "properties": {"query": {}, "group_ids": {}}})]
    async def graphiti(name, args):
        calls.append((name, args))
        return []
    monkeypatch.setattr(mcp_graphiti_provider, "_initialize_graphiti", initialize)
    monkeypatch.setattr(mcp_graphiti_provider, "_graphiti_tools", graphiti_tools)
    monkeypatch.setattr(
        mcp_graphiti_provider,
        "_GRAPHITI_NAMES",
        frozenset({"search_memory_facts"}),
    )
    monkeypatch.setattr(mcp_provider_operations, "_call_graphiti", graphiti)
    provider_tools = asyncio.run(graphiti_tools())
    mcp_provider_operations._register_graphiti_catalog(
        mcp_provider_operations._namespace_provider_tools("graphiti", provider_tools)
    )
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", (
        Tool(
            name="graphiti.search_memory_facts",
            inputSchema={"type": "object"},
        ),
    ))
    asyncio.run(mcp_host._dispatch_tool("graphiti.search_memory_facts", {"query": "sources"}))
    assert calls == [("search_memory_facts", {"query": "sources", "group_ids": ["liquidaity-project-1"]})]

def test_card_runtime_catalog_is_exactly_its_presented_granted_tools(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.server.auth.provider import AccessToken

    tools = (
        Tool(name="canvas.inspect", description="x", inputSchema={"type": "object"}),
        Tool(name="run_mag_one", description="y", inputSchema={"type": "object"}),
    )
    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", tools)
    principal = {
        "kind": "card-runtime",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "run-1",
        "callerCardId": "card-graph-agent",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "delegate",
        "grantedTools": ["canvas.inspect", "run_mag_one"],
        "presentedTools": ["canvas.inspect"],
    }
    current = {"token": AccessToken(
        token="internal",
        client_id="liquidaity-internal-runtime",
        scopes=["liquidaity.main"],
        expires_at=int(time.time()) + 60,
        claims={"internal": principal},
    )}
    monkeypatch.setattr(mcp_auth, "get_access_token", lambda: current["token"])
    assert [tool.name for tool in asyncio.run(mcp_catalog_runtime.list_tools())] == ["canvas.inspect"]
    current["token"] = AccessToken(
        token="catalog",
        client_id="liquidaity-internal-runtime",
        scopes=["liquidaity.main"],
        expires_at=int(time.time()) + 60,
        claims={"internal": {"kind": "catalog-reader"}},
    )
    assert [tool.name for tool in asyncio.run(mcp_catalog_runtime.list_tools())] == [
        "canvas.inspect", "run_mag_one",
    ]
    current["token"] = None
    assert [tool.name for tool in asyncio.run(mcp_catalog_runtime.list_tools())] == [
        "canvas.inspect", "run_mag_one",
    ]

def test_builder_update_uses_explicit_target_and_revisions_with_saved_grants(monkeypatch):
    import asyncio
    import mcp_host
    from app import saved_card_tools
    observed = []
    async def update(args, **authority):
        observed.append((dict(args), dict(authority)))
        return {"ok": True, "cardId": args["cardId"]}
    monkeypatch.setattr(mcp_auth, "_authenticated_main_context", lambda: {
        "projectId": "project-1", "deckId": "deck_builder", "conversationId": "conversation-1",
        "parentRunId": "builder-run-1", "mainCardId": "builder", "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "delegate", "principalKind": "card-runtime",
        "grantedTools": ["card.update_configuration"],
    })
    monkeypatch.setattr(saved_card_tools, "card_update_configuration", update)
    args = {"cardId": "selected", "expectedRevision": "deck-revision-one",
            "expectedCardRevisionId": "selected-revision", "updates": {"prompt": "New prompt"}}
    result = asyncio.run(mcp_host._dispatch_tool("card.update_configuration", args))
    assert json.loads(result[0].text)["ok"] is True
    assert observed == [({**args, "projectId": "project-1", "deckId": "deck_builder"},
                         {"caller_card_id": "builder", "authenticated_user_edit": False})]
    for forged in ("_builderOperation", "_effectTargetCardId", "authenticated_user_edit"):
        rejected = asyncio.run(mcp_host._dispatch_tool("card.update_configuration", {**args, forged: True}))
        assert json.loads(rejected[0].text)["ok"] is False
    assert len(observed) == 1

def test_external_card_edit_uses_authenticated_context_not_caller_arguments(monkeypatch):
    import asyncio
    import mcp_host
    from app import saved_card_tools
    observed = []
    async def update(args, **authority):
        observed.append((args, authority))
        return {"ok": True}
    monkeypatch.setattr(mcp_auth, "_internal_mcp_principal", lambda: None)
    monkeypatch.setattr(mcp_auth, "_authenticated_main_context", lambda: {
        "projectId": "p", "deckId": "deck_builder", "mainCardId": "main",
        "conversationId": "c", "parentRunId": "r",
    })
    monkeypatch.setattr(saved_card_tools, "card_update_configuration", update)
    result = asyncio.run(mcp_host._dispatch_tool("card.update_configuration", {
        "cardId": "main", "updates": {"prompt": "Updated instructions"},
    }))
    assert json.loads(result[0].text)["ok"] is True
    assert observed[0][1]["authenticated_user_edit"] is True
    forged = asyncio.run(mcp_host._dispatch_tool("card.update_configuration", {
        "cardId": "main", "updates": {"prompt": "x"}, "authenticated_user_edit": True,
    }))
    assert json.loads(forged[0].text)["ok"] is False
    assert len(observed) == 1

def test_builder_cbm_read_forwards_explicit_provider_arguments_without_operation_tasks(
    monkeypatch, clear_live_provider_operations,
):
    import asyncio
    import mcp_host
    calls = []
    provider_tools = [Tool(
        name="search_graph",
        description="Search the graph.",
        inputSchema={
            "type": "object",
            "properties": {"project": {"type": "string"}, "query": {"type": "string"}},
        },
        annotations={"readOnlyHint": True},
    )]
    async def catalog():
        return provider_tools
    monkeypatch.setattr(mcp_auth, "_authenticated_main_context", lambda: {
        "projectId": "p", "deckId": "d", "mainCardId": "builder",
        "principalKind": "card-runtime", "grantedTools": ["cbm.search_graph"],
    })
    monkeypatch.setattr(mcp_cbm_provider, "_cbm_tools", catalog)
    monkeypatch.setattr(
        mcp_cbm_provider,
        "_CBM_NAMES",
        frozenset({"search_graph"}),
    )
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", (
        Tool(name="cbm.search_graph", inputSchema={"type": "object"}),
    ))
    async def call_cbm(name, args):
        calls.append((name, args))
        return []
    monkeypatch.setattr(mcp_provider_operations, "_call_cbm", call_cbm)
    mcp_provider_operations._register_cbm_catalog(
        mcp_provider_operations._namespace_provider_tools("cbm", provider_tools)
    )
    args = {"project": "C-Projects-LiquidAIty-main", "query": "materialize_idf"}
    asyncio.run(mcp_host._dispatch_tool("cbm.search_graph", args))
    assert calls == [("search_graph", args)]

def test_stdio_without_signed_principal_does_not_invent_main_context(monkeypatch):
    import asyncio
    import mcp_host

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "stdio")
    monkeypatch.setattr(mcp_auth, "OAUTH_ENFORCED", False)
    monkeypatch.setattr(mcp_auth, "get_access_token", lambda: None)

    assert mcp_auth._authenticated_main_context() is None
    result = asyncio.run(mcp_host.call_tool("main.context", {}))
    assert result.is_error is True
    assert json.loads(result.content[0].text) == {
        "ok": False,
        "error": "main_context_unavailable",
    }

def test_dispatch_rejects_caller_supplied_context_fields_without_auth_context(
    monkeypatch,
):
    import asyncio
    import mcp_host

    monkeypatch.setattr(mcp_auth, "OAUTH_ENFORCED", False)
    monkeypatch.setattr(mcp_auth, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(mcp_auth, "_internal_mcp_principal", lambda: None)

    result = asyncio.run(mcp_host._dispatch_tool("main.context", {
        "_mainContext": {"projectId": "caller-forged"},
        "_catalogDiagnostics": {"state": "caller-forged"},
    }))

    assert json.loads(result[0].text) == {
        "ok": False,
        "error": "caller_identity_rejected: _catalogDiagnostics,_mainContext",
    }

def test_authenticated_connection_reaches_read_only_handler_without_context_injection(
    monkeypatch,
):
    import asyncio
    import mcp_host
    from app import saved_canvas_tools
    from mcp.server.auth.provider import AccessToken

    context = {
        "projectId": "project-1",
        "deckId": "deck-1",
        "conversationId": "conversation-1",
        "parentRunId": "parent-1",
        "mainCardId": "main-1",
    }
    calls = []
    monkeypatch.setattr(mcp_auth, "_authenticated_main_context", lambda: dict(context))
    monkeypatch.setattr(
        mcp_auth,
        "get_access_token",
        lambda: AccessToken(
            token="verified",
            client_id="chatgpt-client",
            scopes=["main"],
            subject="auth0|test",
            claims={"main": context},
        ),
    )
    async def inspect_cards(arguments, **_authority):
        calls.append(arguments)
        return {"ok": True, "cards": []}

    monkeypatch.setattr(saved_canvas_tools, "canvas_inspect", inspect_cards)
    result = asyncio.run(mcp_host.call_tool("canvas.inspect", {}))

    assert json.loads(result[0].text) == {"ok": True, "cards": []}
    assert calls == [{"projectId": "project-1", "deckId": "deck-1"}]
    assert "context" not in result[0].text
