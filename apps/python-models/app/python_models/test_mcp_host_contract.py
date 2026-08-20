"""Focused contract proof for the one official Python MCP host."""

import json
import os
import socket
import sys
import threading
import time
from types import SimpleNamespace

import pytest

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)


def test_public_mcp_identity_is_liquidaity():
    import mcp_host

    options = mcp_host.server.create_initialization_options()
    assert options.server_name == "LiquidAIty"
    assert options.instructions == (
        "Connect ChatGPT to LiquidAIty projects, saved agent cards, CodeGraph, "
        "ThinkGraph, KnowGraph, and supported agent runtimes."
    )


def test_execution_receipt_observes_the_actual_provider_client_boundary():
    import asyncio
    import mcp_host

    class ProviderClient:
        async def generate_response(self, *_args, **_kwargs):
            return SimpleNamespace(usage={"input_tokens": 2, "output_tokens": 1})

    client = ProviderClient()
    receipt = mcp_host._execution_receipt("graphiti.search_nodes")
    token = mcp_host._ACTIVE_EXECUTION_RECEIPT.set(receipt)
    try:
        mcp_host._instrument_graphiti_provider_client(
            client,
            method_names=("generate_response",),
            compute="api_llm",
            dependency="graphiti_llm",
            provider="openai",
            model="openai/test-model",
            base_url="https://openrouter.ai/api/v1",
            credential_configured=True,
        )
        asyncio.run(client.generate_response("bounded prompt"))
    finally:
        mcp_host._ACTIVE_EXECUTION_RECEIPT.reset(token)

    assert receipt["compute"] == "api_llm"
    assert [call["state"] for call in receipt["providerCalls"]] == [
        "started",
        "completed",
    ]
    assert receipt["providerCalls"][-1]["baseUrlHostname"] == "openrouter.ai"
    assert receipt["providerCalls"][-1]["credentialConfigured"] is True
    assert receipt["providerSubstitution"] is False


def test_caller_enforcement_reads_explicit_idd_permissions():
    import mcp_host

    allowed = {
        "_callerCardId": "card-main",
        "_callerRuntimeKind": "hermes",
        "_callerRuntimeMode": "main",
    }
    assert mcp_host._enforce_tool_caller("run_mag_one", allowed) is None
    denied = {
        "_callerCardId": "card-hermes",
        "_callerRuntimeKind": "hermes",
        "_callerRuntimeMode": "kanban",
    }
    assert mcp_host._enforce_tool_caller("run_mag_one", denied) == (
        "tool_caller_not_authorized: run_mag_one requires hermes/main"
    )
    unrestricted: dict[str, str] = {}
    assert mcp_host._enforce_tool_caller("cbm.search_graph", unrestricted) is None


def test_graphiti_uses_knowgraph_openrouter_embedding_configuration(monkeypatch):
    import mcp_host

    monkeypatch.setenv("OPENROUTER_API_KEY", "router-key")
    monkeypatch.setenv("OPENROUTER_OPENAI_BASE_URL", "https://router.example/v1")
    monkeypatch.setenv("KNOWGRAPH_OPENROUTER_EMBEDDING_MODEL", "openai/test-embedder")
    monkeypatch.setenv("KNOWGRAPH_OPENROUTER_EMBEDDING_DIM", "1024")
    monkeypatch.setenv("NEO4J_DATABASE", "knowgraph")
    monkeypatch.delenv("GRAPHITI_EMBEDDER_MODEL", raising=False)

    config = mcp_host._graphiti_config()

    assert config.database.providers.neo4j.database == "knowgraph"
    assert config.embedder.provider == "openai"
    assert config.embedder.model == "openai/test-embedder"
    assert config.embedder.dimensions == 1024
    assert config.embedder.providers.openai.api_key == "router-key"
    assert config.embedder.providers.openai.api_url == "https://router.example/v1"


def test_graphiti_preserves_explicit_embedder_model_override(monkeypatch):
    import mcp_host

    monkeypatch.setenv("GRAPHITI_EMBEDDER_MODEL", "local/embeddinggemma")
    monkeypatch.setenv("KNOWGRAPH_OPENROUTER_EMBEDDING_MODEL", "openai/ignored")

    assert mcp_host._graphiti_config().embedder.model == "local/embeddinggemma"


def test_graphiti_is_optional_when_provider_credentials_are_absent(monkeypatch):
    import asyncio
    import mcp_host

    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_MODULE", None)
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_TOOLS", None)
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_NAMES", frozenset())
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_UNAVAILABLE", None)

    assert asyncio.run(mcp_host._native_graphiti_tools()) == []
    assert mcp_host._NATIVE_GRAPHITI_NAMES == frozenset()
    assert mcp_host._NATIVE_GRAPHITI_UNAVAILABLE == {
        "ok": False,
        "failureCode": "optional_capability_unavailable",
        "errorCategory": "DEPENDENCY_UNAVAILABLE",
        "retryable": False,
        "dependency": "graphiti",
        "detail": "Graphiti provider credentials are not configured.",
    }


def test_graphiti_initialization_failure_never_leaks_secrets_or_kills_mcp(monkeypatch):
    import asyncio
    import builtins
    import mcp_host

    secret = "sk-sensitive-provider-value"
    monkeypatch.setenv("OPENROUTER_API_KEY", secret)
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_MODULE", None)
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_TOOLS", None)
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_NAMES", frozenset())
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_UNAVAILABLE", None)
    real_import = builtins.__import__

    def failing_import(name, *args, **kwargs):
        if name == "graphiti_mcp_server":
            raise RuntimeError(f"provider rejected {secret}")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", failing_import)

    assert asyncio.run(mcp_host._native_graphiti_tools()) == []
    failure_text = json.dumps(mcp_host._NATIVE_GRAPHITI_UNAVAILABLE)
    assert secret not in failure_text
    assert "RuntimeError" in failure_text

    later = asyncio.run(mcp_host.call_tool("main.context", {}))
    assert later.isError is True
    later_payload = json.loads(later.content[0].text)
    assert later_payload["error"] == "main_context_unavailable"
    assert secret not in json.dumps(later_payload)


def test_call_tool_appends_canonical_receipt_and_typed_provider_failure(monkeypatch):
    import asyncio
    import mcp_host

    async def dispatch(name, _arguments):
        if name == "graphiti.search_nodes":
            return mcp_host._normalize_graphiti_result(
                [mcp_host.TextContent(type="text", text=json.dumps({
                    "error": "OpenAI insufficient credits for embeddings"
                }))]
            )
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)
    failed = asyncio.run(mcp_host.call_tool("graphiti.search_nodes", {"query": "x"}))
    assert failed.isError is True
    failure = json.loads(failed.content[0].text)
    assert failure["failureCode"] == "insufficient_credits"
    assert failure["retryable"] is False
    failed_receipt = json.loads(failed.content[-1].text)["executionReceipt"]
    assert failed_receipt["state"] == "failed"
    assert failed_receipt["failureCode"] == "insufficient_credits"

    later = asyncio.run(mcp_host.call_tool("main.context", {}))
    assert json.loads(later[0].text)["ok"] is True
    later_receipt = json.loads(later[-1].text)["executionReceipt"]
    assert "compute" not in later_receipt
    assert "risk" not in later_receipt
    assert later_receipt["state"] == "completed"


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
    monkeypatch.setattr(mcp_host, "get_access_token", lambda: current["token"])

    assert mcp_host._authenticated_main_context() == contexts[0]
    current["token"] = AccessToken(
        token="second",
        client_id="chatgpt-client",
        scopes=["main"],
        expires_at=int(time.time()) + 60,
        claims={"main": contexts[1]},
    )
    assert mcp_host._authenticated_main_context() == contexts[1]
    current["token"] = None
    assert mcp_host._authenticated_main_context() is None
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
    monkeypatch.setattr(mcp_host, "get_access_token", lambda: current["token"])
    assert mcp_host._authenticated_main_context() is None


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
        "grantedTools": ["canvas.inspect", "card.run_assistant_agent"],
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

    monkeypatch.setattr(mcp_host, "INTERNAL_MCP_SECRET", secret)
    verifier = mcp_host.Auth0TokenVerifier(
        mcp_host.OAuthConfig(
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
    monkeypatch.setattr(mcp_host, "get_access_token", lambda: verified)
    assert mcp_host._authenticated_main_context() == {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "run-1",
        "mainCardId": "card-main",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "main",
        "principalKind": "card-runtime",
        "grantedTools": ["canvas.inspect", "card.run_assistant_agent"],
    }
    assert mcp_host._request_tool_is_allowed("canvas.inspect") is True
    assert mcp_host._request_tool_is_allowed("run_mag_one") is False


def test_mcp2_per_call_meta_resolves_child_run_and_card_without_model_identity(monkeypatch):
    import mcp_host

    principal = {
        "kind": "card-runtime",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "main-run",
        "callerCardId": "card_coder",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "delegate",
        "grantedTools": ["cbm.search_graph"],
        "requiresExecutionContext": True,
    }
    monkeypatch.setattr(mcp_host, "_internal_mcp_principal", lambda: principal)
    monkeypatch.setattr(
        type(mcp_host.server),
        "request_context",
        property(lambda _self: SimpleNamespace(meta={"liquidaity/execution": "context-1"})),
    )
    bridge_calls = []

    def bridge(path, payload):
        bridge_calls.append((path, payload))
        return json.dumps({
            "ok": True,
            "context": {
                "projectId": "project-1",
                "deckId": "deck_builder",
                "conversationId": "conversation-1",
                "runId": "child-run",
                "rootRunId": "main-run",
                "cardId": "card_coder",
                "runtimeMode": "delegate",
                "nativeChildId": "sa-coder",
                "grantedTools": ["cbm.search_graph"],
            },
        })

    monkeypatch.setattr(mcp_host, "_bridge_sync", bridge)
    context = mcp_host._request_execution_context()
    assert context["parentRunId"] == "child-run"
    assert context["mainCardId"] == "card_coder"
    assert context["nativeChildId"] == "sa-coder"
    assert bridge_calls == [(
        "internal_execution_context",
        {"contextId": "context-1", "principal": principal},
    )]


def test_required_child_execution_meta_fails_closed_when_missing(monkeypatch):
    import mcp_host

    monkeypatch.setattr(mcp_host, "_internal_mcp_principal", lambda: {
        "kind": "card-runtime", "requiresExecutionContext": True,
    })
    monkeypatch.setattr(
        type(mcp_host.server),
        "request_context",
        property(lambda _self: SimpleNamespace(meta={})),
    )
    with pytest.raises(PermissionError, match="mcp_execution_context_missing"):
        mcp_host._request_execution_context()


def test_internal_mcp_catalog_is_filtered_but_public_catalog_stays_complete(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.server.auth.provider import AccessToken

    tools = (
        mcp_host.Tool(name="canvas.inspect", description="x", inputSchema={"type": "object"}),
        mcp_host.Tool(name="run_mag_one", description="y", inputSchema={"type": "object"}),
    )
    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_host, "_HTTP_CATALOG_TOOLS", tools)
    principal = {
        "kind": "card-runtime",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "run-1",
        "callerCardId": "card-helper",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "kanban",
        "grantedTools": ["canvas.inspect"],
    }
    current = {"token": AccessToken(
        token="internal",
        client_id="liquidaity-internal-runtime",
        scopes=["liquidaity.main"],
        expires_at=int(time.time()) + 60,
        claims={"internal": principal},
    )}
    monkeypatch.setattr(mcp_host, "get_access_token", lambda: current["token"])
    assert [tool.name for tool in asyncio.run(mcp_host.list_tools())] == ["canvas.inspect"]
    current["token"] = None
    assert [tool.name for tool in asyncio.run(mcp_host.list_tools())] == [
        "canvas.inspect", "run_mag_one",
    ]


def test_internal_card_invocation_injects_caller_identity_and_root_entry_omits_sender(monkeypatch):
    import asyncio
    import mcp_host
    from app import control_plane

    context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "parent-run-1",
        "mainCardId": "card-main",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "main",
        "principalKind": "card-runtime",
        "grantedTools": ["card.run_assistant_agent"],
    }
    calls = []

    async def run(args):
        calls.append(dict(args))
        return {"ok": True, "result": {"status": "completed", "output": "ok"}}

    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: dict(context))
    monkeypatch.setattr(control_plane, "card_run_assistant_agent", run)
    result = asyncio.run(mcp_host._dispatch_tool(
        "card.run_assistant_agent",
        {"cardId": "card-coder", "input": "bounded task"},
    ))
    assert json.loads(result[0].text)["ok"] is True
    assert calls[-1] == {
        "cardId": "card-coder",
        "input": "bounded task",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "correlationId": calls[-1]["correlationId"],
        "originatingAgentId": "card-main",
        "originatingRunId": "parent-run-1",
    }

    context["principalKind"] = "system-root"
    calls.clear()
    asyncio.run(mcp_host._dispatch_tool(
        "card.run_assistant_agent",
        {"cardId": "card-main", "input": "root entry"},
    ))
    assert "originatingAgentId" not in calls[-1]
    assert "originatingRunId" not in calls[-1]


def test_stdio_process_owned_context_and_tool_allowlist_are_fail_closed(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.server.auth.provider import AccessToken

    context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "parent-1",
        "mainCardId": "card_main_chat",
    }
    current = {"token": None}
    monkeypatch.setattr(mcp_host, "get_access_token", lambda: current["token"])
    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "stdio")
    monkeypatch.setenv("MCP_TRUSTED_MAIN_CONTEXT", json.dumps(context))
    monkeypatch.setenv("MCP_TOOL_ALLOWLIST", "main.context,canvas.inspect")

    async def forbidden_native_init():
        raise AssertionError("ungranted native catalog initialized")

    monkeypatch.setattr(mcp_host, "_native_engraphis_tools", forbidden_native_init)
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", forbidden_native_init)
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", forbidden_native_init)

    assert mcp_host._authenticated_main_context() == context
    assert [tool.name for tool in asyncio.run(mcp_host.list_tools())] == [
        "main.context",
        "canvas.inspect",
    ]

    denied = asyncio.run(mcp_host.call_tool("web_search", {"query": "forbidden"}))
    assert denied.isError is True
    assert "tool_not_granted" in denied.content[0].text

    current["token"] = AccessToken(
        token="incomplete",
        client_id="chatgpt-client",
        scopes=["main"],
        expires_at=int(time.time()) + 60,
        claims={"main": {"projectId": "project-1"}},
    )
    assert mcp_host._authenticated_main_context() is None

    monkeypatch.delenv("MCP_TRUSTED_MAIN_CONTEXT")
    assert mcp_host._configured_tool_allowlist() is None


def test_trusted_hermes_stdio_context_enforces_main_and_helper_tool_roles(monkeypatch):
    import mcp_host

    helper_context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "parent-1",
        "mainCardId": "card_hermes_steward",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "kanban",
    }
    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "stdio")
    monkeypatch.setenv("MCP_TRUSTED_MAIN_CONTEXT", json.dumps(helper_context))

    assert mcp_host._trusted_stdio_main_context() == helper_context
    assert mcp_host._enforce_tool_caller(
        "run_mag_one",
        {
            "_callerCardId": "card_hermes_steward",
            "_callerRuntimeKind": "hermes",
            "_callerRuntimeMode": "kanban",
        },
        authenticated_external=True,
    ) == "tool_caller_not_authorized: run_mag_one requires hermes/main"


def test_authenticated_connection_reaches_read_only_handler_without_context_injection(
    monkeypatch,
):
    import asyncio
    import mcp_host
    from app import control_plane
    from mcp.server.auth.provider import AccessToken

    context = {
        "projectId": "project-1",
        "deckId": "deck-1",
        "conversationId": "conversation-1",
        "parentRunId": "parent-1",
        "mainCardId": "main-1",
    }
    calls = []
    bridge_calls = []
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: dict(context))
    monkeypatch.setattr(
        mcp_host,
        "get_access_token",
        lambda: AccessToken(
            token="verified",
            client_id="chatgpt-client",
            scopes=["main"],
            subject="auth0|test",
            claims={"main": context},
        ),
    )
    monkeypatch.setattr(
        mcp_host,
        "_bridge",
        lambda *_args, **_kwargs: bridge_calls.append(True),
    )

    async def inspect_cards(arguments):
        calls.append(arguments)
        return {"ok": True, "cards": []}

    monkeypatch.setattr(control_plane, "canvas_inspect", inspect_cards)
    result = asyncio.run(mcp_host.call_tool("canvas.inspect", {}))

    assert json.loads(result[0].text) == {"ok": True, "cards": []}
    assert calls == [{"projectId": "project-1", "deckId": "deck-1"}]
    assert bridge_calls == []
    assert "context" not in result[0].text


def test_child_scoped_dispatch_attaches_attention_to_the_real_child_run_and_card(
    monkeypatch,
):
    import asyncio
    import mcp_host
    from app.python_models import card_domain
    from mcp.types import CallToolResult, TextContent

    context = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "conversationId": "conversation-one",
        "parentRunId": "child-run-one",
        "rootRunId": "main-run-one",
        "mainCardId": "card_coder",
        "nativeChildId": "sa-coder",
        "grantedTools": ["cbm.search_graph"],
    }
    native_text = json.dumps({
        "results": [{"qualified_name": "pkg._runtime_owner"}],
        "total": 1,
    })
    observed = []

    async def dispatch(_name, _arguments):
        return CallToolResult(
            content=[TextContent(type="text", text=native_text)],
            structuredContent={"result": json.loads(native_text)},
        )

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)
    monkeypatch.setattr(mcp_host, "_request_tool_is_allowed", lambda _name: True)
    monkeypatch.setattr(mcp_host, "_request_execution_context", lambda: dict(context))
    monkeypatch.setattr(
        card_domain,
        "observe_native_attention",
        lambda event: observed.append(dict(event)) or True,
    )

    result = asyncio.run(mcp_host.call_tool(
        "mcp__main_runtime_abcd__cbm_search_graph",
        {"project": "C-Projects-LiquidAIty-main", "name_pattern": ".*_runtime_owner.*"},
    ))

    assert isinstance(result, CallToolResult)
    assert result.content[0].text == native_text
    assert json.loads(result.content[-1].text)["executionReceipt"]["state"] == "completed"
    assert result.meta is not None
    attention = result.meta["nativeAttention"]
    assert attention["toolName"] == "cbm.search_graph"
    assert attention["nativeNodeIds"] == ["pkg._runtime_owner"]
    assert attention["nativeEdgeIds"] == []
    assert attention["projectId"] == "project-one"
    assert attention["runId"] == "child-run-one"
    assert attention["cardId"] == "card_coder"
    assert observed == [attention]


def test_official_dispatch_emits_no_attention_for_non_graph_result(monkeypatch):
    import asyncio
    import mcp_host
    from app.python_models import card_domain
    from mcp.types import CallToolResult, TextContent

    async def dispatch(_name, _arguments):
        return CallToolResult(
            content=[TextContent(type="text", text='{"ok":true}')],
            structuredContent={"ok": True},
        )

    observed = []
    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)
    monkeypatch.setattr(mcp_host, "_request_tool_is_allowed", lambda _name: True)
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(
        card_domain,
        "observe_native_attention",
        lambda event: observed.append(event) or True,
    )

    result = asyncio.run(mcp_host.call_tool("canvas.inspect", {}))

    assert isinstance(result, CallToolResult)
    assert result.content[0].text == '{"ok":true}'
    assert not result.meta or "nativeAttention" not in result.meta
    assert observed == []


def test_agentgraph_and_direct_magentic_input_dispatch_without_running(
    monkeypatch,
):
    import asyncio
    import mcp_host
    from app import control_plane

    context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "external-mcp:grant-1",
        "parentRunId": "external-main:grant-1",
        "mainCardId": "card_main_chat",
    }
    calls = []
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: dict(context))

    async def inspect(args):
        calls.append(("agentgraph.inspect", dict(args)))
        return {"ok": True, "authority": "postgresql-age-agentgraph", "runs": []}

    async def bridge(path, payload):
        calls.append((path, dict(payload)))
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(control_plane, "agentgraph_inspect", inspect)
    monkeypatch.setattr(mcp_host, "_bridge", bridge)

    inspected = asyncio.run(
        mcp_host._dispatch_tool("agentgraph.inspect", {"runId": "run-1", "limit": 5})
    )
    assert json.loads(inspected[0].text)["authority"] == "postgresql-age-agentgraph"
    assert calls[-1] == (
        "agentgraph.inspect",
        {
            "runId": "run-1",
            "limit": 5,
            "projectId": "project-1",
            "deckId": "deck_builder",
            "conversationId": "external-mcp:grant-1",
        },
    )

    executed = asyncio.run(
        mcp_host._dispatch_tool(
            "run_mag_one",
            {"input": "exact proposed mission"},
        )
    )
    assert json.loads(executed[0].text) == {"ok": True}
    assert calls[-1][0] == "run_configured_card"
    assert calls[-1][1] == {
        "action": "execute",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "senderCardId": "card_main_chat",
        "correlationId": calls[-1][1]["correlationId"],
        "conversationId": "external-mcp:grant-1",
        "input": "exact proposed mission",
    }


def test_lifecycle_errors_remain_typed_and_distinct(monkeypatch):
    import asyncio
    import mcp_host

    async def dispatch(_name, arguments):
        raise RuntimeError(str(arguments["error"]))

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)

    async def check():
        results = {}
        for name, message in {
            "session": "Session terminated",
            "auth": "authentication expired",
            "arguments": "invalid arguments",
            "resource": "no workspace named 'missing' yet",
            "service": "service unavailable",
            "internal": "unexpected handler failure",
        }.items():
            result = await mcp_host.call_tool("test", {"error": message})
            results[name] = json.loads(result.content[0].text)
        return results

    results = asyncio.run(check())
    assert results["session"]["failureCode"] == "session_terminated"
    assert results["auth"]["failureCode"] == "authentication_expired"
    assert results["arguments"]["failureCode"] == "invalid_arguments"
    assert results["resource"]["failureCode"] == "resource_not_found"
    assert results["resource"]["errorCategory"] == "NOT_FOUND"
    assert results["service"]["failureCode"] == "service_unavailable"
    assert results["internal"]["failureCode"] == "internal_failure"
    assert results["session"]["failureCode"] != "invalid_arguments"
    assert results["auth"]["failureCode"] != "invalid_arguments"


def test_timed_out_call_does_not_block_completed_sibling(monkeypatch):
    import asyncio
    import mcp_host

    async def dispatch(name, _arguments):
        if name == "slow":
            await asyncio.sleep(60)
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True, "name": name}))]

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)
    monkeypatch.setattr(mcp_host, "_MCP_CALL_TIMEOUT_SECONDS", 0.02)

    async def check():
        slow = asyncio.create_task(mcp_host.call_tool("slow", {}))
        sibling = await asyncio.wait_for(mcp_host.call_tool("sibling", {}), timeout=0.5)
        timed_out = await asyncio.wait_for(slow, timeout=0.5)
        return sibling, timed_out

    sibling, timed_out = asyncio.run(check())
    assert json.loads(sibling[0].text) == {"ok": True, "name": "sibling"}
    assert timed_out.isError is True
    assert json.loads(timed_out.content[0].text)["failureCode"] == "timeout"


def test_only_native_cbm_index_uses_the_native_request_timeout(monkeypatch):
    import mcp_host

    monkeypatch.setattr(mcp_host, "_MCP_CALL_TIMEOUT_SECONDS", 30.0)
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_REQUEST_TIMEOUT_SECONDS", 300.0)

    assert mcp_host._mcp_tool_timeout_seconds("cbm.index_repository") == 300.0
    assert mcp_host._mcp_tool_timeout_seconds("cbm.index_status") == 30.0
    assert mcp_host._mcp_tool_timeout_seconds("graphiti.get_status") == 30.0


def test_plain_text_does_not_hide_a_later_structured_tool_error():
    import json
    import mcp_host

    result = [
        mcp_host.TextContent(type="text", text="native diagnostic"),
        mcp_host.TextContent(
            type="text",
            text=json.dumps({"ok": False, "error": "native_failure"}),
        ),
    ]

    assert mcp_host._tool_result_category(result) == "tool_error"


def test_catalog_preserves_native_annotations_and_adds_only_source_identity():
    import mcp_host

    native = mcp_host.Tool(
        name="search_graph",
        description="native",
        inputSchema={"type": "object", "properties": {"project": {"type": "string"}}},
        annotations={
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
    )
    bound = mcp_host._namespace_native_tools("cbm", [native])[0]

    assert bound.name == "cbm.search_graph"
    assert bound.inputSchema == native.inputSchema
    assert bound.annotations == native.annotations
    assert bound.meta == {
        "liquidaitySource": {
            "sourceId": "cbm",
            "namespace": "cbm",
            "nativeName": "search_graph",
            "connectionKind": "external-mcp",
        }
    }


def test_graphiti_timeout_cancels_work_and_later_dispatch_recovers(monkeypatch):
    import asyncio
    import mcp_host

    cancelled = False

    class NativeMcp:
        async def call_tool(self, name, _arguments):
            nonlocal cancelled
            if name == "slow":
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    cancelled = True
                    raise
            return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(
        mcp_host, "_NATIVE_GRAPHITI_MODULE", SimpleNamespace(mcp=NativeMcp())
    )
    monkeypatch.setattr(mcp_host, "_NATIVE_TOOL_TIMEOUT_SECONDS", 0.01)

    async def run():
        with pytest.raises(RuntimeError, match="native_graphiti_timeout:slow"):
            await mcp_host._call_native_graphiti("slow", {})
        return await mcp_host._call_native_graphiti("later", {})

    later = asyncio.run(run())
    assert cancelled is True
    assert json.loads(later.content[0].text)["ok"] is True


def test_external_transport_uses_the_unmodified_canonical_catalog_and_schemas():
    import asyncio
    import mcp_host

    async def check():
        tools = await mcp_host.list_tools()
        by_name = {tool.name: tool for tool in tools}
        assert set(by_name["card.run_assistant_agent"].inputSchema["required"]) == {
            "cardId",
            "input",
        }
        assert (
            "instructionId"
            not in by_name["card.run_assistant_agent"].inputSchema["properties"]
        )
        assert by_name["run_mag_one"].inputSchema["required"] == [
            "input",
            "projectId",
            "deckId",
        ]
        assert "minProperties" not in str(
            by_name["card.update_configuration"].inputSchema
        )
        reasoning_schema = by_name["card.update_configuration"].inputSchema[
            "properties"
        ]["updates"]["properties"]["reasoningEffort"]
        assert reasoning_schema == {
            "type": "string",
            "enum": ["low", "medium", "high", "xhigh"],
        }
        assert "main.context" in by_name
        assert "agentgraph.inspect" in by_name
        assert "coder.status" not in by_name
        assert all(
            tool.inputSchema.get("additionalProperties") is False
            for name, tool in by_name.items()
            if not name.startswith(("engraphis.", "cbm.", "graphiti."))
        )
        assert not any(name.startswith("worldsignals.") for name in by_name)
        assert by_name
        assert len(by_name) == len(set(by_name))
        return {name: tool.model_dump() for name, tool in by_name.items()}

    catalog = asyncio.run(check())
    assert len(catalog) == len(set(catalog))


def test_catalog_identity_covers_the_complete_frozen_tool_descriptor():
    import mcp_host
    from mcp.types import Tool

    original = Tool(
        name="example.read",
        description="Original description",
        inputSchema={
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
            "additionalProperties": False,
        },
    )
    changed = Tool(
        name="example.read",
        description="Changed description",
        inputSchema={
            "type": "object",
            "properties": {"query": {"type": "string", "minLength": 1}},
            "required": ["query"],
            "additionalProperties": False,
        },
    )

    assert mcp_host._catalog_identity([original])[0] == 1
    assert mcp_host._catalog_identity([original])[1] != mcp_host._catalog_identity([changed])[1]


def test_mag_one_uses_direct_transient_input_contract():
    import mcp_host

    assert mcp_host._ALLOWED_KEYS["run_mag_one"] == {
        "projectId", "deckId", "input", "conversationId",
    }


def test_native_engraphis_registry_is_initialized_once_without_schema_adaptation():
    import asyncio
    import mcp_host

    async def check():
        await mcp_host._initialize_native_engraphis()
        native = {
            tool.name: tool
            for tool in await mcp_host._native_engraphis_mcp().list_tools()
        }
        first = await mcp_host._native_engraphis_tools()
        await mcp_host._initialize_native_engraphis()
        second = await mcp_host._native_engraphis_tools()
        assert len(native) == 31
        assert set(native) == {tool.name for tool in first}
        assert len(first) == 31
        assert [id(tool) for tool in first] == [id(tool) for tool in second]
        assert {tool.name for tool in first} == set(native)
        for tool in first:
            assert tool.model_dump() == native[tool.name].model_dump()
        combined = await mcp_host.list_tools()
        combined_names = [tool.name for tool in combined]
        assert len(set(combined_names)) == len(combined_names)
        combined_identity = mcp_host._catalog_identity(combined)
        assert combined_identity[0] == len(combined_names)
        assert len(combined_identity[1]) == 64
        assert {
            "main.context",
            "canvas.inspect",
            "card.run_assistant_agent",
        }.issubset(set(combined_names))
        assert {
            "coder.inspect",
            "coder.effective_tools",
            "coder.account",
            "coder.stop",
            "coder.steer",
        }.isdisjoint(combined_names)
        assert {
            f'engraphis.{name.removeprefix("engraphis_")}' for name in set(native)
        }.issubset(combined_names)
        assert not set(native).intersection(combined_names)

    asyncio.run(check())


def test_native_engraphis_uses_the_cached_local_embedding_model(monkeypatch):
    import mcp_host

    monkeypatch.delenv("HF_HUB_OFFLINE", raising=False)
    monkeypatch.delenv("TRANSFORMERS_OFFLINE", raising=False)
    mcp_host._load_native_engraphis_mcp()
    assert os.environ["HF_HUB_OFFLINE"] == "1"
    assert os.environ["TRANSFORMERS_OFFLINE"] == "1"


def test_native_engraphis_catalog_discovery_never_constructs_memory_or_embedder(
        monkeypatch):
    import asyncio
    import engraphis.mcp_server as engraphis_mcp
    import engraphis.backends.embedder_st as embedder_st
    import engraphis.core.engine as engraphis_engine
    import mcp_host

    constructions = []
    monkeypatch.setattr(
        engraphis_mcp.MemoryService,
        "create",
        lambda *args, **kwargs: constructions.append("memory_service"),
    )
    monkeypatch.setattr(
        embedder_st,
        "_construct_local_sentence_transformer",
        lambda *args, **kwargs: constructions.append("sentence_transformer"),
    )
    monkeypatch.setattr(
        engraphis_engine,
        "get_embedder",
        lambda *args, **kwargs: constructions.append("embedder"),
    )
    monkeypatch.setattr(mcp_host, "_NATIVE_ENGRAPHIS_MCP", None)
    monkeypatch.setattr(mcp_host, "_NATIVE_ENGRAPHIS_TOOLS", None)
    monkeypatch.setattr(mcp_host, "_NATIVE_ENGRAPHIS_NAMES", frozenset())

    asyncio.run(mcp_host._initialize_native_engraphis())

    assert len(mcp_host._NATIVE_ENGRAPHIS_TOOLS or ()) == 31
    assert constructions == []


def test_native_engraphis_nonsemantic_dispatch_has_no_global_embedding_gate(monkeypatch):
    import asyncio
    import mcp_host

    native_result = mcp_host.TextContent(
        type="text",
        text=json.dumps({"ok": True, "source": "native"}),
    )

    class NativeMcp:
        async def call_tool(self, name, arguments):
            return [native_result]

    async def initialized():
        return None

    async def check():
        monkeypatch.setattr(mcp_host, "_initialize_native_engraphis", initialized)
        monkeypatch.setattr(
            mcp_host,
            "_NATIVE_ENGRAPHIS_NAMES",
            frozenset({"engraphis_stats"}),
        )
        monkeypatch.setattr(mcp_host, "_native_engraphis_mcp", lambda: NativeMcp())

        ready = await mcp_host.call_tool("engraphis.stats", {})
        assert ready.content[0] is native_result

    asyncio.run(check())


def test_streamable_http_binds_before_catalog_provider_initialization(monkeypatch):
    import asyncio
    import mcp_host

    events = []

    async def initialized_engraphis():
        events.append("engraphis_registry")

    async def initialized_graphiti():
        events.append("graphiti_registry")

    async def initialized_cbm():
        events.append("cbm_registry")
        return []

    async def run_http():
        events.append("http")

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "_initialize_native_engraphis", initialized_engraphis)
    monkeypatch.setattr(mcp_host, "_initialize_native_graphiti", initialized_graphiti)
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", initialized_cbm)
    monkeypatch.setattr(mcp_host, "_run_streamable_http", run_http)

    asyncio.run(mcp_host.main())

    assert events == ["http"]


def test_http_tools_list_never_exposes_initializing_or_failed_catalog(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.types import Tool

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_host, "_HTTP_CATALOG_TOOLS", None)
    with pytest.raises(RuntimeError, match="mcp_catalog_initializing"):
        asyncio.run(mcp_host.list_tools())

    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "failed")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", "RuntimeError: native_cbm_failed")
    with pytest.raises(RuntimeError, match="native_cbm_failed"):
        asyncio.run(mcp_host.list_tools())

    catalog_size = 7
    tools = tuple(
        Tool(
            name=f"ready.tool_{index}",
            description="ready",
            inputSchema={"type": "object", "properties": {}},
        )
        for index in range(catalog_size)
    )
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_host, "_HTTP_CATALOG_TOOLS", tools)
    ready = asyncio.run(mcp_host.list_tools())
    assert len(ready) == len({tool.name for tool in ready}) == catalog_size


def test_http_catalog_initialization_is_process_wide_once(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.types import Tool

    calls = 0

    catalog_size = 5

    async def complete_catalog():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0)
        return [
            Tool(
                name=f"ready.tool_{index}",
                description="ready",
                inputSchema={"type": "object", "properties": {}},
            )
            for index in range(catalog_size)
        ]

    monkeypatch.setattr(mcp_host, "_materialize_complete_catalog", complete_catalog)
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_host, "_HTTP_CATALOG_TOOLS", None)
    monkeypatch.setattr(mcp_host, "_HTTP_CATALOG_INITIALIZATION_TASK", None)

    async def check():
        first = mcp_host._start_http_catalog_initialization()
        second = mcp_host._start_http_catalog_initialization()
        assert first is second
        await asyncio.gather(first, second)

    asyncio.run(check())
    assert calls == 1
    assert mcp_host._CATALOG_STATE == "ready"
    assert len(mcp_host._HTTP_CATALOG_TOOLS or ()) == catalog_size


def test_http_catalog_task_cannot_end_in_false_initializing_state(monkeypatch):
    import asyncio
    import mcp_host

    async def incomplete_initializer():
        return None

    monkeypatch.setattr(
        mcp_host, "_initialize_http_catalog_once", incomplete_initializer
    )
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE_CODE", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE_SUMMARY", None)
    monkeypatch.setattr(mcp_host, "_HTTP_CATALOG_TOOLS", None)
    monkeypatch.setattr(mcp_host, "_HTTP_CATALOG_INITIALIZATION_TASK", None)

    async def check():
        await mcp_host._start_http_catalog_initialization()
        await asyncio.sleep(0)

    asyncio.run(check())
    diagnostics = mcp_host._catalog_diagnostics()
    assert diagnostics["catalogState"] == "failed"
    assert diagnostics["failureCode"] == "catalog_initializer_ended_without_state"
    assert mcp_host._HTTP_CATALOG_TOOLS is None


def test_http_catalog_initialization_has_no_arbitrary_30_second_deadline():
    import inspect
    import mcp_host

    source = inspect.getsource(mcp_host._initialize_http_catalog_once)
    assert "wait_for" not in source
    assert "30" not in source


def test_catalog_progress_names_completed_and_active_families(monkeypatch):
    import asyncio
    import mcp_host

    snapshots = []

    async def engraphis_catalog():
        snapshots.append(mcp_host._catalog_diagnostics())
        return []

    async def cbm_catalog():
        snapshots.append(mcp_host._catalog_diagnostics())
        return []

    async def graphiti_catalog():
        snapshots.append(mcp_host._catalog_diagnostics())
        return []

    monkeypatch.setattr(mcp_host, "_configured_tool_allowlist", lambda: None)
    monkeypatch.setattr(mcp_host, "_native_engraphis_tools", engraphis_catalog)
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", cbm_catalog)
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", graphiti_catalog)
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_host, "_CATALOG_COMPLETED_FAMILIES", ())
    monkeypatch.setattr(mcp_host, "_CATALOG_INITIALIZING_FAMILY", "liquidaity")

    asyncio.run(mcp_host._materialize_complete_catalog())

    assert [item["initializingCatalogFamily"] for item in snapshots] == [
        "engraphis",
        "cbm",
        "graphiti",
    ]
    assert [item["completedCatalogFamilies"] for item in snapshots] == [
        ["liquidaity"],
        ["liquidaity", "engraphis"],
        ["liquidaity", "engraphis", "cbm"],
    ]
    assert mcp_host._CATALOG_COMPLETED_FAMILIES == (
        "liquidaity",
        "engraphis",
        "cbm",
        "graphiti",
    )
    assert mcp_host._CATALOG_INITIALIZING_FAMILY is None


def test_http_listener_and_health_are_live_while_catalog_is_slow(monkeypatch):
    import asyncio
    import httpx
    import mcp_host
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from mcp.types import Tool

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    entered = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    catalog_size = 6

    async def slow_complete_catalog():
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        return [
            Tool(
                name=f"ready.tool_{index}",
                description="ready",
                inputSchema={"type": "object", "properties": {}},
            )
            for index in range(catalog_size)
        ]

    async def closed_graphiti():
        return None

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "HTTP_MCP_PORT", port)
    monkeypatch.setattr(mcp_host, "OAUTH_ENFORCED", False)
    monkeypatch.setattr(mcp_host, "_materialize_complete_catalog", slow_complete_catalog)
    monkeypatch.setattr(mcp_host, "_close_native_graphiti", closed_graphiti)
    monkeypatch.setattr(mcp_host, "_close_native_cbm", lambda: None)
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_host, "_HTTP_CATALOG_TOOLS", None)
    monkeypatch.setattr(mcp_host, "_HTTP_CATALOG_INITIALIZATION_TASK", None)

    async def check():
        server_task = asyncio.create_task(mcp_host.main())
        try:
            base_url = f"http://127.0.0.1:{port}"
            async with httpx.AsyncClient(base_url=base_url, timeout=2) as client:
                for _ in range(30):
                    try:
                        health = await client.get("/health")
                        if health.status_code == 200:
                            break
                    except Exception:
                        pass
                    await asyncio.sleep(0.1)
                else:
                    raise RuntimeError("http_health_not_ready")
                await entered.wait()
                assert health.json()["catalogState"] == "initializing"
                readiness = await client.get("/health/ready")
                assert readiness.status_code == 503
                assert readiness.json()["catalogReady"] is False
                release.set()
                for _ in range(30):
                    readiness = await client.get("/health/ready")
                    if readiness.status_code == 200:
                        break
                    await asyncio.sleep(0.1)
                assert readiness.json()["publicToolCount"] == catalog_size

            async with streamable_http_client(f"{base_url}/mcp") as streams:
                async with ClientSession(streams[0], streams[1]) as session:
                    await session.initialize()
                    tools = (await session.list_tools()).tools
                    assert len(tools) == len({tool.name for tool in tools}) == catalog_size
        finally:
            server_task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await server_task

    asyncio.run(check())
    assert calls == 1


def test_http_catalog_failure_is_truthful_and_unpublished(monkeypatch, capsys):
    import asyncio
    import mcp_host

    async def failed_catalog():
        raise RuntimeError("native_graphiti_catalog_failed")

    monkeypatch.setattr(mcp_host, "_materialize_complete_catalog", failed_catalog)
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_host, "_HTTP_CATALOG_TOOLS", None)

    asyncio.run(mcp_host._initialize_http_catalog_once())

    diagnostics = mcp_host._catalog_diagnostics()
    assert diagnostics["catalogState"] == "failed"
    assert diagnostics["state"] == "failed"
    assert diagnostics["catalogReady"] is False
    assert diagnostics["catalogFailure"] == (
        "RuntimeError: native_graphiti_catalog_failed"
    )
    assert diagnostics["failureCode"] == "native_graphiti_catalog_failed"
    assert diagnostics["failureSummary"] == diagnostics["catalogFailure"]
    assert diagnostics["completedCatalogFamilies"] == []
    assert diagnostics["initializingCatalogFamily"] == "liquidaity"
    assert "publicToolCount" not in diagnostics
    assert "catalogHash" not in diagnostics
    assert mcp_host._HTTP_CATALOG_TOOLS is None
    stderr = capsys.readouterr().err
    assert "full local traceback follows" in stderr
    assert "Traceback (most recent call last)" in stderr
    assert "native_graphiti_catalog_failed" in stderr


def test_stdio_accepts_protocol_before_catalog_provider_initialization(monkeypatch):
    import asyncio
    import mcp_host

    events = []

    async def initialized_engraphis():
        events.append("engraphis_registry")

    async def initialized_graphiti():
        events.append("graphiti_registry")

    async def run_stdio():
        events.append("stdio")

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "stdio")
    monkeypatch.setattr(mcp_host, "_initialize_native_engraphis", initialized_engraphis)
    monkeypatch.setattr(mcp_host, "_initialize_native_graphiti", initialized_graphiti)
    monkeypatch.setattr(mcp_host, "_run_stdio", run_stdio)

    asyncio.run(mcp_host.main())

    assert events == ["stdio"]


def test_native_engraphis_hung_call_does_not_block_later_native_dispatch(monkeypatch):
    import asyncio
    import mcp_host

    outer_thread = threading.get_ident()
    entered = threading.Event()
    release = threading.Event()
    calls = []
    native_result = mcp_host.TextContent(
        type="text",
        text=json.dumps({"ok": True, "source": "native"}),
    )

    class NativeMcp:
        async def call_tool(self, name, arguments):
            calls.append((name, arguments, threading.get_ident()))
            if name == "engraphis_hung":
                entered.set()
                if not release.wait(timeout=2):
                    raise RuntimeError("test_release_timeout")
            return [native_result], {"result": {"ok": True, "source": "native"}}

    async def initialized():
        return None

    monkeypatch.setattr(mcp_host, "_initialize_native_engraphis", initialized)
    monkeypatch.setattr(
        mcp_host,
        "_NATIVE_ENGRAPHIS_NAMES",
        frozenset({"engraphis_hung", "engraphis_stats"}),
    )
    monkeypatch.setattr(mcp_host, "_native_engraphis_mcp", lambda: NativeMcp())

    async def check():
        hung = asyncio.create_task(
            mcp_host.call_tool("engraphis.hung", {"request": 1})
        )
        for _ in range(200):
            if entered.is_set():
                break
            await asyncio.sleep(0.005)
        assert entered.is_set()
        later = await asyncio.wait_for(
            mcp_host.call_tool("engraphis.stats", {"request": 2}),
            timeout=1,
        )
        release.set()
        return later, await asyncio.wait_for(hung, timeout=1)

    later, hung = asyncio.run(check())
    assert later.content[0] is native_result
    assert hung.content[0] is native_result
    assert [call[:2] for call in calls] == [
        ("engraphis_hung", {"request": 1}),
        ("engraphis_stats", {"request": 2}),
    ]
    assert all(call[2] != outer_thread for call in calls)
    assert calls[0][2] != calls[1][2]


def test_native_engraphis_failure_is_typed_and_the_next_call_succeeds(monkeypatch):
    import asyncio
    import mcp_host

    class NativeFailure(RuntimeError):
        pass

    class NativeMcp:
        async def call_tool(self, name, arguments):
            if name == "engraphis_native_failure":
                raise NativeFailure("canonical native failure")
            return [mcp_host.TextContent(type="text", text=json.dumps({
                "name": name,
                "arguments": arguments,
            }))]

    native = NativeMcp()
    monkeypatch.setattr(mcp_host, "_NATIVE_ENGRAPHIS_MCP", native)
    monkeypatch.setattr(mcp_host, "_NATIVE_ENGRAPHIS_TOOLS", ())
    monkeypatch.setattr(
        mcp_host,
        "_NATIVE_ENGRAPHIS_NAMES",
        frozenset({"engraphis_normal_call", "engraphis_native_failure"}),
    )

    async def check():
        typed = await mcp_host.call_tool("engraphis.native_failure", {"value": 1})
        assert typed.isError is True
        typed_payload = json.loads(typed.content[0].text)
        assert typed_payload["error"] == "internal_failure"
        assert typed_payload["failureCode"] == "internal_failure"
        normal = await mcp_host.call_tool("engraphis.normal_call", {"value": 2})
        assert json.loads(normal.content[0].text) == {
            "name": "engraphis_normal_call",
            "arguments": {"value": 2},
        }

    asyncio.run(check())


def test_native_cbm_replaces_a_stale_process_without_retrying_a_tool(monkeypatch):
    import mcp_host

    native_tool = mcp_host.Tool(
        name="list_projects",
        description="Native project list.",
        inputSchema={"type": "object", "properties": {}},
    )

    class StaleClient:
        def __init__(self):
            self.closed = False

        def is_running(self):
            return False

        def close(self):
            self.closed = True

    class FreshClient:
        def __init__(self, command, args, cwd):
            self.command = command
            self.args = args
            self.cwd = cwd
            self.closed = False

        def is_running(self):
            return True

        def list_tools(self):
            return [native_tool]

        def close(self):
            self.closed = True

    stale = StaleClient()
    mcp_host._NATIVE_CBM_CLIENT = stale
    mcp_host._NATIVE_CBM_TOOLS = (native_tool,)
    mcp_host._NATIVE_CBM_NAMES = frozenset({"list_projects"})
    monkeypatch.setattr(
        mcp_host,
        "_native_cbm_config",
        lambda: ("native-cbm", ["--stdio"], r"C:\Projects\main"),
    )
    monkeypatch.setattr(mcp_host, "_NativeStdioMcpClient", FreshClient)

    try:
        mcp_host._initialize_native_cbm_sync()
        assert stale.closed is True
        assert isinstance(mcp_host._NATIVE_CBM_CLIENT, FreshClient)
        assert mcp_host._NATIVE_CBM_NAMES == frozenset({"list_projects"})
    finally:
        mcp_host._close_native_cbm()

    assert mcp_host._NATIVE_CBM_CLIENT is None
    assert mcp_host._NATIVE_CBM_TOOLS is None
    assert mcp_host._NATIVE_CBM_NAMES == frozenset()


def test_http_mcp_targets_compose_owned_codegraph():
    import mcp_host

    command, args, _cwd = mcp_host._native_cbm_config()
    assert command == "docker"
    assert args == [
        "exec",
        "-i",
        "codegraph",
        "/opt/cbm/codebase-memory-mcp",
    ]


def test_native_cbm_index_maps_the_canonical_checkout_into_the_container():
    import mcp_host

    normalized = mcp_host._normalize_native_cbm_index_arguments({
        "repo_path": mcp_host._REPO_ROOT.replace("\\", "/"),
        "name": "workspace-main",
        "mode": "full",
        "persistence": False,
    })

    assert normalized == {
        "repo_path": "/workspace/main",
        "name": "C-Projects-LiquidAIty-main",
        "mode": "full",
        "persistence": False,
    }


def test_native_cbm_index_does_not_redirect_an_unmounted_checkout():
    import mcp_host

    arguments = {
        "repo_path": r"C:\Projects\main",
        "name": "workspace-main",
        "mode": "fast",
    }

    assert mcp_host._normalize_native_cbm_index_arguments(arguments) == arguments


def test_native_cbm_dispatch_uses_the_initialized_stdio_client(monkeypatch):
    import mcp_host
    from mcp.types import CallToolResult, TextContent

    native_tool = mcp_host.Tool(
        name="search_graph",
        description="Native project search.",
        inputSchema={"type": "object", "properties": {}},
    )
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_TOOLS", (native_tool,))
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_NAMES", frozenset({"search_graph"}))
    calls = []

    class NativeClient:
        def call_tool(self, name, arguments):
            calls.append((name, dict(arguments)))
            return CallToolResult(content=[TextContent(type="text", text="ok")])

    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_CLIENT", NativeClient())
    monkeypatch.setattr(mcp_host, "_initialize_native_cbm_sync", lambda: None)
    result = mcp_host._call_native_cbm(
        "search_graph",
        {"project": "C-Projects-LiquidAIty-main", "query": "HermesKanbanWorkspace"},
    )

    assert calls == [
        (
            "search_graph",
            {
                "project": "C-Projects-LiquidAIty-main",
                "query": "HermesKanbanWorkspace",
            },
        )
    ]
    assert result.content[0].text == "ok"


def test_native_cbm_client_failure_is_strict(monkeypatch):
    import mcp_host

    class FailingClient:
        def call_tool(self, _name, _arguments):
            raise RuntimeError("native transport closed")

    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_CLIENT", FailingClient())
    monkeypatch.setattr(mcp_host, "_initialize_native_cbm_sync", lambda: None)
    with pytest.raises(RuntimeError, match="native transport closed"):
        mcp_host._call_native_cbm(
            "search_graph", {"project": "C-Projects-LiquidAIty-main"}
        )


def test_native_cbm_bootstrap_race_retries_within_budget_on_the_same_authority(monkeypatch):
    import mcp_host

    attempts = []
    native_tool = mcp_host.Tool(
        name="search_graph",
        description="Native project search.",
        inputSchema={"type": "object", "properties": {}},
    )

    class NativeClient:
        def __init__(self, command, args, cwd):
            attempts.append((command, list(args), cwd))
            if len(attempts) < 3:
                raise RuntimeError(
                    "native_cbm_process_exited:1:codebase-memory-mcp: "
                    "CBM daemon could not start within 30000 ms"
                )

        def list_tools(self):
            return [native_tool]

        def close(self):
            pass

    monkeypatch.setattr(mcp_host, "_NativeStdioMcpClient", NativeClient)
    monkeypatch.setattr(mcp_host.time, "sleep", lambda _seconds: None)
    client, tools, names = mcp_host._open_native_cbm_client(
        "docker", ["exec", "-i", "codegraph", "/opt/cbm/codebase-memory-mcp"], "repo"
    )

    assert isinstance(client, NativeClient)
    assert tools == (native_tool,)
    assert names == ["search_graph"]
    assert len(attempts) == 3
    assert attempts[0] == attempts[1] == attempts[2]


def test_native_cbm_bootstrap_does_not_retry_other_failures(monkeypatch):
    import mcp_host

    attempts = 0

    class NativeClient:
        def __init__(self, _command, _args, _cwd):
            nonlocal attempts
            attempts += 1
            raise RuntimeError("native_cbm_initialize_invalid")

    monkeypatch.setattr(mcp_host, "_NativeStdioMcpClient", NativeClient)
    with pytest.raises(RuntimeError, match="native_cbm_initialize_invalid"):
        mcp_host._open_native_cbm_client("docker", [], "repo")
    assert attempts == 1


def test_native_cbm_second_bootstrap_race_fails_strictly(monkeypatch):
    import mcp_host

    attempts = 0

    class NativeClient:
        def __init__(self, _command, _args, _cwd):
            nonlocal attempts
            attempts += 1
            raise RuntimeError(
                "native_cbm_process_exited:1:codebase-memory-mcp: "
                "CBM daemon could not start within 30000 ms"
            )

    monkeypatch.setattr(mcp_host, "_NativeStdioMcpClient", NativeClient)
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_REQUEST_TIMEOUT_SECONDS", 60.0)
    monkeypatch.setattr(mcp_host.time, "sleep", lambda _seconds: None)
    with pytest.raises(RuntimeError, match="native_cbm_daemon_start_timeout"):
        mcp_host._open_native_cbm_client("docker", [], "repo")
    assert attempts == 2


def test_authenticated_streamable_http_is_stateless_across_fresh_official_sdk_clients(
    monkeypatch,
):
    import asyncio
    import httpx
    import mcp_host
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from mcp.server.auth.provider import AccessToken

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "external-mcp:grant-1",
        "parentRunId": "external-main:grant-1",
        "mainCardId": "card_main_chat",
    }

    class VerifiedToken:
        async def verify_token(self, token):
            if token != "request-scoped-test-token":
                return None
            return AccessToken(
                token=token,
                client_id="chatgpt-client",
                scopes=["liquidaity.main"],
                expires_at=4102444800,
                subject="auth0|test",
                claims={"main": context},
            )

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "HTTP_MCP_PORT", port)
    monkeypatch.setattr(
        mcp_host,
        "PUBLIC_MCP_RESOURCE_URL",
        "https://example.test/mcp",
    )
    monkeypatch.setattr(mcp_host, "AUTH0_ISSUER_URL", "https://tenant.example/")
    monkeypatch.setattr(mcp_host, "AUTH0_AUDIENCE", "https://example.test/mcp")
    monkeypatch.setattr(mcp_host, "AUTH0_CLIENT_ID", "chatgpt-client")
    monkeypatch.setattr(mcp_host, "AUTH0_REQUIRED_SCOPE", "liquidaity.main")
    monkeypatch.setattr(mcp_host, "OAUTH_ENFORCED", True)
    monkeypatch.setattr(mcp_host, "Auth0TokenVerifier", lambda _config: VerifiedToken())
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_host, "_HTTP_CATALOG_TOOLS", None)
    monkeypatch.setattr(mcp_host, "_HTTP_CATALOG_INITIALIZATION_TASK", None)

    async def check():
        server_task = asyncio.create_task(mcp_host.main())
        try:
            failure = None
            for _ in range(50):
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                        pass
                    break
                except Exception as error:
                    failure = error
                    await asyncio.sleep(0.1)
            else:
                raise failure or RuntimeError("http_mcp_not_ready")

            async with httpx.AsyncClient(timeout=2) as readiness_client:
                for _ in range(450):
                    readiness = await readiness_client.get(
                        f"http://127.0.0.1:{port}/health/ready"
                    )
                    if readiness.status_code == 200:
                        break
                    if readiness.json().get("catalogState") == "failed":
                        raise RuntimeError(readiness.text)
                    await asyncio.sleep(0.1)
                else:
                    raise RuntimeError("http_mcp_catalog_not_ready")

            async def fresh_client():
                response_session_ids = []

                async def observe(response):
                    response_session_ids.append(response.headers.get("mcp-session-id"))

                async with httpx.AsyncClient(
                    headers={"Authorization": "Bearer request-scoped-test-token"},
                    event_hooks={"response": [observe]}
                ) as http_client:
                    async with streamable_http_client(
                        f"http://127.0.0.1:{port}/mcp",
                        http_client=http_client,
                    ) as streams:
                        async with ClientSession(streams[0], streams[1]) as session:
                            await session.initialize()
                            actual = sorted(
                                tool.name for tool in (await session.list_tools()).tools
                            )
                            result = await session.call_tool("main.context", {})
                            visible_context = json.loads(result.content[0].text)["context"]
                assert response_session_ids
                assert all(value is None for value in response_session_ids)
                return actual, visible_context

            first_catalog, first_context = await fresh_client()
            second_catalog, second_context = await fresh_client()
            assert first_catalog == second_catalog
            assert first_catalog
            assert len(first_catalog) == len(set(first_catalog))
            assert "main.context" in first_catalog
            assert "agentgraph.inspect" in first_catalog
            assert "coder.status" not in first_catalog
            assert first_context == second_context == context
        finally:
            server_task.cancel()
            try:
                await server_task
            except asyncio.CancelledError:
                pass

    asyncio.run(check())


def test_auth0_token_verifier_checks_jwt_contract_and_establishes_server_owned_principal(monkeypatch):
    import jwt
    import mcp_host
    from cryptography.hazmat.primitives.asymmetric import rsa

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class StaticJwkClient:
        def get_signing_key_from_jwt(self, _token):
            return type("SigningKey", (), {"key": private_key.public_key()})()

    config = mcp_host.OAuthConfig(
        resource_url="https://exemption-unstable-wolverine.ngrok-free.dev/mcp",
        issuer_url="https://tenant.auth0.com/",
        audience="https://exemption-unstable-wolverine.ngrok-free.dev/mcp",
        client_id="chatgpt-client",
        required_scope="main",
    )
    verifier = mcp_host.Auth0TokenVerifier(config, StaticJwkClient())
    monkeypatch.setattr(
        mcp_host,
        "_resolve_external_main_context_sync",
        lambda issuer, subject: {
            "projectId": "project-1",
            "deckId": "deck_builder",
            "conversationId": "external-mcp:grant-1",
            "parentRunId": "external-main:grant-1",
            "mainCardId": "card_main_chat",
        } if issuer == config.issuer_url and subject == "auth0|jeremiah" else None,
    )
    now = int(time.time())
    base = {
        "iss": config.issuer_url,
        "sub": "auth0|jeremiah",
        "aud": config.audience,
        "iat": now,
        "exp": now + 300,
        "azp": config.client_id,
        "scope": "openid main",
    }

    def encoded(claims, key=private_key):
        return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-key"})

    verified = verifier._verify_sync(encoded(base))
    assert verified is not None
    assert verified.subject == "auth0|jeremiah"
    assert verified.claims["main"]["projectId"] == "project-1"
    assert verified.claims["main"]["mainCardId"] == "card_main_chat"
    invalid_claims = [
        {**base, "iss": "https://wrong.auth0.com/"},
        {**base, "aud": "https://wrong.example/mcp"},
        {**base, "exp": now - 1},
        {**base, "nbf": now + 300},
        {**base, "azp": "wrong-client"},
        {**base, "scope": "openid profile"},
    ]
    assert verifier._verify_sync(encoded(base, other_key)) is None
    assert all(verifier._verify_sync(encoded(claims)) is None for claims in invalid_claims)


def test_authenticated_catalog_is_complete_and_dispatch_uses_server_identity(monkeypatch):
    import asyncio
    import mcp_host
    from app import control_plane
    from mcp.server.auth.provider import AccessToken

    context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "external-mcp:grant-1",
        "parentRunId": "external-main:grant-1",
        "mainCardId": "card_main_chat",
    }
    active_scopes = ["main"]
    monkeypatch.setattr(
        mcp_host,
        "get_access_token",
        lambda: AccessToken(
            token="verified",
            client_id="chatgpt-client",
            scopes=list(active_scopes),
            subject="auth0|jeremiah",
            claims={"main": context},
        ),
    )
    native_cbm_tools = [
        mcp_host.Tool(
            name="search_graph",
            title="Search graph",
            description="Native search description.",
            inputSchema={
                "type": "object",
                "properties": {"project": {"type": "string"}},
                "required": ["project"],
            },
        ),
        mcp_host.Tool(
            name="index_status",
            title="Index status",
            description="Native status description.",
            inputSchema={
                "type": "object",
                "properties": {"project": {"type": "string"}},
                "required": ["project"],
            },
        ),
    ]
    native_engraphis_tools = [
        mcp_host.Tool(
            name="engraphis_recall",
            title="Recall",
            description="Native Engraphis recall.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "required": ["query"],
            },
        ),
        mcp_host.Tool(
            name="engraphis_answer",
            title="Answer",
            description="Native Engraphis grounded answer.",
            inputSchema={
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        ),
    ]
    native_graphiti_tools = [
        mcp_host.Tool(
            name="get_status",
            title="Get status",
            description="Native Graphiti status.",
            inputSchema={"type": "object", "properties": {}},
        ),
        mcp_host.Tool(
            name="search_nodes",
            title="Search nodes",
            description="Native Graphiti node search.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "group_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["query"],
            },
        ),
    ]

    monkeypatch.setattr(
        mcp_host,
        "_NATIVE_CBM_NAMES",
        frozenset(tool.name for tool in native_cbm_tools),
    )

    async def native_cbm_catalog():
        return native_cbm_tools

    monkeypatch.setattr(mcp_host, "_native_cbm_tools", native_cbm_catalog)
    monkeypatch.setattr(
        mcp_host,
        "_NATIVE_ENGRAPHIS_NAMES",
        frozenset(tool.name for tool in native_engraphis_tools),
    )
    monkeypatch.setattr(
        mcp_host,
        "_native_engraphis_tools",
        lambda: asyncio.sleep(0, result=native_engraphis_tools),
    )
    monkeypatch.setattr(
        mcp_host,
        "_NATIVE_GRAPHITI_NAMES",
        frozenset(tool.name for tool in native_graphiti_tools),
    )
    monkeypatch.setattr(
        mcp_host,
        "_native_graphiti_tools",
        lambda: asyncio.sleep(0, result=native_graphiti_tools),
    )
    tools = asyncio.run(mcp_host.list_tools())
    by_name = {tool.name: tool for tool in tools}
    assert len(tools) == len(by_name)
    for tool in tools:
        assert "liquidaitySource" in tool.meta
        assert "runtimeExecution" not in tool.meta
        assert "runtimeCapability" not in tool.meta
        assert "runtimeAccess" not in tool.meta
        assert (
            tool.name in mcp_host._ALLOWED_KEYS
            or tool.name.startswith(tuple(mcp_host._NATIVE_PREFIXES.values()))
        ), f"advertised but undispatchable: {tool.name}"
    assert "main.context" in by_name
    assert "agentgraph.inspect" in by_name
    assert "coder.status" not in by_name
    assert "card.run_assistant_agent" in by_name
    assert "run_coder_subagent" not in by_name
    assert not any(name.startswith("mcp__") for name in by_name)
    assert {
        "coder.inspect",
        "coder.effective_tools",
        "coder.account",
        "coder.stop",
        "coder.steer",
    }.isdisjoint(by_name)
    removed_public_wrappers = {
        "coder.inspect",
        "coder.effective_tools",
        "coder.account",
        "coder.stop",
        "coder.steer",
    }
    assert removed_public_wrappers.isdisjoint(mcp_host._ALLOWED_KEYS)
    assert removed_public_wrappers.isdisjoint(mcp_host._BRIDGE_PATHS)
    native_names = {
        f"engraphis.{tool.name.removeprefix('engraphis_')}"
        for tool in native_engraphis_tools
    } | {
        f"cbm.{tool.name}" for tool in native_cbm_tools
    } | {
        f"graphiti.{tool.name}" for tool in native_graphiti_tools
    }
    assert all(
        tool.inputSchema.get("additionalProperties") is False
        for name, tool in by_name.items()
        if name not in native_names
    )
    assert not any(name.startswith("worldsignals.") for name in by_name)
    assert "engraphis.recall" in by_name
    assert "engraphis.answer" in by_name
    assert "codegraph.status" not in by_name
    assert "codegraph.search" not in by_name
    assert {"cbm.search_graph", "cbm.index_status"}.issubset(by_name)
    assert by_name["cbm.search_graph"].meta["liquidaitySource"] == {
        "sourceId": "cbm",
        "namespace": "cbm",
        "nativeName": "search_graph",
        "connectionKind": "external-mcp",
    }
    assert {"graphiti.get_status", "graphiti.search_nodes"}.issubset(by_name)
    assert "run_mag_one" in by_name
    card_tool = by_name["card.run_assistant_agent"]
    assert set(card_tool.inputSchema["properties"]) == {"cardId", "input"}
    assert set(card_tool.inputSchema["required"]) == {"cardId", "input"}
    assert "saved runtime adapter" in card_tool.description
    assert "instructionId" not in by_name["card.run_assistant_agent"].inputSchema["properties"]
    assert {scheme["scopes"][0] for scheme in by_name["engraphis.recall"].model_dump()["securitySchemes"]} == {"liquidaity.main"}
    assert {scheme["scopes"][0] for scheme in by_name["cbm.search_graph"].model_dump()["securitySchemes"]} == {"liquidaity.main"}
    assert {scheme["scopes"][0] for scheme in by_name["graphiti.get_status"].model_dump()["securitySchemes"]} == {"liquidaity.main"}
    assert by_name["cbm.search_graph"].description == "Native search description."
    assert by_name["cbm.search_graph"].inputSchema == native_cbm_tools[0].inputSchema
    assert by_name["cbm.search_graph"].annotations is None
    assert by_name["graphiti.search_nodes"].annotations is None

    active_scopes[:] = ["main"]
    main_names = {tool.name for tool in asyncio.run(mcp_host.list_tools())}
    assert {
        "main.context", "canvas.inspect",
        "card.run_assistant_agent", "run_mag_one", "cbm.search_graph",
        "graphiti.search_nodes",
    }.issubset(main_names)
    assert {
        "engraphis.answer", "graphiti.get_status",
        "card.update_configuration", "canvas.upsert_wire",
    }.issubset(main_names)
    active_scopes[:] = ["main"]

    calls = []
    class NativeMcp:
        async def list_tools(self):
            return native_engraphis_tools

        async def call_tool(self, name, arguments):
            calls.append((name, arguments))
            return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    async def initialize_engraphis():
        return None

    monkeypatch.setattr(mcp_host, "_initialize_native_engraphis", initialize_engraphis)
    monkeypatch.setattr(mcp_host, "_native_engraphis_mcp", lambda: NativeMcp())

    def call_native_cbm(name, arguments):
        calls.append((name, arguments))
        return mcp_host.CallToolResult(
            content=[
                mcp_host.TextContent(
                    type="text",
                    text=json.dumps({"ok": True, "native": name}),
                )
            ]
        )

    monkeypatch.setattr(mcp_host, "_call_native_cbm", call_native_cbm)

    async def initialize_graphiti():
        return None

    async def call_native_graphiti(name, arguments):
        calls.append((name, arguments))
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(mcp_host, "_initialize_native_graphiti", initialize_graphiti)
    monkeypatch.setattr(mcp_host, "_call_native_graphiti", call_native_graphiti)

    async def bridge(path, payload):
        calls.append((path, payload))
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]
    monkeypatch.setattr(mcp_host, "_bridge", bridge)

    async def run_saved_card(payload):
        calls.append(("card_run_assistant_agent", payload))
        return {"ok": True}
    monkeypatch.setattr(control_plane, "card_run_assistant_agent", run_saved_card)

    asyncio.run(mcp_host.call_tool("engraphis.recall", {"query": "Main", "limit": 3}))
    assert calls[-1] == ("engraphis_recall", {"query": "Main", "limit": 3})

    cbm_result = asyncio.run(
        mcp_host.call_tool("cbm.search_graph", {"project": "C-Projects-main"})
    )
    assert calls[-1] == ("search_graph", {"project": "C-Projects-main"})
    cbm_receipt = json.loads(cbm_result.content[-1].text)["executionReceipt"]
    assert "risk" not in cbm_receipt
    assert "compute" not in cbm_receipt

    asyncio.run(mcp_host.call_tool("graphiti.search_nodes", {"query": "Main"}))
    assert calls[-1] == (
        "search_nodes",
        {"query": "Main", "group_ids": ["liquidaity-project-1"]},
    )

    removed_adapter = asyncio.run(
        mcp_host.call_tool("codegraph.search", {"query": "Main"})
    )
    assert removed_adapter.isError is True
    assert "unknown_tool: codegraph.search" in removed_adapter.content[0].text

    main_context = asyncio.run(mcp_host.call_tool("main.context", {}))
    assert json.loads(main_context[0].text)["context"] == {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "external-mcp:grant-1",
        "parentRunId": "external-main:grant-1",
        "mainCardId": "card_main_chat",
    }

    asyncio.run(mcp_host.call_tool("card.run_assistant_agent", {
        "cardId": "card_agent",
        "input": "Use the assigned context.",
    }))
    path, payload = calls[-1]
    assert path == "card_run_assistant_agent"
    assert payload["originatingAgentId"] == "card_main_chat"
    assert payload["originatingRunId"] == "external-main:grant-1"

    denied = asyncio.run(mcp_host.call_tool("card.run_assistant_agent", {
        "projectId": "spoofed",
        "cardId": "coder-card",
        "input": "Approved exact task.",
    }))
    assert denied.isError is True
    assert "caller_identity_rejected: projectId" in denied.content[0].text

    asyncio.run(mcp_host.call_tool("card.run_assistant_agent", {
        "cardId": "coder-card",
        "input": "Approved exact task.",
    }))
    path, payload = calls[-1]
    assert path == "card_run_assistant_agent"
    assert payload["projectId"] == "project-1"
    assert payload["deckId"] == "deck_builder"
    assert payload["conversationId"] == "external-mcp:grant-1"
    assert payload["originatingAgentId"] == "card_main_chat"
    assert payload["originatingRunId"] == "external-main:grant-1"

def test_authenticated_catalog_uses_one_main_scope_for_the_full_public_registry(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.server.auth.provider import AccessToken

    context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "external-mcp:grant-1",
        "parentRunId": "external-main:grant-1",
        "mainCardId": "card_main_chat",
    }
    active_scopes: list[str] = []

    def access_token():
        if not active_scopes:
            return None
        return AccessToken(
            token="verified",
            client_id="chatgpt-client",
            scopes=list(active_scopes),
            subject="auth0|jeremiah",
            claims={"main": context},
        )

    monkeypatch.setattr(mcp_host, "get_access_token", access_token)
    canonical = asyncio.run(mcp_host.list_tools())
    canonical_names = {tool.name for tool in canonical}
    assert canonical
    assert "run_coder_subagent" not in canonical_names
    assert "card.run_assistant_agent" in canonical_names
    assert not any(name.startswith("mcp__") for name in canonical_names)

    active_scopes[:] = ["main"]
    authenticated = asyncio.run(mcp_host.list_tools())
    assert len(authenticated) == len(canonical)
    assert {tool.name for tool in authenticated} == canonical_names
    main_context = asyncio.run(mcp_host.call_tool("main.context", {}))
    main_payload = json.loads(main_context[0].text)
    assert main_payload["ok"] is True
    expected_count, expected_hash = mcp_host._catalog_identity(authenticated)
    assert main_payload["diagnostics"] == {
        "state": "ready",
        "catalogState": "ready",
        "catalogReady": True,
        "completedCatalogFamilies": [
            "liquidaity",
            "engraphis",
            "cbm",
            "graphiti",
        ],
        "initializingCatalogFamily": None,
        "publicToolCount": expected_count,
        "publicToolUniqueCount": len({tool.name for tool in authenticated}),
        "catalogHash": expected_hash,
        "processId": mcp_host._STARTUP_PROCESS_ID,
        "startupId": mcp_host._STARTUP_ID,
        "sourceRevision": mcp_host._STARTUP_SOURCE_REVISION,
        "sourceSha256": mcp_host._STARTUP_SOURCE_SHA256,
    }


def test_tunnel_waits_for_complete_catalog_without_default_timeout():
    script = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))),
        "scripts",
        "start-mcp-tunnel.ps1",
    )
    source = open(script, encoding="utf-8").read()
    assert "[int]$TimeoutSeconds = 0" in source
    assert '$readinessUrl = "$localBaseUrl/health/ready"' in source
    assert "$catalogCount -eq 69" in source
    assert "$catalogReady" in source
    loop_start = source.index("    while ($null -eq $deadline")
    loop_end = source.index("\n    if (-not $catalogReady)", loop_start)
    readiness_loop = source[loop_start:loop_end]
    assert "$http.GetAsync($readinessUrl)" in readiness_loop
    assert "$metadataUrl" not in readiness_loop
    assert "$mcpUrl" not in readiness_loop
    assert source.count("$http.GetAsync($metadataUrl)") == 1
    assert source.count("$http.SendAsync($request)") == 1
    assert 'if ($lastState -ne $lastLoggedState)' in readiness_loop
    assert "$maximumPollMilliseconds" in readiness_loop


def test_oauth_catalog_declares_security_before_main_context_resolution(monkeypatch):
    import asyncio
    import mcp_host

    async def empty_catalog():
        return []

    monkeypatch.setattr(mcp_host, "OAUTH_ENFORCED", True)
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(mcp_host, "_native_engraphis_tools", empty_catalog)
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", empty_catalog)
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", empty_catalog)

    tools = asyncio.run(mcp_host.list_tools())
    assert tools
    assert all(
        tool.model_dump(exclude_none=True)["securitySchemes"]
        == [{"type": "oauth2", "scopes": [mcp_host.AUTH0_REQUIRED_SCOPE]}]
        for tool in tools
    )
    assert all(
        tool.model_dump(by_alias=True, exclude_none=True)["_meta"]["securitySchemes"]
        == [{"type": "oauth2", "scopes": [mcp_host.AUTH0_REQUIRED_SCOPE]}]
        for tool in tools
    )

def test_identical_native_cbm_index_requests_share_one_in_flight_call(monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from mcp.types import CallToolResult, TextContent
    import mcp_host

    entered = threading.Event()
    release = threading.Event()

    calls = []

    class IndexClient:
        def call_tool(self, name, arguments):
            assert name == "index_repository"
            calls.append(dict(arguments))
            entered.set()
            assert release.wait(timeout=2)
            return CallToolResult(content=[TextContent(type="text", text="indexed")])

    monkeypatch.setattr(mcp_host, "_initialize_native_cbm_sync", lambda: None)
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_CLIENT", IndexClient())
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_INDEX_IN_FLIGHT", None)
    arguments = {"repo_path": "C:/Projects/main", "mode": "fast"}

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(mcp_host._call_native_cbm, "index_repository", arguments)
        assert entered.wait(timeout=2)
        second = pool.submit(mcp_host._call_native_cbm, "index_repository", dict(arguments))
        release.set()
        assert first.result(timeout=2).content[0].text == "indexed"
        assert second.result(timeout=2).content[0].text == "indexed"

    assert calls == [arguments]


def test_graphiti_episode_projection_is_bounded_and_full_body_is_explicit():
    import json
    from mcp.types import CallToolResult, TextContent
    import mcp_host

    native_payload = {
        "message": "Episodes retrieved successfully",
        "episodes": [{
            "uuid": "episode-1",
            "name": "Large source",
            "content": "x" * 24000,
            "created_at": "2026-08-02T00:00:00Z",
            "source": "text",
            "source_description": "A source",
            "group_id": "project-1",
        }],
    }
    native = CallToolResult(
        content=[TextContent(type="text", text=json.dumps(native_payload))],
        structuredContent={"result": native_payload},
    )

    compact = mcp_host._bounded_graphiti_episodes(
        native, include_body=False, preview_chars=120, response_budget=2000,
    )
    compact_episode = compact.structuredContent["result"]["episodes"][0]
    assert "content" not in compact_episode
    assert compact_episode["content_preview"] == "x" * 120
    assert compact_episode["content_truncated"] is True
    assert len(compact.content[0].text) <= 2000

    explicit = mcp_host._bounded_graphiti_episodes(
        native, include_body=True, preview_chars=120, response_budget=3000,
    )
    explicit_episode = explicit.structuredContent["result"]["episodes"][0]
    assert "content" in explicit_episode
    assert explicit_episode["content_truncated"] is True
    assert explicit.structuredContent["result"]["truncated"] is True
    assert len(explicit.content[0].text) <= 3000


def test_oauth_principal_context_is_reloaded_for_each_verified_request(monkeypatch):
    import mcp_host

    calls: list[tuple[str, str]] = []
    config = mcp_host.OAuthConfig(
        resource_url="https://example.test/mcp",
        issuer_url="https://tenant.example/",
        audience="https://example.test/mcp",
        client_id="client",
        required_scope="main",
    )
    verifier = mcp_host.Auth0TokenVerifier(
        config,
        type("JwkClient", (), {})(),
    )
    monkeypatch.setattr(
        mcp_host,
        "_resolve_external_main_context_sync",
        lambda issuer, subject: (
            calls.append((issuer, subject))
            or {
                "projectId": "project-1",
                "deckId": "deck_builder",
                "conversationId": "external-mcp:grant-1",
                "parentRunId": "external-main:grant-1",
                "mainCardId": "card_main_chat",
            }
        ),
    )

    first = verifier._principal_context("auth0|jeremiah")
    second = verifier._principal_context("auth0|jeremiah")

    assert first == second
    assert calls == [
        ("https://tenant.example/", "auth0|jeremiah"),
        ("https://tenant.example/", "auth0|jeremiah"),
    ]


def test_one_handler_exception_returns_a_tool_error_and_later_calls_still_work(monkeypatch):
    import asyncio
    import mcp_host
    from app import control_plane

    async def initialized():
        mcp_host._NATIVE_ENGRAPHIS_NAMES = frozenset()

    attempts = 0

    async def inspect(_args):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("database_connection_lost")
        return {"ok": True, "cards": []}

    monkeypatch.setattr(mcp_host, "_initialize_native_engraphis", initialized)
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(control_plane, "canvas_inspect", inspect)

    failed = asyncio.run(mcp_host.call_tool("canvas.inspect", {}))
    succeeded = asyncio.run(mcp_host.call_tool("canvas.inspect", {}))

    assert failed.isError is True
    failed_payload = json.loads(failed.content[0].text)
    assert failed_payload["error"] == "database_failure"
    assert failed_payload["failureCode"] == "database_failure"
    assert succeeded[0].type == "text"
    assert json.loads(succeeded[0].text) == {"ok": True, "cards": []}


def test_oauth_http_publishes_metadata_and_rejects_anonymous_mcp(monkeypatch):
    import asyncio
    import engraphis.backends.embedder_st as embedder_st
    import engraphis.mcp_server as engraphis_mcp
    import httpx
    import mcp_host

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    resource = "https://exemption-unstable-wolverine.ngrok-free.dev/mcp"

    async def empty_catalog():
        return []

    async def initialized():
        return None

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "HTTP_MCP_PORT", port)
    monkeypatch.setattr(mcp_host, "PUBLIC_MCP_RESOURCE_URL", resource)
    monkeypatch.setattr(mcp_host, "AUTH0_ISSUER_URL", "https://tenant.auth0.com/")
    monkeypatch.setattr(mcp_host, "AUTH0_AUDIENCE", resource)
    monkeypatch.setattr(mcp_host, "AUTH0_CLIENT_ID", "chatgpt-client")
    monkeypatch.setattr(mcp_host, "AUTH0_REQUIRED_SCOPE", "liquidaity.main")
    monkeypatch.setattr(mcp_host, "OAUTH_ENFORCED", True)
    monkeypatch.setattr(mcp_host, "_initialize_native_engraphis", initialized)
    monkeypatch.setattr(mcp_host, "_initialize_native_graphiti", initialized)
    monkeypatch.setattr(mcp_host, "_native_engraphis_tools", empty_catalog)
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", empty_catalog)
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", empty_catalog)
    monkeypatch.setattr(
        engraphis_mcp.MemoryService,
        "create",
        lambda *args, **kwargs: pytest.fail("OAuth readiness constructed MemoryService"),
    )
    monkeypatch.setattr(
        embedder_st,
        "_construct_local_sentence_transformer",
        lambda *args, **kwargs: pytest.fail("OAuth readiness constructed embedder"),
    )

    async def check():
        server_task = asyncio.create_task(mcp_host.main())
        try:
            base_url = f"http://127.0.0.1:{port}"
            failure = None
            async with httpx.AsyncClient(base_url=base_url, timeout=2) as client:
                for _ in range(30):
                    try:
                        response = await client.get(
                            "/.well-known/oauth-protected-resource/mcp"
                        )
                        if response.status_code == 200:
                            break
                    except Exception as error:
                        failure = error
                    await asyncio.sleep(0.1)
                else:
                    raise failure or RuntimeError("oauth_metadata_not_ready")

                metadata = response.json()
                assert metadata["resource"] == resource
                assert metadata["authorization_servers"] == [
                    "https://tenant.auth0.com/"
                ]
                assert metadata["scopes_supported"] == [
                    "openid",
                    "profile",
                    "email",
                    "offline_access",
                    "liquidaity.main",
                ]
                assert metadata["resource_name"] == "LiquidAIty"

                root_metadata = await client.get(
                    "/.well-known/oauth-protected-resource"
                )
                assert root_metadata.json() == metadata

                anonymous = await client.post("/mcp", json={})
                assert anonymous.status_code == 401
                challenge = anonymous.headers["www-authenticate"]
                assert 'scope="liquidaity.main"' in challenge
                assert (
                    f'resource_metadata="{resource.replace("/mcp", "/.well-known/oauth-protected-resource/mcp")}"'
                    in challenge
                )
        finally:
            server_task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await server_task

    asyncio.run(check())
