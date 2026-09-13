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
        "ThinkGraph, KnowGraph, and supported agent runtimes. "
        "Start with main.context to resolve the authenticated Main conversation and project scope. "
        "Use the currently published tool names and schemas; preserve returned native IDs and provenance. "
        "Saved Cards own their configuration and granted capabilities. "
        "An accepted operation is not proof of completion; use its returned status and evidence."
    )


def test_canonical_catalog_publishes_native_engraphis_schemas_with_owned_scope(monkeypatch):
    import asyncio
    import jsonschema
    import mcp_host
    from app.python_models.engraphis import READ_TOOLS, WRITE_TOOLS

    names = READ_TOOLS | WRITE_TOOLS
    monkeypatch.setattr(mcp_host, "OAUTH_ENFORCED", True)
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", lambda: asyncio.sleep(0, result=[]))
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", lambda: asyncio.sleep(0, result=[]))
    catalog = asyncio.run(mcp_host._materialize_complete_catalog())
    tools = [tool for tool in catalog if tool.name.startswith("engraphis_")]
    assert {tool.name for tool in tools} == names
    assert "main.context" in {tool.name for tool in catalog}
    assert "card.run_assistant_agent" in {tool.name for tool in catalog}
    assert len(tools) == len(names)
    assert not any(tool.name.startswith("constellation.") for tool in catalog)
    for tool in tools:
        schema = tool.inputSchema
        jsonschema.Draft202012Validator.check_schema(schema)
        assert schema["additionalProperties"] is False
        assert not ({"projectId", "workspace"} & schema["properties"].keys())
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        assert payload["securitySchemes"] == [{
            "type": "oauth2", "scopes": [mcp_host.AUTH0_REQUIRED_SCOPE],
        }]
        assert payload["_meta"]["securitySchemes"] == payload["securitySchemes"]
    schemas = {tool.name: tool.inputSchema for tool in tools}
    jsonschema.validate({"query": "spacecraft component suppliers", "k": 6,
                         "token_budget": 600}, schemas["engraphis_recall_context"])
    jsonschema.validate({"memory_id": "native-id"}, schemas["engraphis_get_memory"])
    jsonschema.validate({"content": "A tentative assistant suggestion",
                         "title": "Paper journal"},
                        schemas["engraphis_remember"])
    jsonschema.validate({"memory_id": "native-id", "title": "Updated title"},
                        schemas["engraphis_update_memory"])


@pytest.mark.parametrize("operation", ["engraphis_remember", "engraphis_ingest"])
def test_semantic_write_can_finish_after_the_ordinary_tool_deadline(monkeypatch, operation):
    import asyncio
    import mcp_host

    completed = []

    async def dispatch(name, arguments):
        await asyncio.sleep(0.03)
        completed.append(name)
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True, "id": "native-question"}))]

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)
    monkeypatch.setattr(mcp_host, "_request_tool_is_allowed", lambda name: True)
    monkeypatch.setattr(mcp_host, "_request_execution_context", lambda: None)
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(mcp_host, "_MCP_CALL_TIMEOUT_SECONDS", 0.005)

    result = asyncio.run(mcp_host.call_tool(operation, {}))
    assert not getattr(result, "isError", False)
    assert completed == [operation]
    # Ordinary reads keep their short deadline; this is not a global increase.
    result = asyncio.run(mcp_host.call_tool("engraphis_recall_context", {}))
    assert result.isError
    assert completed == [operation]


def test_engraphis_rejection_reaches_agent_without_success_or_retry(monkeypatch):
    import asyncio
    import io
    from urllib.error import HTTPError
    import mcp_host

    requests = []
    context = {"projectId": "project-one", "mainCardId": "thinkgraph"}

    def reject(request, **kwargs):
        requests.append(json.loads(request.data))
        raise HTTPError(request.full_url, 409, "Conflict", {}, io.BytesIO(
            b'{"detail":"thinkgraph_project_id_invalid"}'))

    monkeypatch.setattr(mcp_host, "urlopen", reject)
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: context)
    monkeypatch.setattr(mcp_host, "_request_execution_context", lambda: context)
    monkeypatch.setattr(mcp_host, "_request_tool_is_allowed", lambda name: True)
    monkeypatch.setattr(mcp_host, "_enforce_tool_caller", lambda *args, **kwargs: None)
    monkeypatch.setattr(mcp_host, "_internal_mcp_principal", lambda: None)
    monkeypatch.setitem(mcp_host._ALLOWED_KEYS, "engraphis_remember", {"content"})
    result = asyncio.run(mcp_host.call_tool("engraphis_remember", {
        "content": "A retained thought",
    }))
    assert result.isError is True
    assert json.loads(result.content[0].text) == {
        "ok": False, "error": "thinkgraph_project_id_invalid",
    }
    receipt = json.loads(result.content[-1].text)["executionReceipt"]
    assert receipt["state"] == "failed"
    assert receipt["failureCode"] == "thinkgraph_project_id_invalid"
    assert len(requests) == 1
    assert requests[0]["projectId"] == "project-one"


def test_engraphis_native_output_contract_preserved(monkeypatch):
    import asyncio
    import jsonschema
    import mcp_host
    from app.python_models.engraphis import native_tools
    schemas = {t["name"]: t.get("outputSchema") for t in asyncio.run(native_tools())}
    payload = {"a": "one", "b": "two", "linked": True}
    monkeypatch.setattr(mcp_host, "_authenticated_main_context",
        lambda: {"projectId": "project-one", "mainCardId": "thinkgraph"})
    monkeypatch.setattr(mcp_host, "_enforce_tool_caller", lambda *a, **k: None)
    monkeypatch.setattr(mcp_host, "_thinkgraph_via_python_rails_sync", lambda *a: payload)
    monkeypatch.setitem(mcp_host._ALLOWED_KEYS, "engraphis_link", {"a", "b"})
    result = asyncio.run(mcp_host._dispatch_tool("engraphis_link", {"a": "one", "b": "two"}))
    jsonschema.validate(result.structuredContent, schemas["engraphis_link"])
    assert json.loads(result.structuredContent["result"]) == payload
    assert result.isError is False


def test_card_team_schema_exposes_only_proven_saved_fields():
    import mcp_host

    schema = mcp_host._card_team_schema()
    assert set(schema["properties"]) == {
        "mode", "maxWorkers", "retryLimit", "workerModel", "leadModel",
    }
    assert schema["properties"]["mode"]["enum"] == ["off", "auto"]
    assert schema["properties"]["maxWorkers"]["enum"] == [2, 3, 4]
    assert "concurrency" not in schema["properties"]


def test_canvas_wire_catalog_preserves_supported_fields_without_native_discovery(monkeypatch):
    import asyncio
    import jsonschema
    import mcp_host

    monkeypatch.setattr(mcp_host, '_configured_tool_allowlist', lambda: {'canvas.upsert_wire'})
    monkeypatch.setattr(mcp_host, '_authenticated_main_context', lambda: None)
    monkeypatch.setattr(mcp_host, 'OAUTH_ENFORCED', False)
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", lambda: asyncio.sleep(0, result=[]))
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", lambda: asyncio.sleep(0, result=[]))
    tools = asyncio.run(mcp_host._materialize_complete_catalog())
    schema = next(tool.inputSchema for tool in tools if tool.name == 'canvas.upsert_wire')
    assert 'main.context' in {tool.name for tool in tools}
    for edge_type in ('flow', 'magentic_option', 'magentic_control'):
        jsonschema.validate({'projectId': 'p', 'deckId': 'd', 'op': 'upsert', 'wire': {
            'id': 'wire', 'source': 'a', 'target': 'b', 'edgeType': edge_type,
            'sourceHandle': None, 'targetHandle': 'port', 'enabled': False,
            'label': 'Existing presentation',
        }}, schema)
    assert schema['properties']['wire']['properties']['edgeType']['enum'] == [
        'flow', 'magentic_option', 'magentic_control',
    ]


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
        "_callerRuntimeMode": "delegate",
    }
    assert mcp_host._enforce_tool_caller("run_mag_one", denied) == (
        "tool_caller_not_authorized: run_mag_one requires hermes/main"
    )
    unrestricted: dict[str, str] = {}
    assert mcp_host._enforce_tool_caller("cbm.search_graph", unrestricted) is None


def test_worldsignals_package_dispatch_uses_authenticated_card_run_scope(monkeypatch):
    import asyncio
    import mcp_host
    from app.python_models import worldsignals_client

    captured = {}

    class _Package:
        def model_dump_json(self):
            return json.dumps({
                "schemaVersion": "signal.package.v1",
                "packageId": "signal-package:test",
                "candidates": [],
            })

    def collect(**kwargs):
        captured.update(kwargs)
        return _Package()

    monkeypatch.setattr(worldsignals_client, "collect_worldsignals_signal_package", collect)
    context_token = mcp_host._ACTIVE_AUTHENTICATED_CONTEXT.set({
        "projectId": "project-1",
        "deckId": "deck-1",
        "conversationId": "conversation-1",
        "parentRunId": "run-1",
        "mainCardId": "card-signal-analyst",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "delegate",
        "principalKind": "card-runtime",
        "grantedTools": ["worldsignals.package"],
    })
    try:
        result = asyncio.run(mcp_host._dispatch_tool("worldsignals.package", {
            "command": "get_summary",
            "reason": "Inspect one bounded source result.",
            "limit": 4,
        }))
    finally:
        mcp_host._ACTIVE_AUTHENTICATED_CONTEXT.reset(context_token)

    payload = json.loads(result[0].text)
    assert payload["packageId"] == "signal-package:test"
    assert captured["project_id"] == "project-1"
    assert captured["deck_id"] == "deck-1"
    assert captured["requesting_card_id"] == "card-signal-analyst"
    assert captured["requesting_run_id"] == "run-1"
    assert captured["producer_card_id"] == "card-signal-analyst"
    assert captured["producer_run_id"] == "run-1"


def test_worldsignals_package_rejects_model_supplied_scope():
    import asyncio
    import mcp_host

    context_token = mcp_host._ACTIVE_AUTHENTICATED_CONTEXT.set({
        "projectId": "project-1",
        "deckId": "deck-1",
        "conversationId": "conversation-1",
        "parentRunId": "run-1",
        "mainCardId": "card-worldview",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "delegate",
        "principalKind": "card-runtime",
        "grantedTools": ["worldsignals.package"],
    })
    try:
        result = asyncio.run(mcp_host._dispatch_tool("worldsignals.package", {
            "command": "get_summary",
            "reason": "Inspect one bounded source result.",
            "projectId": "other-project",
        }))
    finally:
        mcp_host._ACTIVE_AUTHENTICATED_CONTEXT.reset(context_token)

    assert json.loads(result[0].text)["error"] == "caller_identity_rejected: projectId"


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
    provider_initialization = []
    monkeypatch.setattr(
        mcp_host,
        "_graphiti_config",
        lambda: provider_initialization.append("called"),
    )

    assert asyncio.run(mcp_host._native_graphiti_tools()) == []
    assert provider_initialization == []
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


def test_graphiti_catalog_discovery_does_not_open_provider_connections(monkeypatch):
    import asyncio
    import graphiti_mcp_server as native
    import mcp_host

    monkeypatch.setenv("OPENROUTER_API_KEY", "configured")
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_MODULE", None)
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_TOOLS", None)
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_NAMES", frozenset())
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_UNAVAILABLE", None)
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_SERVICE_READY", False)
    monkeypatch.setattr(
        native,
        "GraphitiService",
        lambda *_args, **_kwargs: pytest.fail("catalog opened Graphiti providers"),
    )

    tools = asyncio.run(mcp_host._native_graphiti_tools())

    assert tools
    assert mcp_host._NATIVE_GRAPHITI_NAMES
    assert mcp_host._NATIVE_GRAPHITI_SERVICE_READY is False


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
        "nativeChildId": "native-task-one",
        "nativeRunId": "native-attempt-one",
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
        "nativeChildId": "native-task-one",
        "nativeRunId": "native-attempt-one",
    }
    assert mcp_host._request_tool_is_allowed("canvas.inspect") is True
    assert mcp_host._request_tool_is_allowed("run_mag_one") is False
    from app.python_models.native_attention import build_native_attention_event
    event = build_native_attention_event("cbm.search_graph", {
        "results": [{"qualified_name": "pkg.actual"}],
    }, mcp_host._authenticated_main_context())
    assert event["runId"] == "run-1"
    assert event["cardId"] == "card-main"
    assert event["nativeChildId"] == "native-task-one"
    assert event["nativeRunId"] == "native-attempt-one"


def test_terminal_run_token_requires_complete_owner_identity_and_active_context(monkeypatch):
    import jwt
    import mcp_host
    secret = "0123456789abcdef0123456789abcdef"
    monkeypatch.setattr(mcp_host, "INTERNAL_MCP_SECRET", secret)
    verifier = mcp_host.Auth0TokenVerifier(mcp_host.OAuthConfig(
        resource_url="https://example.ngrok.dev/mcp", issuer_url="https://auth.example/",
        audience="https://example.ngrok.dev/mcp", client_id="chatgpt-client",
        required_scope="liquidaity.main"), jwk_client=SimpleNamespace())
    principal = {"kind": "card-runtime", "projectId": "project-1", "deckId": "deck-1",
        "conversationId": "", "parentRunId": "persisted-run", "callerCardId": "signal",
        "callerRuntimeKind": "hermes", "callerRuntimeMode": "delegate",
        "grantedTools": ["worldsignals.package"], "presentedTools": ["worldsignals.package"],
        "requiresExecutionContext": True, "executionContextId": "context-1",
        "terminalOwner": {"userId": "owner", "terminalSessionId": "terminal-1",
                          "profile": "signal", "cardRevisionId": "revision-1"}}
    def verify(value):
        now = int(time.time())
        return verifier._verify_sync(jwt.encode({"iss": "liquidaity-runtime", "aud": "liquidaity-internal-mcp",
            "sub": "card-runtime:signal", "iat": now, "exp": now + 60, "principal": value}, secret, algorithm="HS256"))
    token = verify(principal)
    assert token is not None
    for invalid in ({"terminalOwner": None}, {"requiresExecutionContext": False},
                    {"callerCardId": "builder"}, {"callerRuntimeKind": "autogen"},
                    *({"terminalOwner": {**principal["terminalOwner"], key: ""}}
                      for key in principal["terminalOwner"])):
        assert verify({**principal, **invalid}) is None
    monkeypatch.setattr(mcp_host, "get_access_token", lambda: token)
    observed = []
    def bridge(name, args):
        observed.append((name, args))
        return json.dumps({"ok": True, "context": {"projectId": "project-1", "deckId": "deck-1",
            "conversationId": "", "runId": "persisted-run", "rootRunId": "persisted-run",
            "cardId": "signal", "runtimeMode": "delegate", "grantedTools": ["worldsignals.package"]}})
    monkeypatch.setattr(mcp_host, "_bridge_sync", bridge)
    resolved = mcp_host._request_execution_context()
    assert resolved["parentRunId"] == "persisted-run"
    assert resolved["conversationId"] == ""
    assert observed[0][1]["principal"]["terminalOwner"] == principal["terminalOwner"]
    assert mcp_host._request_tool_is_allowed("card.create") is False


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
        "grantedTools": ["canvas.inspect", "card.run_assistant_agent"],
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
    monkeypatch.setattr(mcp_host, "INTERNAL_MCP_SECRET", secret)
    verifier = mcp_host.Auth0TokenVerifier(
        mcp_host.OAuthConfig(
            resource_url="https://example.ngrok.dev/mcp", issuer_url="https://auth.example/",
            audience="https://example.ngrok.dev/mcp", client_id="chatgpt-client",
            required_scope="liquidaity.main",
        ), jwk_client=SimpleNamespace(),
    )
    assert verifier._verify_sync(token) is None


def test_agent_terminal_verifier_rejects_main_builder_and_incomplete_terminal_identity(monkeypatch):
    import jwt
    import mcp_host

    secret = "0123456789abcdef0123456789abcdef"
    now = int(time.time())
    base = {
        "kind": "agent-terminal", "projectId": "project-1", "deckId": "deck_builder",
        "callerCardId": "card_hermes_steward", "terminalSessionId": "terminal-session-1",
        "profile": "liquidaity-hermes-steward", "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "delegate", "grantedTools": ["canvas.inspect"],
        "presentedTools": ["canvas.inspect"],
    }
    monkeypatch.setattr(mcp_host, "INTERNAL_MCP_SECRET", secret)
    verifier = mcp_host.Auth0TokenVerifier(
        mcp_host.OAuthConfig(
            resource_url="https://example.ngrok.dev/mcp", issuer_url="https://auth.example/",
            audience="https://example.ngrok.dev/mcp", client_id="chatgpt-client",
            required_scope="liquidaity.main",
        ), jwk_client=SimpleNamespace(),
    )
    for override in ({"callerCardId": "card_main_chat"}, {"callerCardId": "builder"},
                     {"terminalSessionId": ""}, {"profile": "default"},
                     {"profile": "main"},
                     {"conversationId": "forged-conversation"},
                     {"parentRunId": "forged-run"},
                     {"requiresExecutionContext": True},
                     {"callerRuntimeKind": "autogen"}):
        token = jwt.encode({
            "iss": "liquidaity-runtime", "aud": "liquidaity-internal-mcp",
            "sub": "agent-terminal:invalid", "iat": now, "exp": now + 60,
            "principal": {**base, **override},
        }, secret, algorithm="HS256")
        assert verifier._verify_sync(token) is None


def test_runless_terminal_cannot_dispatch_even_a_read_tool(monkeypatch):
    import asyncio
    import mcp_host

    monkeypatch.setattr(mcp_host, "_internal_mcp_principal", lambda: {"kind": "agent-terminal"})
    monkeypatch.setattr(mcp_host, "_dispatch_tool", lambda *_: (_ for _ in ()).throw(
        AssertionError("unsupported principal must not dispatch")
    ))
    result = asyncio.run(mcp_host.call_tool("cbm.search_graph", {}))
    assert result.isError is True


def test_materializer_principal_can_only_use_idd_reads(monkeypatch):
    import asyncio
    import jwt
    import mcp_host

    secret = "0123456789abcdef0123456789abcdef"
    now = int(time.time())
    principal = {
        "kind": "materializer-read",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "callerCardId": "card-helper",
    }
    token = jwt.encode({
        "iss": "liquidaity-runtime",
        "aud": "liquidaity-internal-mcp",
        "sub": "materializer-read:card-helper",
        "iat": now,
        "exp": now + 60,
        "principal": principal,
    }, secret, algorithm="HS256")
    monkeypatch.setattr(mcp_host, "INTERNAL_MCP_SECRET", secret)
    verifier = mcp_host.Auth0TokenVerifier(
        mcp_host.OAuthConfig(
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
    monkeypatch.setattr(mcp_host, "get_access_token", lambda: verified)
    assert mcp_host._authenticated_main_context() is None
    assert mcp_host._request_tool_is_allowed("cbm.get_code_snippet") is True
    assert mcp_host._request_tool_is_allowed("cbm.index_repository") is False
    assert mcp_host._request_tool_is_allowed("run_mag_one") is False

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_host, "_CATALOG_TOOLS", (
        mcp_host.Tool(name="cbm.get_code_snippet", description="read", inputSchema={"type": "object"}),
        mcp_host.Tool(name="cbm.index_repository", description="write", inputSchema={"type": "object"}),
    ))
    assert [tool.name for tool in asyncio.run(mcp_host.list_tools())] == [
        "cbm.get_code_snippet", "cbm.index_repository",
    ]


def test_materializer_native_reads_keep_project_scope_without_a_fake_run(monkeypatch):
    import asyncio
    import mcp_host
    calls = []
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(mcp_host, "_internal_mcp_principal", lambda: {
        "kind": "materializer-read", "projectId": "project-1", "deckId": "d",
        "callerCardId": "main", "conversationId": "conversation-1",
    })
    async def initialize():
        return None
    async def graphiti_tools():
        return [mcp_host.Tool(name="search_memory_facts", description="facts", inputSchema={
            "properties": {"query": {}, "group_ids": {}}})]
    async def graphiti(name, args):
        calls.append((name, args))
        return []
    monkeypatch.setattr(mcp_host, "_initialize_native_graphiti", initialize)
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", graphiti_tools)
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_NAMES", {"search_memory_facts"})
    monkeypatch.setattr(mcp_host, "_call_native_graphiti", graphiti)
    asyncio.run(mcp_host._dispatch_tool("graphiti.search_memory_facts", {"query": "sources"}))
    assert calls == [("search_memory_facts", {"query": "sources", "group_ids": ["liquidaity-project-1"]})]
    monkeypatch.setattr(mcp_host, "_thinkgraph_via_python_rails_sync", lambda *args: calls.append(args) or {"nodes": []})
    asyncio.run(mcp_host._dispatch_tool("engraphis_recall_context", {"query": "sources"}))
    assert calls[-1] == ("engraphis_recall_context", "project-1", {"query": "sources"})
    rejected = asyncio.run(mcp_host._dispatch_tool("engraphis_recall_context", {"query": "sources", "projectId": "foreign"}))
    assert "caller_identity_rejected" in rejected[0].text


def test_mcp2_per_call_meta_resolves_child_run_and_card_without_model_identity(monkeypatch):
    import mcp_host

    principal = {
        "kind": "card-runtime",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "main-run",
        "callerCardId": "card_helper",
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
                "cardId": "card_helper",
                "runtimeMode": "delegate",
                "nativeChildId": "sa-helper",
                "grantedTools": ["cbm.search_graph"],
            },
        })

    monkeypatch.setattr(mcp_host, "_bridge_sync", bridge)
    context = mcp_host._request_execution_context()
    assert context["parentRunId"] == "child-run"
    assert context["mainCardId"] == "card_helper"
    assert context["nativeChildId"] == "sa-helper"
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


def test_signed_execution_context_id_supports_native_team_worker(monkeypatch):
    import mcp_host

    principal = {
        "kind": "card-runtime",
        "requiresExecutionContext": True,
        "executionContextId": "context-team-root",
    }
    monkeypatch.setattr(mcp_host, "_internal_mcp_principal", lambda: principal)
    monkeypatch.setattr(
        type(mcp_host.server),
        "request_context",
        property(lambda _self: SimpleNamespace(meta={})),
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
                "runId": "saved-card-run",
                "rootRunId": "saved-card-run",
                "cardId": "card_hermes_steward",
                "runtimeMode": "delegate",
                "nativeChildId": None,
                "grantedTools": ["graphiti.add_memory"],
            },
        })

    monkeypatch.setattr(mcp_host, "_bridge_sync", bridge)
    context = mcp_host._request_execution_context()
    assert context["parentRunId"] == "saved-card-run"
    assert context["rootRunId"] == "saved-card-run"
    assert context["nativeChildId"] == ""
    assert bridge_calls == [(
        "internal_execution_context",
        {"contextId": "context-team-root", "principal": principal},
    )]


def test_signed_and_per_call_execution_context_ids_must_match(monkeypatch):
    import mcp_host

    monkeypatch.setattr(mcp_host, "_internal_mcp_principal", lambda: {
        "kind": "card-runtime",
        "requiresExecutionContext": True,
        "executionContextId": "signed-context",
    })
    monkeypatch.setattr(
        type(mcp_host.server),
        "request_context",
        property(lambda _self: SimpleNamespace(meta={"liquidaity/execution": "other-context"})),
    )
    with pytest.raises(PermissionError, match="mcp_execution_context_invalid"):
        mcp_host._request_execution_context()


def test_canonical_catalog_is_identical_for_every_mcp_principal(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.server.auth.provider import AccessToken

    tools = (
        mcp_host.Tool(name="canvas.inspect", description="x", inputSchema={"type": "object"}),
        mcp_host.Tool(name="run_mag_one", description="y", inputSchema={"type": "object"}),
    )
    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_host, "_CATALOG_TOOLS", tools)
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
    monkeypatch.setattr(mcp_host, "get_access_token", lambda: current["token"])
    assert [tool.name for tool in asyncio.run(mcp_host.list_tools())] == ["canvas.inspect", "run_mag_one"]
    current["token"] = AccessToken(
        token="catalog",
        client_id="liquidaity-internal-runtime",
        scopes=["liquidaity.main"],
        expires_at=int(time.time()) + 60,
        claims={"internal": {"kind": "catalog-reader"}},
    )
    assert [tool.name for tool in asyncio.run(mcp_host.list_tools())] == [
        "canvas.inspect", "run_mag_one",
    ]
    current["token"] = None
    assert [tool.name for tool in asyncio.run(mcp_host.list_tools())] == [
        "canvas.inspect", "run_mag_one",
    ]


def test_card_invocation_injects_caller_identity_and_main_uses_the_external_cli_bridge(monkeypatch):
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
    bridge_calls = []

    async def run(args):
        calls.append(dict(args))
        return {"ok": True, "result": {"status": "completed", "output": "ok"}}

    async def bridge(path, payload):
        bridge_calls.append((path, dict(payload)))
        return [mcp_host.TextContent(
            type="text",
            text=json.dumps({"ok": True, "driverSource": "external_plugin"}),
        )]

    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: dict(context))
    monkeypatch.setattr(mcp_host, "_bridge", bridge)
    monkeypatch.setattr(control_plane, "card_run_assistant_agent", run)
    result = asyncio.run(mcp_host._dispatch_tool(
        "card.run_assistant_agent",
        {"cardId": "card-helper", "input": "bounded task"},
    ))
    assert json.loads(result[0].text)["ok"] is True
    assert calls[-1] == {
        "cardId": "card-helper",
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
    assert bridge_calls == [("external_main_chat", {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "mainCardId": "card-main",
        "message": "root entry",
    })]
    assert calls == []


def test_background_profile_handoff_binds_parent_from_authenticated_system_context(monkeypatch):
    import asyncio
    import mcp_host
    from app import control_plane

    context = {
        "projectId": "project-1", "deckId": "deck_builder", "conversationId": "main",
        "parentRunId": "parent-run", "mainCardId": "card-main",
        "callerRuntimeKind": "hermes", "callerRuntimeMode": "main",
        "principalKind": "system-root", "grantedTools": ["card.run_assistant_agent"],
    }
    calls = []

    async def run(args):
        calls.append(dict(args))
        return {"ok": True, "result": {"state": "running", "runId": "child-run"}}

    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: context)
    monkeypatch.setattr(control_plane, "card_run_assistant_agent", run)
    result = asyncio.run(mcp_host._dispatch_tool("card.run_assistant_agent", {
        "cardId": "card-builder", "input": "Prepare a proposal.", "background": True,
    }))
    assert json.loads(result[0].text)["ok"] is True
    assert calls[-1]["originatingAgentId"] == "card-main"
    assert calls[-1]["originatingRunId"] == "parent-run"
    assert calls[-1]["background"] is True
    forged = asyncio.run(mcp_host._dispatch_tool("card.run_assistant_agent", {
        "cardId": "card-builder", "input": "Prepare a proposal.", "background": True,
        "originatingRunId": "forged-parent",
    }))
    assert "caller_identity_rejected" in json.loads(forged[0].text)["error"]
    assert len(calls) == 1


def test_builder_update_uses_explicit_target_and_revisions_with_saved_grants(monkeypatch):
    import asyncio
    import mcp_host
    from app import control_plane
    observed = []
    async def update(args, **authority):
        observed.append((dict(args), dict(authority)))
        return {"ok": True, "cardId": args["cardId"]}
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: {
        "projectId": "project-1", "deckId": "deck_builder", "conversationId": "conversation-1",
        "parentRunId": "builder-run-1", "mainCardId": "builder", "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "delegate", "principalKind": "card-runtime",
        "grantedTools": ["card.update_configuration"],
    })
    monkeypatch.setattr(control_plane, "card_update_configuration", update)
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
    from app import control_plane
    observed = []
    async def update(args, **authority):
        observed.append((args, authority))
        return {"ok": True}
    monkeypatch.setattr(mcp_host, "_internal_mcp_principal", lambda: None)
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: {
        "projectId": "p", "deckId": "deck_builder", "mainCardId": "main",
        "conversationId": "c", "parentRunId": "r",
    })
    monkeypatch.setattr(control_plane, "card_update_configuration", update)
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


def test_builder_cbm_read_forwards_explicit_native_arguments_without_operation_tasks(monkeypatch):
    import asyncio
    import mcp_host
    calls = []
    async def catalog():
        return []
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: {
        "projectId": "p", "deckId": "d", "mainCardId": "builder",
        "principalKind": "card-runtime", "grantedTools": ["cbm.search_graph"],
    })
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", catalog)
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_NAMES", {"search_graph"})
    monkeypatch.setattr(mcp_host, "_call_native_cbm", lambda name, args: calls.append((name, args)) or [])
    args = {"project": "C-Projects-LiquidAIty-main", "query": "materialize_idf"}
    asyncio.run(mcp_host._dispatch_tool("cbm.search_graph", args))
    assert calls == [("search_graph", args)]


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

    monkeypatch.setattr(mcp_host, "_native_cbm_tools", forbidden_native_init)
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", forbidden_native_init)

    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_host, "_CATALOG_TOOLS", tuple(
        mcp_host.Tool(name=name, inputSchema={"type": "object"})
        for name in ("main.context", "canvas.inspect", "web_search")
    ))
    assert mcp_host._authenticated_main_context() == context
    assert [tool.name for tool in asyncio.run(mcp_host.list_tools())] == [
        "main.context",
        "canvas.inspect",
        "web_search",
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


def test_trusted_hermes_stdio_context_enforces_main_and_graph_agent_tool_roles(monkeypatch):
    import mcp_host

    helper_context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "parent-1",
        "mainCardId": "card_hermes_steward",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "delegate",
    }
    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "stdio")
    monkeypatch.setenv("MCP_TRUSTED_MAIN_CONTEXT", json.dumps(helper_context))

    assert mcp_host._trusted_stdio_main_context() == helper_context
    assert mcp_host._enforce_tool_caller(
        "run_mag_one",
        {
            "_callerCardId": "card_hermes_steward",
            "_callerRuntimeKind": "hermes",
            "_callerRuntimeMode": "delegate",
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
        "mainCardId": "card_helper",
        "nativeChildId": "sa-helper",
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
    assert attention["cardId"] == "card_helper"
    assert observed == [attention]


def test_helper_root_context_is_active_before_native_cbm_dispatch_and_persists_exact_refs(
    monkeypatch,
):
    import asyncio
    import mcp_host
    from app.python_models import card_domain
    from mcp.types import CallToolResult, TextContent

    context = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "conversationId": "helper-conversation-one",
        "parentRunId": "helper-run-one",
        "rootRunId": "helper-run-one",
        "mainCardId": "card_delegate",
        "nativeChildId": "",
        "grantedTools": ["cbm.search_code"],
    }
    dispatched_contexts = []
    observed = []
    native_result = CallToolResult(
        content=[TextContent(type="text", text="current native CBM result")],
        structuredContent={
            "cols": ["qn", "label", "file", "lines"],
            "rows": [[
                "C-Projects-LiquidAIty-main.apps.python-models.app.python_models.idf.materialize_idf",
                "Function",
                "apps/python-models/app/python_models/idf.py",
                "37-78",
            ]],
        },
    )

    async def dispatch(_name, _arguments):
        dispatched_contexts.append(mcp_host._authenticated_main_context())
        return native_result

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)
    monkeypatch.setattr(mcp_host, "_request_tool_is_allowed", lambda _name: True)
    monkeypatch.setattr(mcp_host, "_request_execution_context", lambda: dict(context))
    monkeypatch.setattr(
        card_domain,
        "observe_native_attention",
        lambda event: observed.append(dict(event)) or True,
    )

    result = asyncio.run(mcp_host.call_tool(
        "cbm.search_code",
        {"project": "C-Projects-LiquidAIty-main", "pattern": "materialize_idf"},
    ))

    assert dispatched_contexts == [context]
    assert isinstance(result, CallToolResult)
    assert result.content[0].text == "current native CBM result"
    assert result.meta is not None
    attention = result.meta["nativeAttention"]
    assert attention["runId"] == "helper-run-one"
    assert attention["cardId"] == "card_delegate"
    assert attention["toolName"] == "cbm.search_code"
    assert attention["nativeNodeIds"] == [
        "C-Projects-LiquidAIty-main.apps.python-models.app.python_models.idf.materialize_idf",
        "apps/python-models/app/python_models/idf.py",
    ]
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
    from app.python_models import card_domain

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

    async def load_instructions(args):
        calls.append(("write_mag_one_instructions", dict(args)))
        return {
            "ok": True,
            "ready": True,
            "projectId": args["projectId"],
            "deckId": args["deckId"],
            "targetCardId": args["targetCardId"],
            "targetCardTitle": "Helper",
            "mission": str(args["mission"]).strip(),
            "dataAnchors": [{**anchor, "required": True} for anchor in args["dataAnchors"]],
            "reviewContext": {
                "resolvedNativeReads": [{
                    "authority": "CodeGraph", "nativeId": "symbol-one",
                }],
                "resolvedGraphProjection": {
                    "nodes": [{"id": "symbol-one"}], "edges": [],
                },
            },
            "sourceCardId": args["_sourceCardId"],
            "persisted": False,
            "started": False,
        }

    async def load_graph(args):
        calls.append(("card.load_graph_references", dict(args)))
        return {
            "ok": True,
            "targetCardId": args["targetCardId"],
            "sourceCardId": args["_sourceCardId"],
            "sourceRunId": args["_sourceRunId"],
            "reference": {
                "authority": args["authority"], "nativeId": args["nativeId"],
                "reason": args["reason"], "order": args["order"],
                "boundedExpansion": args["depth"], "resultLimit": args["resultLimit"],
                "required": args["required"],
            },
            "resolvedReferences": [], "resolvedContextMarkdown": "# KnowGraph\nCurrent data",
            "resolved": True, "ready": True, "persisted": False, "started": False,
        }

    monkeypatch.setattr(control_plane, "write_mag_one_instructions", load_instructions)
    monkeypatch.setattr(control_plane, "card_load_graph_references", load_graph)
    monkeypatch.setattr(
        card_domain,
        "resolve_magentic_target_card",
        lambda project_id, deck_id, _sender_id: {
            "projectId": project_id,
            "deckId": deck_id,
            "cardId": "card_mag_one",
        },
    )

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
        },
    )
    asyncio.run(mcp_host._dispatch_tool("agentgraph.inspect", {"limit": 5}))
    assert calls[-1][1] == {"limit": 5, "projectId": "project-1", "deckId": "deck_builder",
                            "conversationId": "external-mcp:grant-1"}
    asyncio.run(mcp_host._dispatch_tool("agentgraph.inspect", {"projectWide": True, "limit": 5}))
    assert calls[-1][1] == {"projectWide": True, "limit": 5, "projectId": "project-1", "deckId": "deck_builder"}

    proposed = asyncio.run(
        mcp_host._dispatch_tool(
            "write_mag_one_instructions",
            {
                "targetCardId": "card_delegate",
                "mission": "  exact proposed mission\nwith formatting  ",
                "dataAnchors": [{
                    "authority": "CodeGraph", "nativeId": "symbol-one",
                    "reason": "Current source owner", "priority": 0,
                    "boundedExpansion": 0, "resultLimit": 4,
                }],
            },
        )
    )
    proposal_payload = json.loads(proposed[0].text)
    assert proposal_payload["mission"] == "exact proposed mission\nwith formatting"
    assert proposal_payload["targetCardId"] == "card_delegate"
    assert proposal_payload["ready"] is True
    assert proposal_payload["persisted"] is False
    assert proposal_payload["started"] is False
    assert calls[-1][0] == "write_mag_one_instructions"
    assert calls[-1][1]["projectId"] == "project-1"
    assert calls[-1][1]["deckId"] == "deck_builder"
    assert calls[-1][1]["_sourceCardId"] == "card_main_chat"

    loaded = asyncio.run(
        mcp_host._dispatch_tool(
            "card.load_graph_references",
            {
                "targetCardId": "card_mag_one", "authority": "KnowGraph",
                "nativeId": "episode-1", "reason": "Current sourced evidence",
                "order": 0, "depth": 1, "resultLimit": 8, "required": True,
            },
        )
    )
    loaded_payload = json.loads(loaded[0].text)
    assert loaded_payload["ready"] is True
    assert loaded_payload["sourceCardId"] == "card_main_chat"
    assert loaded_payload["sourceRunId"] == "external-main:grant-1"
    assert calls[-1][0] == "card.load_graph_references"

    executed = asyncio.run(
        mcp_host._dispatch_tool(
            "run_mag_one",
            {
                "input": "exact proposed mission",
                "dataAnchors": [{
                    "authority": "KnowGraph", "nativeId": "episode-1",
                    "reason": "Current sourced evidence", "priority": 0,
                    "boundedExpansion": 1, "resultLimit": 8,
                }],
            },
        )
    )
    assert json.loads(executed[0].text) == {"ok": True}
    assert calls[-1][0] == "run_configured_card"
    assert calls[-1][1] == {
        "action": "execute",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "cardId": "card_mag_one",
        "senderCardId": "card_main_chat",
        "correlationId": calls[-1][1]["correlationId"],
        "conversationId": "external-mcp:grant-1",
        "input": "exact proposed mission",
        "dataAnchors": [{
            "authority": "KnowGraph", "nativeId": "episode-1",
            "reason": "Current sourced evidence", "priority": 0,
            "boundedExpansion": 1, "resultLimit": 8, "required": True,
        }],
    }

    executed_without_graph = asyncio.run(
        mcp_host._dispatch_tool(
            "run_mag_one",
            {"input": "mission with no selected graph data"},
        )
    )
    assert json.loads(executed_without_graph[0].text) == {"ok": True}
    assert calls[-1][0] == "run_configured_card"
    assert calls[-1][1]["cardId"] == "card_mag_one"
    assert calls[-1][1]["input"] == "mission with no selected graph data"
    assert "dataAnchors" not in calls[-1][1]


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
            # Exercise failure classification through a declared read-plane tool so
            # the access gate remains part of the contract under test.
            result = await mcp_host.call_tool("canvas.inspect", {"error": message})
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

    async def dispatch(name, arguments):
        if arguments.get("speed") == "slow":
            await asyncio.sleep(60)
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True, "name": name}))]

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)
    monkeypatch.setattr(mcp_host, "_MCP_CALL_TIMEOUT_SECONDS", 0.02)

    async def check():
        slow = asyncio.create_task(mcp_host.call_tool("canvas.inspect", {"speed": "slow"}))
        sibling = await asyncio.wait_for(
            mcp_host.call_tool("agentgraph.inspect", {"speed": "sibling"}),
            timeout=0.5,
        )
        timed_out = await asyncio.wait_for(slow, timeout=0.5)
        return sibling, timed_out

    sibling, timed_out = asyncio.run(check())
    assert json.loads(sibling[0].text) == {"ok": True, "name": "agentgraph.inspect"}
    assert timed_out.isError is True
    assert json.loads(timed_out.content[0].text)["failureCode"] == "timeout"


def test_long_running_native_tools_use_their_owned_timeouts(monkeypatch):
    import mcp_host

    monkeypatch.setattr(mcp_host, "_MCP_CALL_TIMEOUT_SECONDS", 30.0)
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_REQUEST_TIMEOUT_SECONDS", 300.0)

    assert mcp_host._mcp_tool_timeout_seconds("cbm.index_repository") == 300.0
    assert mcp_host._mcp_tool_timeout_seconds("card.run_assistant_agent") == 300.0
    assert mcp_host._mcp_tool_timeout_seconds("run_mag_one") == 300.0
    assert mcp_host._mcp_tool_timeout_seconds("engraphis_remember") == 190.0
    assert mcp_host._mcp_tool_timeout_seconds("engraphis_ingest") == 190.0
    assert mcp_host._mcp_tool_timeout_seconds("cbm.index_status") == 30.0
    assert mcp_host._mcp_tool_timeout_seconds("graphiti.get_status") == 30.0


def test_saved_card_backend_bridge_uses_the_long_running_timeout(monkeypatch):
    import mcp_host

    monkeypatch.setattr(mcp_host, "_MCP_CALL_TIMEOUT_SECONDS", 30.0)
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_REQUEST_TIMEOUT_SECONDS", 300.0)

    assert mcp_host._backend_bridge_timeout_seconds("run_configured_card") == 300.0
    assert mcp_host._backend_bridge_timeout_seconds("external_main_chat") == 300.0
    assert mcp_host._backend_bridge_timeout_seconds("external_main_context") == 30.0


@pytest.mark.parametrize("operation,route,has_secret", [
    ("external_main_chat", "/api/main/chat", True),
    ("external_main_context", "/api/main/context", False),
    ("describe_connected_agents", "/api/cards/connected", False),
    ("internal_execution_context", "/api/hermes/execution-context", False),
    ("run_configured_card", "/api/cards/run", False),
])
def test_backend_domain_routes_preserve_payload_and_process_owned_secret(
    monkeypatch, operation, route, has_secret,
):
    import mcp_host

    secret = "external-main-test-secret-0123456789abcdef"
    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return b'{"ok":true}'

    def open_request(request, *, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr(mcp_host, "INTERNAL_MCP_SECRET", secret)
    monkeypatch.setattr(mcp_host, "urlopen", open_request)

    assert json.loads(mcp_host._bridge_sync(
        operation, {"message": "hello"}
    )) == {"ok": True}
    assert captured["request"].full_url == f"{mcp_host.BACKEND}{route}"
    assert captured["request"].get_method() == "POST"
    assert json.loads(captured["request"].data) == {"message": "hello"}
    assert captured["request"].get_header(
        "X-liquidaity-internal-mcp-secret"
    ) == (secret if has_secret else None)
    assert captured["timeout"] == (
        mcp_host._NATIVE_CBM_REQUEST_TIMEOUT_SECONDS
        if operation in {"external_main_chat", "run_configured_card"}
        else mcp_host._MCP_CALL_TIMEOUT_SECONDS
    )




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


@pytest.mark.parametrize("name", ["engraphis_recall_context", "engraphis_get_memory"])
def test_idd_read_access_does_not_overwrite_native_side_effect_annotations(name):
    import mcp_host

    native = mcp_host.Tool(name=name, inputSchema={"type": "object"},
                          annotations={"readOnlyHint": False, "destructiveHint": False})
    bound = mcp_host._bind_idd_access(native)
    assert bound.annotations == native.annotations
    assert bound.meta["liquidaityAccess"] == "read"


def test_ungranted_and_destructive_tools_are_not_callable(monkeypatch):
    import asyncio
    import mcp_host

    principal = {"kind": "card-runtime", "grantedTools": ["graphiti.add_memory"]}
    monkeypatch.setattr(mcp_host, "_internal_mcp_principal", lambda: principal)
    assert mcp_host._request_tool_is_allowed("engraphis_remember") is False
    monkeypatch.setattr(mcp_host, "_internal_mcp_principal", lambda: principal)
    assert mcp_host._request_tool_is_allowed("cbm.search_graph") is False
    principal["grantedTools"].append("cbm.search_graph")
    assert mcp_host._request_tool_is_allowed("cbm.search_graph") is True
    assert mcp_host._request_tool_is_allowed("graphiti.add_memory") is True
    assert mcp_host._request_tool_is_allowed("graphiti.clear_graph") is False
    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_host, "_CATALOG_TOOLS", tuple(
        mcp_host.Tool(name=name, inputSchema={"type": "object"})
        for name in ["engraphis_remember", "cbm.search_graph", "graphiti.add_memory"]
    ))
    assert {tool.name for tool in asyncio.run(mcp_host.list_tools())} == {"engraphis_remember", "cbm.search_graph", "graphiti.add_memory"}


def test_cbm_structured_default_uses_one_native_call_and_preserves_explicit_format(monkeypatch):
    import mcp_host

    calls = []
    native = mcp_host.Tool(name="search_graph", description="Native search", inputSchema={
        "type": "object", "properties": {"format": {"type": "string", "enum": ["tree", "json"]}},
    })
    result = mcp_host.CallToolResult(content=[], structuredContent={"total": 0, "groups": []})
    monkeypatch.setattr(mcp_host, "_initialize_native_cbm_sync", lambda: None)
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_TOOLS", (native,))
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_CLIENT", SimpleNamespace(
        call_tool=lambda name, args: calls.append((name, args)) or result,
    ))
    arguments = {"project": "canonical"}
    assert mcp_host._call_native_cbm("search_graph", arguments) is result
    assert arguments == {"project": "canonical"}
    assert calls == [("search_graph", {"project": "canonical", "format": "json"})]
    mcp_host._call_native_cbm("search_graph", {**arguments, "format": "tree"})
    assert calls[-1][1]["format"] == "tree"
    advertised = mcp_host._namespace_native_tools("cbm", [native])[0]
    assert advertised.inputSchema["properties"]["format"]["default"] == "json"
    assert "default" not in native.inputSchema["properties"]["format"]


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
    monkeypatch.setattr(mcp_host, "_NATIVE_GRAPHITI_SERVICE_READY", True)
    monkeypatch.setattr(mcp_host, "_NATIVE_TOOL_TIMEOUT_SECONDS", 0.01)

    async def run():
        with pytest.raises(RuntimeError, match="native_graphiti_timeout:slow"):
            await mcp_host._call_native_graphiti("slow", {})
        return await mcp_host._call_native_graphiti("later", {})

    later = asyncio.run(run())
    assert cancelled is True
    assert json.loads(later.content[0].text)["ok"] is True


def test_application_catalog_preserves_saved_card_schemas_without_native_discovery(monkeypatch):
    import asyncio
    import jsonschema
    import mcp_host
    from app.python_models.idd import load_input_data_dictionary

    # This checks application schemas, not upstream process initialization.
    # The canonical catalog test supplies native catalog fixtures.
    application_ids = {
        item["id"] for item in load_input_data_dictionary()["operations"]
        if item["namespace"] in {"main", "engraphis"}
    }

    async def native_catalog_fixture():
        return []

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "stdio")
    monkeypatch.setattr(mcp_host, "OAUTH_ENFORCED", False)
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(mcp_host, "_configured_tool_allowlist", lambda: application_ids)
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", native_catalog_fixture)
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", native_catalog_fixture)

    async def check():
        tools = await mcp_host._materialize_complete_catalog()
        by_name = {tool.name: tool for tool in tools}
        assert by_name["card.run_assistant_agent"].inputSchema["anyOf"] == [
            {"required": ["cardId", "input"]},
            {"required": ["runId"]},
            {"required": ["nativeRootId"]},
        ]
        assert (
            "instructionId"
            not in by_name["card.run_assistant_agent"].inputSchema["properties"]
        )
        assert by_name["run_mag_one"].inputSchema["required"] == [
            "input", "projectId", "deckId",
        ]
        assert by_name["write_mag_one_instructions"].inputSchema["required"] == [
            "targetCardId", "mission",
        ]
        assert by_name["run_mag_one"].inputSchema["properties"]["dataAnchors"]["minItems"] == 0
        assert by_name["card.load_graph_references"].inputSchema["required"] == [
            "targetCardId", "authority", "nativeId", "reason", "order", "depth",
            "resultLimit", "required",
        ]
        assert by_name["card.create"].inputSchema["required"] == [
            "projectId",
            "deckId",
            "expectedRevision",
            "templateId",
            "title",
            "role",
            "prompt",
            "runtime",
            "model",
        ]
        assert by_name["card.create"].inputSchema["additionalProperties"] is False
        assert set(by_name["card.create"].inputSchema["properties"]) == {
            "projectId", "deckId", "expectedRevision", "templateId", "title",
            "role", "prompt", "runtime", "model", "tools", "nativeTools", "skills",
            "toolsets", "mcpConnectionIds", "subagentModel", "position",
        }
        runtime_schema = by_name["card.create"].inputSchema["properties"]["runtime"]
        assert runtime_schema == {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "minLength": 1},
                "mode": {"type": "string", "minLength": 1},
                "profile": {"type": "string", "minLength": 1},
            },
            "required": ["kind", "mode"],
            "additionalProperties": False,
        }
        # The receiving Card domain checks the exact IDD template binding;
        # transport must not impose the removed AutoGen-only creation rule.
        for binding in ({"kind": "hermes", "mode": "delegate"},
                        {"kind": "autogen", "mode": "assistant"}):
            jsonschema.validate(binding, runtime_schema)
        for binding in ({"kind": "hermes"}, {"kind": "hermes", "mode": ""},
                        {"kind": "hermes", "mode": "delegate", "override": True}):
            with pytest.raises(jsonschema.ValidationError):
                jsonschema.validate(binding, runtime_schema)
        update_properties = by_name["card.update_configuration"].inputSchema[
            "properties"
        ]["updates"]["properties"]
        assert set(update_properties) == {
            "configuration", "prompt", "title", "script", "subsystems", "tools",
            "nativeTools", "skills", "toolsets", "mcpConnectionIds", "modelKey", "provider",
            "providerModelId", "accessMode", "subagentModel", "reasoningEffort", "temperature", "maxTokens",
        }
        assert by_name["card.update_configuration"].inputSchema["required"] == [
            "projectId", "deckId", "cardId", "expectedRevision", "expectedCardRevisionId", "updates",
        ]
        assert by_name["card.update_configuration"].inputSchema[
            "properties"
        ]["updates"]["minProperties"] == 1
        assert "main.context" in by_name
        assert "agentgraph.inspect" in by_name
        assert "write_mag_one_instructions" in by_name
        assert "card.load_graph_references" in by_name
        assert {"engraphis_recall_context", "engraphis_get_memory", "engraphis_remember"}.issubset(by_name)
        assert not any(name.startswith("engraphis.") for name in by_name)
        assert all(
            tool.inputSchema.get("additionalProperties") is False
            for name, tool in by_name.items()
            if not name.startswith(("cbm.", "graphiti."))
        )
        assert "worldsignals.package" in by_name
        assert by_name
        assert len(tools) == len(by_name)
        from app.python_models.tool_registry import tool_manifest
        assert set(by_name) == application_ids | {item["name"] for item in tool_manifest()}
        return {name: tool.model_dump() for name, tool in by_name.items()}

    catalog = asyncio.run(check())
    assert len(catalog) == len(set(catalog))


def test_registered_runtime_mcp_tools_are_in_the_same_catalog(monkeypatch):
    import asyncio
    import mcp_host
    from app.python_models.tool_registry import tool_manifest

    monkeypatch.setattr(mcp_host, "_native_cbm_tools", lambda: asyncio.sleep(0, result=[]))
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", lambda: asyncio.sleep(0, result=[]))
    tools = asyncio.run(mcp_host._materialize_complete_catalog())
    names = {tool.name for tool in tools}
    assert {item["name"] for item in tool_manifest()}.issubset(names)
    assert "card.run_assistant_agent" in names
    assert "delegate_task" not in names
    assert len(tools) == len(names)


def test_all_clients_receive_the_same_canonical_catalog_without_rewriting_metadata(
    monkeypatch,
):
    import asyncio
    import importlib
    import subprocess

    if "mcp_host" not in sys.modules:
        monkeypatch.setattr(
            subprocess,
            "run",
            lambda *_args, **_kwargs: SimpleNamespace(stdout=""),
        )
    mcp_host = importlib.import_module("mcp_host")
    from app.python_models.idd import load_input_data_dictionary
    from app.python_models.tool_registry import tool_access

    declarations = load_input_data_dictionary()["operations"]
    from app.python_models.tool_registry import tool_manifest
    from app.python_models.engraphis import READ_TOOLS, WRITE_TOOLS
    expected_names = {
        "main.context", "agentgraph.inspect", "mag_one.describe_connected_agents",
        "run_mag_one", "write_mag_one_instructions", "card.load_graph_references",
        "canvas.inspect", "card.create", "card.update_configuration",
        "canvas.upsert_wire", "web_search", "card.run_assistant_agent",
    } | READ_TOOLS | WRITE_TOOLS | {item["name"] for item in tool_manifest()}

    def native_tool(canonical_name, native_name):
        read_only = tool_access(canonical_name) == "read"
        return mcp_host.Tool.model_validate({
            "name": native_name,
            "title": f"Canonical {canonical_name}",
            "description": f"Canonical description for {canonical_name}.",
            "inputSchema": {
                "type": "object",
                "properties": {"probe": {"type": "string"}},
                "required": [],
                "additionalProperties": False,
            },
            "outputSchema": {
                "type": "object",
                "properties": {"ok": {"type": "boolean"}},
                "required": ["ok"],
                "additionalProperties": False,
            },
            "annotations": {
                "readOnlyHint": read_only,
                "destructiveHint": False,
                "idempotentHint": read_only,
                "openWorldHint": False,
            },
            "_meta": {"canonicalFixture": canonical_name},
        })

    by_namespace = {
        "cbm": [],
        "graphiti": [],
    }
    for declaration in declarations:
        namespace = declaration["namespace"]
        if namespace not in by_namespace:
            continue
        canonical_name = declaration["id"]
        native_name = canonical_name.split(".", 1)[1]
        expected_names.add(canonical_name)
        by_namespace[namespace].append(native_tool(canonical_name, native_name))

    async def cbm_tools():
        return by_namespace["cbm"]

    async def graphiti_tools():
        return by_namespace["graphiti"]

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "OAUTH_ENFORCED", True)
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(mcp_host, "_internal_mcp_principal", lambda: None)
    monkeypatch.setattr(mcp_host, "_configured_tool_allowlist", lambda: None)
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", cbm_tools)
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", graphiti_tools)

    canonical = asyncio.run(mcp_host._materialize_complete_catalog())
    canonical_by_name = {tool.name: tool for tool in canonical}
    assert set(canonical_by_name) == expected_names
    assert len(canonical) == len(canonical_by_name)
    monkeypatch.setattr(mcp_host, "_CATALOG_TOOLS", tuple(canonical))
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_host, "_configured_tool_allowlist", lambda: pytest.fail("catalog consulted an allowlist"))
    identities = set()
    for transport in ("streamable-http", "stdio"):
        monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", transport)
        for principal in (None, {"kind": "catalog-reader"}, {"kind": "system-root"},
                          {"kind": "materializer-read"},
                          {"kind": "card-runtime", "grantedTools": [], "presentedTools": []}):
            monkeypatch.setattr(mcp_host, "_internal_mcp_principal", lambda: principal)
            listed = asyncio.run(mcp_host.list_tools())
            assert all(a is b for a, b in zip(canonical, listed))
            assert len(listed) == len(canonical)
            assert {tool.name for tool in listed} == expected_names
            identities.add(mcp_host._catalog_identity(listed))
    assert identities == {mcp_host._catalog_identity(canonical)}
    for tool in listed:
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        assert payload["securitySchemes"] == [{
            "type": "oauth2", "scopes": [mcp_host.AUTH0_REQUIRED_SCOPE],
        }]
        assert payload["_meta"]["securitySchemes"] == payload["securitySchemes"]
    for namespace, fixtures in by_namespace.items():
        for fixture in fixtures:
            tool = canonical_by_name[f"{namespace}.{fixture.name}"]
            assert tool.title == fixture.title
            assert tool.description == fixture.description
            assert tool.outputSchema == fixture.outputSchema
            assert tool.annotations == fixture.annotations
            assert tool.meta["canonicalFixture"] == fixture.meta["canonicalFixture"]
            assert tool.inputSchema["properties"]["probe"] == {"type": "string"}
    assert canonical_by_name["web_search"].meta["liquidaitySource"]["sourceId"] == "main_mcp"
    assert {
        "cbm.delete_project",
        "cbm.detect_changes",
        "cbm.index_repository",
        "cbm.ingest_traces",
        "cbm.manage_adr",
        "engraphis_recall_context",
        "engraphis_get_memory",
        "engraphis_remember",
        "graphiti.clear_graph",
    }.issubset({tool.name for tool in listed})


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


def test_mag_one_tools_use_direct_transient_input_contract():
    import mcp_host

    assert mcp_host._ALLOWED_KEYS["run_mag_one"] == {
        "projectId", "deckId", "input", "conversationId", "dataAnchors",
    }
    assert mcp_host._ALLOWED_KEYS["write_mag_one_instructions"] == {
        "projectId", "deckId", "conversationId", "targetCardId", "mission",
        "dataAnchors", "_sourceCardId",
    }
    assert mcp_host._ALLOWED_KEYS["card.load_graph_references"] == {
        "projectId", "deckId", "conversationId", "targetCardId", "authority",
        "nativeId", "reason", "order", "depth", "resultLimit", "required",
        "_sourceCardId", "_sourceRunId",
    }










def test_streamable_http_binds_before_catalog_provider_initialization(monkeypatch):
    import asyncio
    import mcp_host

    events = []

    async def initialized_graphiti():
        events.append("graphiti_registry")

    async def initialized_cbm():
        events.append("cbm_registry")
        return []

    async def run_http():
        events.append("http")

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
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
    monkeypatch.setattr(mcp_host, "_CATALOG_TOOLS", None)
    with pytest.raises(RuntimeError, match="mcp_catalog_initializing"):
        asyncio.run(mcp_host.list_tools())

    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "failed")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", "RuntimeError: native_cbm_failed")
    with pytest.raises(RuntimeError, match="native_cbm_failed"):
        asyncio.run(mcp_host.list_tools())

    catalog_size = 7
    catalog_names = [f"tool-{index}" for index in range(catalog_size)]
    tools = tuple(
        Tool(
            name=name,
            description="ready",
            inputSchema={"type": "object", "properties": {}},
        )
        for name in catalog_names
    )
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_TOOLS", tools)
    ready = asyncio.run(mcp_host.list_tools())
    assert len(ready) == len({tool.name for tool in ready}) == catalog_size


def test_catalog_initialization_is_process_wide_once(monkeypatch):
    import asyncio
    import mcp_host
    from mcp.types import Tool

    calls = 0

    catalog_names = [f"tool-{index}" for index in range(5)]
    catalog_size = len(catalog_names)

    async def complete_catalog():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0)
        return [
            Tool(
                name=name,
                description="ready",
                inputSchema={"type": "object", "properties": {}},
            )
            for name in catalog_names
        ]

    monkeypatch.setattr(mcp_host, "_materialize_complete_catalog", complete_catalog)
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_TOOLS", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_INITIALIZATION_TASK", None)

    async def check():
        first = mcp_host._start_catalog_initialization()
        second = mcp_host._start_catalog_initialization()
        assert first is second
        await asyncio.gather(first, second)

    asyncio.run(check())
    assert calls == 1
    assert mcp_host._CATALOG_STATE == "ready"
    assert len(mcp_host._CATALOG_TOOLS or ()) == catalog_size


def test_catalog_task_cannot_end_in_false_initializing_state(monkeypatch):
    import asyncio
    import mcp_host

    async def incomplete_initializer():
        return None

    monkeypatch.setattr(
        mcp_host, "_initialize_catalog_once", incomplete_initializer
    )
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE_CODE", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE_SUMMARY", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_TOOLS", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_INITIALIZATION_TASK", None)

    async def check():
        await mcp_host._start_catalog_initialization()
        await asyncio.sleep(0)

    asyncio.run(check())
    diagnostics = mcp_host._catalog_diagnostics()
    assert diagnostics["catalogState"] == "failed"
    assert diagnostics["failureCode"] == "catalog_initializer_ended_without_state"
    assert mcp_host._CATALOG_TOOLS is None


def test_catalog_initialization_has_no_arbitrary_30_second_deadline():
    import inspect
    import mcp_host

    source = inspect.getsource(mcp_host._initialize_catalog_once)
    assert "wait_for" not in source
    assert "30" not in source


def test_catalog_progress_names_completed_and_active_families(monkeypatch):
    import asyncio
    import mcp_host

    snapshots = []

    async def cbm_catalog():
        snapshots.append(mcp_host._catalog_diagnostics())
        return []

    async def graphiti_catalog():
        snapshots.append(mcp_host._catalog_diagnostics())
        return []

    monkeypatch.setattr(mcp_host, "_configured_tool_allowlist", lambda: None)
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", cbm_catalog)
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", graphiti_catalog)
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_host, "_CATALOG_COMPLETED_FAMILIES", ())
    monkeypatch.setattr(mcp_host, "_CATALOG_INITIALIZING_FAMILY", "liquidaity")

    asyncio.run(mcp_host._materialize_complete_catalog())

    assert [item["initializingCatalogFamily"] for item in snapshots] == [
        "cbm",
        "graphiti",
    ]
    assert [item["completedCatalogFamilies"] for item in snapshots] == [
        ["liquidaity"],
        ["liquidaity", "cbm"],
    ]
    assert mcp_host._CATALOG_COMPLETED_FAMILIES == (
        "liquidaity",
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
    catalog_names = [f"tool-{index}" for index in range(catalog_size)]

    async def slow_complete_catalog():
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        return [
            Tool(
                name=name,
                description="ready",
                inputSchema={"type": "object", "properties": {}},
            )
            for name in catalog_names
        ]

    async def closed_graphiti():
        return None

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "HTTP_MCP_PORT", port)
    monkeypatch.setattr(mcp_host, "OAUTH_ENFORCED", False)
    monkeypatch.setattr(mcp_host, "_materialize_complete_catalog", slow_complete_catalog)
    monkeypatch.setattr(mcp_host, "_close_native_graphiti", closed_graphiti)
    monkeypatch.setattr(mcp_host, "_close_native_cbm", lambda: None)
    monkeypatch.setattr(
        mcp_host,
        "_codegraph_diagnostics",
        lambda: {"codeGraphReady": True},
    )
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_TOOLS", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_INITIALIZATION_TASK", None)

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
                assert readiness.json()["toolCount"] == catalog_size

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


def test_catalog_failure_is_truthful_and_unavailable(monkeypatch, capsys):
    import asyncio
    import mcp_host

    async def failed_catalog():
        raise RuntimeError("native_graphiti_catalog_failed")

    monkeypatch.setattr(mcp_host, "_materialize_complete_catalog", failed_catalog)
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_TOOLS", None)

    asyncio.run(mcp_host._initialize_catalog_once())

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
    assert "toolCount" not in diagnostics
    assert "catalogHash" not in diagnostics
    assert mcp_host._CATALOG_TOOLS is None
    stderr = capsys.readouterr().err
    assert "full local traceback follows" in stderr
    assert "Traceback (most recent call last)" in stderr
    assert "native_graphiti_catalog_failed" in stderr


def test_stdio_accepts_protocol_before_catalog_provider_initialization(monkeypatch):
    import asyncio
    import mcp_host

    events = []

    async def initialized_graphiti():
        events.append("graphiti_registry")

    async def run_stdio():
        events.append("stdio")

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "stdio")
    monkeypatch.setattr(mcp_host, "_initialize_native_graphiti", initialized_graphiti)
    monkeypatch.setattr(mcp_host, "_run_stdio", run_stdio)

    asyncio.run(mcp_host.main())

    assert events == ["stdio"]








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


def test_http_mcp_targets_checksum_pinned_appdata_codegraph():
    import mcp_host

    command, args, cwd = mcp_host._native_cbm_config()
    assert command == os.path.abspath(mcp_host._NATIVE_CBM_BINARY)
    assert args == []
    assert cwd == mcp_host._NATIVE_CBM_HOST_REPO_ROOT


def test_codegraph_readiness_uses_the_existing_frontend_and_native_project_state(monkeypatch):
    import mcp_host
    from mcp.types import CallToolResult, TextContent

    class ReadyClient:
        server_info = {"name": "codebase-memory-mcp", "version": "0.10.8"}

        def is_running(self):
            return True

        def call_tool(self, name, arguments, *, timeout_seconds):
            assert timeout_seconds == mcp_host._NATIVE_CBM_HEALTH_TIMEOUT_SECONDS
            if name == "list_projects":
                payload = {
                    "projects": [{
                        "name": "C-Projects-LiquidAIty-main",
                        "root_path": mcp_host._NATIVE_CBM_HOST_REPO_ROOT,
                        "node_count": 4459,
                        "edge_count": 16773,
                    }],
                }
            else:
                assert name == "index_status"
                assert arguments == {"project": "C-Projects-LiquidAIty-main"}
                payload = {
                    "status": "ready",
                    "nodes": 4459,
                    "edges": 16773,
                    "generation": "generation-1",
                    "revision": "revision-1",
                }
            return CallToolResult(
                content=[TextContent(type="text", text=json.dumps(payload))]
            )

    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_CLIENT", ReadyClient())
    monkeypatch.setattr(
        mcp_host,
        "_host_codegraph_runtime",
        lambda: {
            "runtimeReady": True,
            "runtimeState": "ready",
            "binaryReady": True,
            "binaryState": "ready",
        },
    )
    monkeypatch.setattr(
        mcp_host,
        "_native_codegraph_watcher_status",
        lambda: {"watcherActive": True, "watcherState": "active"},
    )

    diagnostics = mcp_host._codegraph_diagnostics()
    assert diagnostics["runtimeReady"] is True
    assert diagnostics["binaryReady"] is True
    assert diagnostics["daemonAttached"] is True
    assert diagnostics["nativeFrontendAttached"] is True
    assert diagnostics["canonicalProjectRegistered"] is True
    assert diagnostics["indexReady"] is True
    assert diagnostics["watcherActive"] is True
    assert diagnostics["watcherState"] == "active"
    assert diagnostics["codeGraphReady"] is True
    assert diagnostics["indexGeneration"] == "generation-1"


def test_codegraph_readiness_fails_closed_when_native_watcher_reports_git_failure(
    monkeypatch, tmp_path,
):
    import mcp_host

    daemon_log = tmp_path / "cbm-daemon.log"
    daemon_log.write_text(
        "level=info msg=watcher.start interval_ms=multi-sec\n"
        "level=info msg=watcher.watch project=C-Projects-LiquidAIty-main "
        f"path={mcp_host._NATIVE_CBM_HOST_REPO_ROOT}\n"
        "level=error msg=watcher.git.failed project=C-Projects-LiquidAIty-main "
        "reason=deadline\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_DAEMON_LOG", str(daemon_log))

    status = mcp_host._native_codegraph_watcher_status()
    assert status == {
        "watcherActive": False,
        "watcherState": "failed",
        "watcherFailure": "deadline",
    }


def test_codegraph_readiness_rejects_a_ready_catalog_with_no_project(monkeypatch):
    import mcp_host
    from mcp.types import CallToolResult, TextContent

    class EmptyClient:
        server_info = {"name": "codebase-memory-mcp", "version": "0.10.8"}

        def is_running(self):
            return True

        def call_tool(self, name, _arguments, *, timeout_seconds):
            assert name == "list_projects"
            assert timeout_seconds == mcp_host._NATIVE_CBM_HEALTH_TIMEOUT_SECONDS
            return CallToolResult(
                content=[TextContent(type="text", text=json.dumps({"projects": []}))]
            )

    monkeypatch.setattr(mcp_host, "_NATIVE_CBM_CLIENT", EmptyClient())
    monkeypatch.setattr(
        mcp_host,
        "_host_codegraph_runtime",
        lambda: {
            "runtimeReady": True,
            "runtimeState": "ready",
            "binaryReady": True,
            "binaryState": "ready",
        },
    )

    diagnostics = mcp_host._codegraph_diagnostics()
    assert diagnostics["daemonAttached"] is True
    assert diagnostics["canonicalProjectRegistered"] is False
    assert diagnostics["indexReady"] is False
    assert diagnostics["codeGraphReady"] is False


def test_dev_fresh_owns_the_checksum_pinned_appdata_codegraph_preflight():
    script = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))),
        "scripts",
        "start-dev-services.ps1",
    )
    source = open(script, encoding="utf-8").read()
    assert "MCP_CBM_BINARY" in source
    assert "LOCALAPPDATA" in source
    assert "codebase-memory-mcp 0.10.8" in source
    assert mcp_host_sha256() in source
    assert "docker" not in source.lower()
    assert "compose" not in source.lower()
    assert "AddSeconds(60)" not in source
    assert "POSTGRES_PASSWORD" not in source
    assert "NEO4J_PASSWORD" not in source


def mcp_host_sha256():
    return "b4b403b1d7c4def3785f148b93f345ce8427858f4f5489ce28580c4387a336a6"


def test_repository_has_one_application_owned_host_cbm_boundary():
    repo_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    )
    forbidden_paths = [
        os.path.join(repo_root, ".codex", "hooks.json"),
        os.path.join(repo_root, ".codex", "hooks", "cbm_" + "graph_handoff.ps1"),
        os.path.join(repo_root, "scripts", "setup-" + "codebase-memory-mcp.ps1"),
        os.path.join(repo_root, "scripts", "check-" + "codebase-memory-mcp.ps1"),
        os.path.join(repo_root, ".tools", "codebase-memory-mcp"),
    ]
    assert all(not os.path.exists(path) for path in forbidden_paths)

    package = json.loads(open(os.path.join(repo_root, "package.json"), encoding="utf-8").read())
    assert "mcp:" + "setup" not in package["scripts"]
    assert "mcp:" + "check" not in package["scripts"]
    assert "CBM_UI_ENABLED" not in package["scripts"]["dev:mcp"]
    assert "9749" not in package["scripts"]["dev:mcp"]

    assert not os.path.exists(os.path.join(repo_root, "Dockerfile.codegraph"))
    assert not os.path.exists(os.path.join(repo_root, "compose.codegraph.yaml"))

    startup = open(
        os.path.join(repo_root, "scripts", "start-dev-services.ps1"),
        encoding="utf-8",
    ).read()
    assert "LiquidAIty\\cbm\\0.10.8\\codebase-memory-mcp.exe" in startup
    assert "MCP_CBM_BINARY" in startup

    vite = open(os.path.join(repo_root, "client", "vite.config.ts"), encoding="utf-8").read()
    assert "127.0.0.1:9749" not in vite

    codegraph_surface = open(
        os.path.join(
            repo_root,
            "client",
            "src",
            "components",
            "knowledge",
            "NativeAuthorityGraphSurface.tsx",
        ),
        encoding="utf-8",
    ).read()
    assert "vendor/codebase-memory-ui/src/components/GraphTab" in codegraph_surface
    assert "attentionData={attentionData}" in codegraph_surface


def test_codegraph_host_root_derives_the_canonical_project_identity():
    repo_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    )
    paths = [
        os.path.join(repo_root, "apps", "python-models", "app", "mcp_host.py"),
        os.path.join(repo_root, "scripts", "start-dev-services.ps1"),
    ]
    sources = [open(path, encoding="utf-8").read() for path in paths]
    removed_root = "/" + "workspace" + "/main"
    assert "_NATIVE_CBM_HOST_REPO_ROOT" in sources[0]
    assert "MCP_CBM_BINARY" in sources[1]
    assert all(removed_root not in source for source in sources)


def test_native_cbm_index_pins_the_canonical_host_checkout():
    import mcp_host

    normalized = mcp_host._normalize_native_cbm_index_arguments({
        "repo_path": mcp_host._REPO_ROOT.replace("\\", "/"),
        "name": "workspace-main",
        "mode": "full",
        "persistence": False,
    })

    assert normalized == {
        "repo_path": mcp_host._NATIVE_CBM_HOST_REPO_ROOT,
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
        {"project": "C-Projects-LiquidAIty-main", "query": "Graph Agent continuity"},
    )

    assert calls == [
        (
            "search_graph",
            {
                "project": "C-Projects-LiquidAIty-main",
                "query": "Graph Agent continuity",
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


def test_native_cbm_bootstrap_failure_does_not_spawn_a_second_frontend(monkeypatch):
    import mcp_host

    attempts = []
    class NativeClient:
        def __init__(self, command, args, cwd):
            attempts.append((command, list(args), cwd))
            raise RuntimeError(
                "native_cbm_process_exited:1:codebase-memory-mcp: "
                "CBM daemon could not start within 30000 ms"
            )

    monkeypatch.setattr(mcp_host, "_NativeStdioMcpClient", NativeClient)
    with pytest.raises(RuntimeError, match="CBM daemon could not start within 30000 ms"):
        mcp_host._open_native_cbm_client(
            "docker", ["exec", "-i", "codegraph", "/usr/local/bin/codebase-memory-mcp"], "repo"
        )

    assert attempts == [
        (
            "docker",
            ["exec", "-i", "codegraph", "/usr/local/bin/codebase-memory-mcp"],
            "repo",
        )
    ]


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


def test_native_cbm_duplicate_catalog_closes_the_only_frontend(monkeypatch):
    import mcp_host

    attempts = 0
    closed = False
    native_tool = mcp_host.Tool(
        name="search_graph",
        description="Native project search.",
        inputSchema={"type": "object", "properties": {}},
    )

    class NativeClient:
        def __init__(self, _command, _args, _cwd):
            nonlocal attempts
            attempts += 1

        def list_tools(self):
            return [native_tool, native_tool]

        def close(self):
            nonlocal closed
            closed = True

    monkeypatch.setattr(mcp_host, "_NativeStdioMcpClient", NativeClient)
    with pytest.raises(RuntimeError, match="native_cbm_duplicate_tool_name"):
        mcp_host._open_native_cbm_client("docker", [], "repo")
    assert attempts == 1
    assert closed is True


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
    monkeypatch.setattr(
        mcp_host,
        "_codegraph_diagnostics",
        lambda: {"codeGraphReady": True},
    )
    monkeypatch.setattr(mcp_host, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_host, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_TOOLS", None)
    monkeypatch.setattr(mcp_host, "_CATALOG_INITIALIZATION_TASK", None)

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

            async with httpx.AsyncClient(
                headers={"Authorization": "Bearer request-scoped-test-token"},
                timeout=2,
            ) as security_client:
                invalid_host = await security_client.post(
                    f"http://127.0.0.1:{port}/mcp",
                    headers={"host": "untrusted.example"},
                    json={},
                )
                assert invalid_host.status_code == 421
                assert invalid_host.text == "Invalid Host header"

                invalid_origin = await security_client.post(
                    f"http://127.0.0.1:{port}/mcp",
                    headers={"origin": "https://untrusted.example"},
                    json={},
                )
                assert invalid_origin.status_code == 403
                assert invalid_origin.text == "Invalid Origin header"

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
                            listed_tools = (await session.list_tools()).tools
                            actual = sorted(tool.name for tool in listed_tools)
                            catalog_identity = mcp_host._catalog_identity(listed_tools)
                            result = await session.call_tool("main.context", {})
                            visible_context = json.loads(result.content[0].text)["context"]
                            receipt = json.loads(result.content[-1].text)["executionReceipt"]
                            invalid = await session.call_tool("not_a_real_tool", {})
                            invalid_receipt = json.loads(
                                invalid.content[-1].text
                            )["executionReceipt"]
                assert response_session_ids
                assert all(value is None for value in response_session_ids)
                assert receipt["tool"] == "main.context"
                assert receipt["state"] == "completed"
                assert invalid.isError is True
                assert invalid_receipt["tool"] == "not_a_real_tool"
                assert invalid_receipt["state"] == "failed"
                assert invalid_receipt["failureCode"]
                return actual, visible_context, catalog_identity

            first_catalog, first_context, first_identity = await fresh_client()
            second_catalog, second_context, second_identity = await fresh_client()
            assert first_catalog == second_catalog
            assert first_catalog
            assert len(first_catalog) == len(set(first_catalog))
            assert {
                "main.context",
                "canvas.inspect",
                "agentgraph.inspect",
                "cbm.search_graph",
                "graphiti.get_status",
                "engraphis_recall_context",
                "mag_one.describe_connected_agents",
                "write_mag_one_instructions",
            }.issubset(first_catalog)
            assert not any(name.startswith("liquidaity.") for name in first_catalog)
            assert not any(name.startswith("liquidaity_liquidaity_") for name in first_catalog)
            assert not any(name.startswith("mcp__") for name in first_catalog)
            assert first_context == second_context == context
            assert first_identity == second_identity
            assert readiness.json()["toolCount"] == first_identity[0]
            assert readiness.json()["uniqueToolCount"] == first_identity[0]
            assert readiness.json()["catalogHash"] == first_identity[1]
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
    within_clock_skew = verifier._verify_sync(encoded({**base, "iat": now + 2}))
    assert within_clock_skew is not None
    monkeypatch.setattr(
        mcp_host,
        "_resolve_external_main_context_sync",
        lambda _issuer, _subject: None,
    )
    verified_without_project = verifier._verify_sync(encoded(base))
    assert verified_without_project is not None
    assert verified_without_project.subject == "auth0|jeremiah"
    assert "main" not in verified_without_project.claims
    invalid_claims = [
        {**base, "iss": "https://wrong.auth0.com/"},
        {**base, "aud": "https://wrong.example/mcp"},
        {**base, "exp": now - mcp_host.AUTH0_CLOCK_SKEW_SECONDS - 1},
        {**base, "iat": now + mcp_host.AUTH0_CLOCK_SKEW_SECONDS + 1},
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
        "_NATIVE_GRAPHITI_NAMES",
        frozenset(tool.name for tool in native_graphiti_tools),
    )
    monkeypatch.setattr(
        mcp_host,
        "_native_graphiti_tools",
        lambda: asyncio.sleep(0, result=native_graphiti_tools),
    )
    asyncio.run(mcp_host._initialize_catalog_once())
    tools = asyncio.run(mcp_host.list_tools())
    by_name = {tool.name: tool for tool in tools}
    assert len(tools) == len(by_name)
    assert "card.run_assistant_agent" in by_name
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
    assert "write_mag_one_instructions" in by_name
    assert "card.run_assistant_agent" in by_name
    assert not any(name.startswith("mcp__") for name in by_name)
    native_names = {
        f"cbm.{tool.name}" for tool in native_cbm_tools
    } | {
        f"graphiti.{tool.name}" for tool in native_graphiti_tools
    }
    assert all(
        tool.inputSchema.get("additionalProperties") is False
        for name, tool in by_name.items()
        if name not in native_names
    )
    assert "worldsignals.package" in by_name
    assert {"engraphis_recall_context", "engraphis_get_memory", "engraphis_remember"}.issubset(by_name)
    assert "projectId" not in by_name["engraphis_recall_context"].inputSchema["properties"]
    assert "projectId" not in by_name["engraphis_remember"].inputSchema["properties"]
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
    assert set(card_tool.inputSchema["properties"]) == {
        "action", "background", "cardId", "cardRevisionId", "runId", "nativeRootId", "input",
        "dataAnchors",
    }
    assert card_tool.inputSchema["anyOf"] == [
        {"required": ["cardId", "input"]},
        {"required": ["runId"]},
        {"required": ["nativeRootId"]},
    ]
    assert "saved runtime adapter" in card_tool.description
    assert "instructionId" not in card_tool.inputSchema["properties"]
    assert {scheme["scopes"][0] for scheme in by_name["engraphis_recall_context"].model_dump()["securitySchemes"]} == {"liquidaity.main"}
    assert {scheme["scopes"][0] for scheme in by_name["cbm.search_graph"].model_dump()["securitySchemes"]} == {"liquidaity.main"}
    assert {scheme["scopes"][0] for scheme in by_name["graphiti.get_status"].model_dump()["securitySchemes"]} == {"liquidaity.main"}
    assert by_name["cbm.search_graph"].description == "Native search description."
    assert by_name["cbm.search_graph"].inputSchema == native_cbm_tools[0].inputSchema
    assert by_name["cbm.search_graph"].annotations == native_cbm_tools[0].annotations
    assert by_name["graphiti.search_nodes"].annotations == native_graphiti_tools[1].annotations
    assert by_name["cbm.search_graph"].meta["liquidaityAccess"] == "read"

    active_scopes[:] = ["main"]
    main_names = {tool.name for tool in asyncio.run(mcp_host.list_tools())}
    assert {
        "main.context", "canvas.inspect",
        "run_mag_one", "cbm.search_graph",
        "graphiti.search_nodes",
    }.issubset(main_names)
    assert {
        "engraphis_recall_context", "graphiti.get_status",
        "card.create", "card.update_configuration", "canvas.upsert_wire",
    }.issubset(main_names)
    active_scopes[:] = ["main"]

    calls = []
    def thinkgraph_call(name, project_id, arguments):
        calls.append((name, project_id, arguments))
        return {"ok": True, "id": arguments.get("id"), "nodes": []}

    monkeypatch.setattr(
        mcp_host, "_thinkgraph_via_python_rails_sync", thinkgraph_call
    )

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

    asyncio.run(mcp_host.call_tool("engraphis_recall_context", {"query": "Main", "token_budget": 2000}))
    assert calls[-1] == (
        "engraphis_recall_context",
        "project-1",
        {"query": "Main", "token_budget": 2000},
    )

    memory = {
        "title": "Approved fact", "content": "Approved fact",
    }
    asyncio.run(mcp_host.call_tool("engraphis_remember", memory))
    assert calls[-1] == (
        "engraphis_remember",
        "project-1",
        memory,
    )
    rejected_scope = asyncio.run(mcp_host.call_tool(
        "engraphis_remember",
        {**memory, "projectId": "other-project"},
    ))
    assert json.loads(rejected_scope.content[0].text) == {
        "ok": False,
        "error": "caller_identity_rejected: projectId",
    }

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

    card_tool_result = asyncio.run(mcp_host.call_tool("card.run_assistant_agent", {
        "cardId": "card_agent",
        "input": "Use the assigned context.",
    }))
    assert json.loads(card_tool_result[0].text)["ok"] is True
    assert calls[-1][0] == "card_run_assistant_agent"

    denied = asyncio.run(mcp_host.call_tool("card.run_assistant_agent", {
        "projectId": "spoofed",
        "cardId": "helper-card",
        "input": "Approved exact task.",
    }))
    assert denied.isError is True
    assert '"error": "caller_identity_rejected: projectId"' in denied.content[0].text


def test_authenticated_catalog_uses_one_main_scope_for_the_full_registry(monkeypatch):
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
            "cbm",
            "graphiti",
        ],
        "initializingCatalogFamily": None,
        "toolCount": expected_count,
        "uniqueToolCount": len({tool.name for tool in authenticated}),
        "catalogHash": expected_hash,
        "processId": mcp_host._STARTUP_PROCESS_ID,
        "startupId": mcp_host._STARTUP_ID,
        "sourceRevision": mcp_host._STARTUP_SOURCE_REVISION,
        "sourceSha256": mcp_host._STARTUP_SOURCE_SHA256,
        "currentSourceSha256": mcp_host._STARTUP_SOURCE_SHA256,
        "sourceCurrent": True,
    }


def test_canonical_tunnel_is_transport_only_and_mcp_owns_public_metadata():
    from urllib.parse import urlsplit

    repo_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    )
    with open(os.path.join(repo_root, "package.json"), encoding="utf-8") as package_file:
        package = json.load(package_file)

    resource_url = package["config"]["mcp_public_resource_url"]
    parsed = urlsplit(resource_url)
    assert parsed.scheme == "https"
    assert parsed.path == "/mcp"
    assert not parsed.query and not parsed.fragment
    public_origin = f"{parsed.scheme}://{parsed.netloc}"

    tunnel_command = package["scripts"]["dev:tunnel"]
    assert tunnel_command == (
        f"ngrok http http://127.0.0.1:8765 --url {public_origin}"
    )
    assert "start-mcp-tunnel.ps1" not in tunnel_command
    assert not os.path.exists(os.path.join(repo_root, "scripts", "start-mcp-tunnel.ps1"))

    mcp_command = package["scripts"]["dev:mcp"]
    assert "MCP_PUBLIC_RESOURCE_URL=%npm_package_config_mcp_public_resource_url%" in mcp_command
    assert "MCP_AUTH0_AUDIENCE=%npm_package_config_mcp_public_resource_url%" in mcp_command
    assert "MCP_OAUTH_ENFORCED=true" in mcp_command


def test_oauth_catalog_declares_security_before_main_context_resolution(monkeypatch):
    import asyncio
    import mcp_host

    async def empty_catalog():
        return []

    monkeypatch.setattr(mcp_host, "OAUTH_ENFORCED", True)
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", empty_catalog)
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", empty_catalog)

    tools = asyncio.run(mcp_host._materialize_complete_catalog())
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

    attempts = 0

    async def inspect(_args):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("database_connection_lost")
        return {"ok": True, "cards": []}

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
    monkeypatch.setattr(mcp_host, "_initialize_native_graphiti", initialized)
    monkeypatch.setattr(mcp_host, "_native_graphiti_tools", empty_catalog)
    monkeypatch.setattr(mcp_host, "_native_cbm_tools", empty_catalog)

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


def test_script_bootstrap_imports_card_schema_without_pythonpath(tmp_path):
    import subprocess
    host = os.path.join(_APP_DIR, "mcp_host.py")
    # Isolated Python reproduces the supervised script's missing app-package path.
    # run_path imports definitions only: no host, native frontend or listener starts.
    probe = "import runpy; ns=runpy.run_path(" + repr(host) + ", run_name='bootstrap_probe'); assert ns['card_tool_schema']('card.create')['additionalProperties'] is False"
    result = subprocess.run([sys.executable, "-I", "-c", probe], cwd=tmp_path,
                            capture_output=True, text=True, timeout=45)
    assert result.returncode == 0, result.stderr
