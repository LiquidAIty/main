"""Behavioral MCP provider-publication and request-dispatch contracts."""

# Entity: MCP Host
# Relationship: This file verifies provider requests retain protocol-declared schemas, arguments, error state, timeout behavior, and recoverable dispatch through the MCP host.
# Entity: Tool Catalog
# Relationship: This file verifies canonical catalog publication, exact access annotations, hidden-operation refusal, and saved Card grant enforcement.
# Entity: Authentication
# Relationship: This file verifies external Main entry and materializer-read requests receive only their authenticated Project and tool authority.
# Entity: KnowGraph
# Relationship: This file verifies the KnowGraph MCP projection verifies one atomic sourced Know and dispatches it to the exact Graphiti Entity operation.

import json
from types import SimpleNamespace

import pytest
from app import mcp_request_dispatch, mcp_transport
from mcp.types import CallToolResult, TextContent, Tool

from app.python_models.provider_config import ensure_env_loaded

ensure_env_loaded()

from app import (
    mcp_auth,
    mcp_catalog_projection,
    mcp_catalog_runtime,
    mcp_cbm_provider,
    mcp_graphiti_provider,
    mcp_host,
    mcp_observability,
    mcp_provider_operations,
)
from app.python_models.test_mcp_contract_support import clear_live_provider_operations
from app.python_models.tool_catalog import code_owned_tool_projection
def test_saved_card_tools_share_one_authenticated_mcp_projection(monkeypatch):
    import asyncio

    tools = asyncio.run(mcp_catalog_projection.application_tools())
    names = {tool.name for tool in tools}
    expected = {
        descriptor["canonicalId"]
        for descriptor in code_owned_tool_projection()
        if set(descriptor["publications"]) & {"card-profile", "external-mcp"}
    }
    assert names == expected
    assert {
        "calculator",
        "get_market_snapshot",
        "worldsignals.capabilities",
        "worldsignals.package",
    }.issubset(names)
    assert all(
        tool.output_schema is None or tool.output_schema.get("type") == "object"
        for tool in tools
    )
    assert next(tool for tool in tools if tool.name == "calculator").output_schema is None
    authenticated = mcp_catalog_projection.bind_authenticated_catalog([
        mcp_provider_operations.bind_operation_access(tool) for tool in tools
    ])
    assert {tool.name for tool in authenticated} == expected

    principal = {
        "kind": "materializer-read",
        "projectId": "project-one",
        "deckId": "deck_builder",
        "callerCardId": "trading",
        "grantedTools": ["get_market_snapshot"],
    }
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: principal)
    visible = mcp_catalog_projection.catalog_for_request(tools)
    assert [tool.name for tool in visible] == ["get_market_snapshot"]


def test_card_runtime_uses_only_backend_resolved_saved_grants(monkeypatch):
    import asyncio

    tools = asyncio.run(mcp_catalog_projection.application_tools())
    context = {
        "projectId": "project-one",
        "deckId": "deck_builder",
        "conversationId": "project-one",
        "parentRunId": "run-one",
        "callerCardId": "trading",
        "grantedTools": ["forecast_market_bars", "trading.record_decision"],
        "mainEntryAuthorized": False,
    }
    monkeypatch.setattr(
        mcp_auth, "internal_mcp_principal", lambda: {"kind": "card-runtime"},
    )
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: context)
    monkeypatch.setattr(
        mcp_catalog_runtime,
        "published_mcp_tool_names",
        lambda: frozenset(tool.name for tool in tools),
    )

    assert [tool.name for tool in mcp_catalog_projection.catalog_for_request(tools)] == [
        "forecast_market_bars", "trading.record_decision",
    ]
    assert mcp_request_dispatch.request_tool_is_allowed("forecast_market_bars") is True
    assert mcp_request_dispatch.request_tool_is_allowed("trading.record_decision") is True
    assert mcp_request_dispatch.request_tool_is_allowed("trading.accept_assignment") is False


def test_card_runtime_bearer_requires_exact_active_backend_context(monkeypatch):
    import jwt

    secret = "s" * 32
    config = mcp_auth.OAuthConfig(
        resource_url="https://example.test/mcp",
        issuer_url="https://tenant.example/",
        audience="https://example.test/mcp",
        client_id="external-client",
        required_scope="liquidaity.main",
    )
    verifier = mcp_auth.Auth0TokenVerifier(config, SimpleNamespace())
    monkeypatch.setattr(mcp_auth, "INTERNAL_MCP_SECRET", secret)
    context = {
        "projectId": "project-one",
        "deckId": "deck_builder",
        "conversationId": "project-one",
        "parentRunId": "run-one",
        "callerCardId": "trading",
        "grantedTools": ["forecast_market_bars"],
        "mainEntryAuthorized": False,
    }
    monkeypatch.setattr(
        mcp_auth, "_resolve_internal_card_context_sync", lambda: context,
    )
    now = int(__import__("time").time())
    token = jwt.encode({
        "iss": mcp_auth.INTERNAL_MCP_ISSUER,
        "aud": mcp_auth.INTERNAL_MCP_AUDIENCE,
        "sub": "card-runtime",
        "iat": now,
        "exp": now + 300,
        "scope": "liquidaity.main",
        "principal": {"kind": "card-runtime"},
    }, secret, algorithm="HS256")

    verified = verifier._verify_sync(token)
    assert verified is not None
    assert verified.claims["internal"] == {"kind": "card-runtime"}
    assert verified.claims["project"] == context
    monkeypatch.setattr(
        mcp_auth, "_resolve_internal_card_context_sync", lambda: None,
    )
    assert verifier._verify_sync(token) is None


def test_catalog_preserves_provider_annotations_and_adds_only_source_identity():
    providerTool = Tool(
        name="search_graph",
        description="providerTool",
        inputSchema={"type": "object", "properties": {"project": {"type": "string"}}},
        annotations={
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
    )
    bound = mcp_provider_operations.namespace_provider_tools("cbm", [providerTool])[0]

    assert bound.name == "cbm.search_graph"
    assert bound.input_schema == providerTool.input_schema
    assert bound.annotations == providerTool.annotations
    assert bound.meta == {
        "liquidaitySource": {
            "sourceId": "cbm",
            "namespace": "cbm",
            "providerToolName": "search_graph",
            "connectionKind": "external-mcp",
        }
    }

def test_unfamiliar_cbm_tool_is_not_added_to_the_curated_card_catalog(
    clear_live_provider_operations,
):
    providerTool = Tool(
        name="future_provider_tool",
        inputSchema={
            "type": "object",
            "properties": {"providerTool": {"type": "string"}},
        },
    )
    namespaced = mcp_provider_operations.namespace_provider_tools("cbm", [providerTool])
    mcp_provider_operations.register_cbm_catalog(namespaced)
    assert namespaced == []
    from app.python_models.tool_registry import operation_definition
    assert operation_definition("cbm.future_provider_tool") is None

def test_hidden_provider_operations_cannot_be_guessed(monkeypatch):
    import asyncio
    from app.python_models import engraphis_operations

    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", (
        Tool(name="cbm.search_graph", inputSchema={"type": "object"}),
        Tool(name="graphiti.search_nodes", inputSchema={"type": "object"}),
    ))
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: None)

    async def forbidden(*_args, **_kwargs):
        raise AssertionError("hidden provider operation reached dispatch")

    async def forbidden_engraphis(*_args, **_kwargs):
        raise AssertionError("hidden Engraphis operation reached dispatch")

    monkeypatch.setattr(mcp_provider_operations, "call_cbm_operation", forbidden)
    monkeypatch.setattr(mcp_provider_operations, "call_graphiti_operation", forbidden)
    monkeypatch.setattr(engraphis_operations, "invoke_tool", forbidden_engraphis)

    for hidden_name in (
        "cbm.index_repository",
        "graphiti.clear_graph",
        "engraphis_update_memory",
    ):
        assert mcp_request_dispatch.request_tool_is_allowed(hidden_name) is False
        denied = asyncio.run(mcp_request_dispatch.call_tool(hidden_name, {}))
        assert denied.is_error is True
        assert "unknown_tool" in denied.content[0].text
        direct = asyncio.run(mcp_request_dispatch.dispatch_tool(hidden_name, {}))
        assert isinstance(direct, CallToolResult)
        assert direct.is_error is True
        assert json.loads(direct.content[0].text) == {
            "ok": False,
            "error": f"unknown_tool: {hidden_name}",
            "failureCode": "unknown_tool",
            "errorCategory": "NOT_FOUND",
            "retryable": False,
            "dependency": "mcp",
        }

@pytest.mark.parametrize("name,expected_access", [
    ("engraphis_recall_context", "write"),
    ("engraphis_get_memory", "read"),
])
def test_operation_access_requires_exact_canonical_annotations(name, expected_access):
    from app.python_models.tool_registry import operation_definition

    definition = operation_definition(name)
    assert definition is not None
    providerTool = Tool(name=name, inputSchema={"type": "object"},
                          annotations=definition.annotations)
    bound = mcp_provider_operations.bind_operation_access(providerTool)
    assert bound.annotations.model_dump(by_alias=True, exclude_none=True) == definition.annotations
    assert bound.meta["liquidaityAccess"] == expected_access
    mismatched = dict(definition.annotations)
    mismatched["readOnlyHint"] = not mismatched["readOnlyHint"]
    with pytest.raises(RuntimeError, match=f"mcp_tool_annotation_mismatch:{name}:readOnlyHint"):
        mcp_provider_operations.bind_operation_access(Tool(
            name=name, inputSchema={"type": "object"}, annotations=mismatched,
        ))

def test_ungranted_and_destructive_tools_are_not_callable(
    monkeypatch, clear_live_provider_operations,
):
    mcp_provider_operations.register_cbm_catalog(mcp_provider_operations.namespace_provider_tools("cbm", [
        Tool(
            name="search_graph",
            description="Search the current CBM graph.",
            inputSchema={"type": "object"},
            annotations={"readOnlyHint": True},
        ),
    ]))
    mcp_provider_operations.register_graphiti_catalog(mcp_provider_operations.namespace_provider_tools("graphiti", [
        Tool(
            name="add_memory",
            description="Add a Graphiti memory.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "episode_body": {"type": "string"},
                    "group_id": {"type": "string"},
                },
                "required": ["name", "episode_body"],
            },
        ),
    ]))
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", (
        Tool(name="cbm.search_graph", inputSchema={"type": "object"}),
        Tool(name="graphiti.add_memory", inputSchema={"type": "object"}),
    ))

    principal = {
        "kind": "materializer-read",
        "projectId": "project-one",
        "deckId": "deck_builder",
        "callerCardId": "builder",
        "grantedTools": ["graphiti.add_memory"],
    }
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: principal)
    assert mcp_request_dispatch.request_tool_is_allowed("engraphis_remember") is False
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: principal)
    assert mcp_request_dispatch.request_tool_is_allowed("cbm.search_graph") is False
    principal["grantedTools"].append("cbm.search_graph")
    assert mcp_request_dispatch.request_tool_is_allowed("cbm.search_graph") is True
    assert mcp_request_dispatch.request_tool_is_allowed("graphiti.add_memory") is False
    assert mcp_request_dispatch.request_tool_is_allowed("graphiti.clear_graph") is False


def test_external_main_entries_use_verified_project_binding_not_card_grants(monkeypatch):
    context = {
        "projectId": "project-one",
        "deckId": "deck_builder",
        "conversationId": "project-one",
        "parentRunId": "",
        "callerCardId": "card_main_chat",
        "grantedTools": ["canvas.inspect"],
        "mainEntryAuthorized": True,
    }
    monkeypatch.setattr(mcp_auth, "OAUTH_ENFORCED", True)
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: None)
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: context)
    monkeypatch.setattr(
        mcp_catalog_runtime,
        "published_mcp_tool_names",
        lambda: frozenset({"main.context", "main.submit", "canvas.inspect"}),
    )

    assert mcp_request_dispatch.request_tool_is_allowed("main.context") is True
    assert mcp_request_dispatch.request_tool_is_allowed("main.submit") is True
    assert mcp_request_dispatch.request_tool_is_allowed("canvas.inspect") is True

    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: None)
    assert mcp_request_dispatch.request_tool_is_allowed("main.context") is False
    assert mcp_request_dispatch.request_tool_is_allowed("main.submit") is False


def test_authenticated_catalog_keeps_external_main_entries_outside_saved_grants(monkeypatch):
    context = {
        "projectId": "project-one",
        "deckId": "deck_builder",
        "conversationId": "project-one",
        "parentRunId": "",
        "callerCardId": "card_main_chat",
        "grantedTools": ["canvas.inspect"],
        "mainEntryAuthorized": True,
    }
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: None)
    monkeypatch.setattr(mcp_auth, "access_token_available", lambda: True)
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: context)
    tools = [
        Tool(name=name, inputSchema={"type": "object", "properties": {}})
        for name in ("main.context", "main.submit", "canvas.inspect", "card.create")
    ]

    assert [tool.name for tool in mcp_catalog_projection.catalog_for_request(tools)] == [
        "main.context", "main.submit", "canvas.inspect",
    ]
    context["mainEntryAuthorized"] = False
    assert [tool.name for tool in mcp_catalog_projection.catalog_for_request(tools)] == [
        "canvas.inspect",
    ]

def test_cbm_dispatch_preserves_provider_arguments_schema_and_description(monkeypatch):
    import asyncio

    calls = []
    providerTool = Tool(name="search_graph", description="Provider search", inputSchema={
        "type": "object", "properties": {"format": {"type": "string", "enum": ["tree", "json"]}},
    })
    result = mcp_host.CallToolResult(content=[], structuredContent={"total": 0, "groups": []})
    monkeypatch.setattr(mcp_cbm_provider, "_CBM_TOOLS", (providerTool,))
    class CbmClient:
        async def call_tool(self, name, args, **_kwargs):
            calls.append((name, args))
            return result
    monkeypatch.setattr(mcp_cbm_provider, "_CBM_CLIENT", CbmClient())
    arguments = {"project": "canonical"}
    assert asyncio.run(mcp_provider_operations.call_cbm_operation("search_graph", arguments)) is result
    assert arguments == {"project": "canonical"}
    assert calls == [("search_graph", {"project": "canonical"})]
    asyncio.run(mcp_provider_operations.call_cbm_operation("search_graph", {**arguments, "format": "tree"}))
    assert calls[-1][1]["format"] == "tree"
    advertised = mcp_provider_operations.namespace_provider_tools("cbm", [providerTool])[0]
    assert advertised.input_schema == providerTool.input_schema
    assert advertised.description == providerTool.description
    assert advertised.title == "Search CodeGraph structure"


def test_provider_results_preserve_protocol_declared_error_state_without_parsing_text():
    error_shaped_text = TextContent(
        type="text",
        text=json.dumps({"ok": False, "error": "provider prose"}),
    )

    untyped = mcp_provider_operations._normalize_provider_tool_result([
        error_shaped_text,
    ])
    declared = CallToolResult(content=[error_shaped_text], isError=True)

    assert untyped.is_error is False
    assert untyped.content == [error_shaped_text]
    assert mcp_provider_operations._normalize_provider_tool_result(declared) is declared

    assert mcp_observability.typed_failure(
        RuntimeError("rate limit 429 database queue timeout"),
    )["failureCode"] == "provider_failure"
    assert mcp_observability.typed_failure(TimeoutError())["failureCode"] == "timeout"

def test_graphiti_timeout_cancels_work_and_later_dispatch_recovers(monkeypatch):
    import asyncio

    cancelled = False

    class ProviderMcp:
        async def call_tool(self, name, _arguments):
            nonlocal cancelled
            if name == "slow":
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    cancelled = True
                    raise
            return [TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(
        mcp_graphiti_provider, "_GRAPHITI_MODULE", SimpleNamespace(mcp=ProviderMcp())
    )
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_SERVICE_READY", True)
    monkeypatch.setattr(
        mcp_provider_operations, "_PROVIDER_TOOL_TIMEOUT_SECONDS", 0.01,
    )

    async def run():
        with pytest.raises(RuntimeError, match="graphiti_timeout:slow"):
            await mcp_provider_operations.call_graphiti_operation("slow", {})
        return await mcp_provider_operations.call_graphiti_operation("later", {})

    later = asyncio.run(run())
    assert cancelled is True
    assert json.loads(later.content[0].text)["ok"] is True

def test_graphiti_add_memory_dispatch_preserves_provider_arguments(monkeypatch):
    import asyncio

    calls = []

    class ProviderMcp:
        async def call_tool(self, name, arguments):
            calls.append((name, arguments))
            return [TextContent(type="text", text="queued")]

    monkeypatch.setattr(
        mcp_graphiti_provider, "_GRAPHITI_MODULE", SimpleNamespace(mcp=ProviderMcp())
    )
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_SERVICE_READY", True)
    arguments = {
        "name": "Bounded research packet",
        "episode_body": "Current primary-source evidence.",
        "source": "text",
    }

    result = asyncio.run(mcp_provider_operations.call_graphiti_operation("add_memory", arguments))

    assert result.content[0].text == "queued"
    assert calls == [("add_memory", arguments)]
    assert arguments == {
        "name": "Bounded research packet",
        "episode_body": "Current primary-source evidence.",
        "source": "text",
    }


def test_graphiti_know_projection_inlines_live_mcp_v2_definitions():
    payload = {
        "inputSchema": {
            "$defs": {
                "KnowCitation": {
                    "type": "object",
                    "properties": {"url": {"type": "string"}},
                    "required": ["url"],
                    "additionalProperties": False,
                },
                "KnowDirection": {
                    "type": "object",
                    "properties": {"relation": {"enum": ["supports"]}},
                    "required": ["relation"],
                    "additionalProperties": False,
                },
            },
            "type": "object",
            "properties": {
                "citation": {"$ref": "#/$defs/KnowCitation"},
                "direction": {
                    "anyOf": [
                        {"$ref": "#/$defs/KnowDirection"},
                        {"type": "null"},
                    ],
                },
            },
        },
    }

    mcp_provider_operations._inline_graphiti_know_schema(payload)

    schema = payload["inputSchema"]
    assert "$defs" not in schema
    assert schema["properties"]["citation"]["required"] == ["url"]
    assert schema["properties"]["direction"]["anyOf"][0]["required"] == [
        "relation",
    ]
    assert "$ref" not in json.dumps(schema)


def test_entity_know_dispatch_preserves_grounded_citation_and_typed_fields(
    monkeypatch, clear_live_provider_operations,
):
    import asyncio
    from mcp.types import Tool
    from app.python_models.tool_registry import operation_definition

    calls: list[tuple[str, dict]] = []

    async def call(name: str, arguments: dict):
        calls.append((name, arguments))
        return {"episode_uuid": "episode-one", "entity_uuid": "entity-one"}

    monkeypatch.setattr(mcp_provider_operations, "call_graphiti_operation", call)
    provider_tool = Tool(
        name="add_know",
        description="Add one first-class Know to one Entity.",
        inputSchema={
            "type": "object",
            "properties": {
                "entity_name": {"type": "string"},
                "entity_uuid": {"type": "string"},
                "name": {"type": "string"},
                "observation": {"type": "string"},
                "interpretation": {"type": "string"},
                "citation": {"type": "object"},
                "direction": {"type": "object"},
                "reference_time": {"type": "string"},
                "group_id": {"type": "string"},
                "update_communities": {"type": "boolean"},
            },
            "required": [
                "entity_name", "name", "observation", "interpretation", "citation",
            ],
            "additionalProperties": False,
        },
    )
    projected = mcp_provider_operations.namespace_provider_tools(
        "graphiti", [provider_tool],
    )[0]
    assert projected.input_schema == provider_tool.input_schema

    mcp_provider_operations.register_graphiti_catalog([projected])
    definition = operation_definition("graphiti.add_know")
    assert definition is not None
    result = asyncio.run(definition.handler(
        _authenticatedProjectId="project-one",
        entity_name="Rocket Lab",
        name="Launch demand",
        observation="Rocket Lab reported a source-backed demand result.",
        interpretation="The result informs demand but does not remove execution risk.",
        citation={
            "url": "https://example.test/result",
            "title": "Rocket Lab result",
            "publisher": "Rocket Lab",
            "evidence": "Rocket Lab reported the exact source-backed demand result.",
            "publishedAt": "2026-10-19",
        },
        direction={
            "proposition": "Rocket Lab can compound launch revenue.",
            "relation": "supports",
        },
        update_communities=True,
    ))

    assert result["episode_uuid"] == "episode-one"
    assert calls[0][0] == "add_know"
    arguments = calls[0][1]
    assert arguments["group_id"] == "liquidaity-project-one"
    assert arguments["observation"] == "Rocket Lab reported a source-backed demand result."
    assert arguments["interpretation"] == (
        "The result informs demand but does not remove execution risk."
    )
    assert arguments["direction"]["relation"] == "supports"
    assert arguments["citation"] == {
        "url": "https://example.test/result",
        "title": "Rocket Lab result",
        "publisher": "Rocket Lab",
        "evidence": "Rocket Lab reported the exact source-backed demand result.",
        "publishedAt": "2026-10-19",
    }
    assert arguments["reference_time"] == "2026-10-19"
    assert "episode_body" not in arguments
    assert "source_description" not in arguments


def test_exact_get_know_readback_is_correlated_to_the_authenticated_card_run(
    monkeypatch, clear_live_provider_operations,
):
    import asyncio
    from mcp.types import CallToolResult, TextContent, Tool
    from app.python_models import card_run_graph_references

    provider_result = CallToolResult(
        content=[TextContent(type="text", text="found")],
        structuredContent={"result": {"know": {
            "uuid": "know-one",
            "entity_uuid": "entity-one",
            "group_id": "liquidaity-project-one",
            "content_hash": "a" * 64,
        }}},
        isError=False,
    )
    async def call_graphiti(*_args, **_kwargs):
        return provider_result

    monkeypatch.setattr(
        mcp_provider_operations,
        "call_graphiti_operation",
        call_graphiti,
    )
    provider_tool = Tool(
        name="get_know",
        description="Read one exact Know.",
        inputSchema={
            "type": "object",
            "properties": {
                "uuid": {"type": "string"},
                "group_id": {"type": "string"},
            },
            "required": ["uuid"],
            "additionalProperties": False,
        },
    )
    mcp_provider_operations.register_graphiti_catalog(
        mcp_provider_operations.namespace_provider_tools("graphiti", [provider_tool])
    )
    context = {
        "projectId": "project-one",
        "deckId": "deck_builder",
        "conversationId": "conversation-one",
        "parentRunId": "run-one",
        "callerCardId": "card_knowgraph",
        "grantedTools": ["graphiti.get_know"],
        "mainEntryAuthorized": False,
    }
    monkeypatch.setattr(
        mcp_auth, "internal_mcp_principal", lambda: {"kind": "card-runtime"},
    )
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: context)
    monkeypatch.setattr(
        mcp_catalog_runtime,
        "published_mcp_tool_names",
        lambda: frozenset({"graphiti.get_know"}),
    )
    recorded = []
    monkeypatch.setattr(
        card_run_graph_references,
        "record_graphiti_know_readback",
        lambda **kwargs: recorded.append(kwargs),
    )

    result = asyncio.run(mcp_request_dispatch.dispatch_tool(
        "graphiti.get_know", {"uuid": "know-one"},
    ))

    assert result is provider_result
    assert recorded == [{
        "result": provider_result,
        "run_id": "run-one",
        "project_id": "project-one",
        "card_id": "card_knowgraph",
    }]


def test_entity_know_dispatch_leaves_idempotence_to_graphiti_core(
    monkeypatch, clear_live_provider_operations,
):
    import asyncio
    from mcp.types import Tool
    from app.python_models.tool_registry import operation_definition

    calls: list[tuple[str, dict]] = []
    async def call(name: str, arguments: dict):
        calls.append((name, arguments))
        return {"message": "accepted"}
    monkeypatch.setattr(mcp_provider_operations, "call_graphiti_operation", call)
    provider_tool = Tool(
        name="add_know",
        inputSchema={
            "type": "object",
            "properties": {
                "entity_name": {"type": "string"},
                "name": {"type": "string"},
                "observation": {"type": "string"},
                "interpretation": {"type": "string"},
                "citation": {"type": "object"},
                "group_id": {"type": "string"},
            },
            "required": [
                "entity_name", "name", "observation", "interpretation", "citation",
            ],
        },
    )
    projected = mcp_provider_operations.namespace_provider_tools(
        "graphiti", [provider_tool],
    )[0]
    mcp_provider_operations.register_graphiti_catalog([projected])
    definition = operation_definition("graphiti.add_know")
    assert definition is not None

    arguments = {
        "_authenticatedProjectId": "project-one",
        "entity_name": "Rocket Lab",
        "name": "Repeated source",
        "observation": "One exact observation.",
        "interpretation": "One bounded interpretation.",
        "citation": {
            "url": "https://example.test/result",
            "title": "Rocket Lab result",
            "publisher": "Rocket Lab",
            "evidence": "Rocket Lab reported the exact source-backed demand result.",
        },
    }
    asyncio.run(definition.handler(**arguments))
    asyncio.run(definition.handler(**arguments))

    assert [name for name, _arguments in calls] == ["add_know", "add_know"]
    assert calls[0][1] == calls[1][1]
    assert "uuid" not in calls[0][1]
