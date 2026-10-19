"""Behavioral MCP provider-publication and request-dispatch contracts."""

# Entity: MCP Host
# Relationship: This file verifies provider requests retain protocol-declared schemas, arguments, error state, timeout behavior, and recoverable dispatch through the MCP host.
# Entity: Tool Catalog
# Relationship: This file verifies canonical catalog publication, exact access annotations, hidden-operation refusal, and saved Card grant enforcement.
# Entity: Authentication
# Relationship: This file verifies external Main entry and materializer-read requests receive only their authenticated Project and tool authority.
# Entity: KnowGraph
# Relationship: This file verifies the KnowGraph MCP projection accepts one two-sided cited Know and dispatches it to the exact Graphiti Entity operation.

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


def test_entity_know_projection_queues_one_two_sided_episode(
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
        name="add_memory_to_entity",
        description="Generic exact Entity episode.",
        inputSchema={
            "type": "object",
            "properties": {
                "entity_name": {"type": "string"},
                "name": {"type": "string"},
                "episode_body": {"type": "string"},
                "source_description": {"type": "string"},
                "source": {"type": "string"},
                "group_id": {"type": "string"},
                "update_communities": {"type": "boolean"},
            },
            "required": [
                "entity_name", "name", "episode_body", "source_description",
            ],
        },
    )
    projected = mcp_provider_operations.namespace_provider_tools(
        "graphiti", [provider_tool],
    )[0]
    assert projected.input_schema["required"] == [
        "entity_name", "name", "idea", "counterIdea",
    ]
    assert "episode_body" not in projected.input_schema["properties"]
    assert "source_description" not in projected.input_schema["properties"]

    mcp_provider_operations.register_graphiti_catalog([projected])
    definition = operation_definition("graphiti.add_memory_to_entity")
    assert definition is not None
    result = asyncio.run(definition.handler(
        _authenticatedProjectId="project-one",
        entity_name="Rocket Lab",
        name="Launch demand",
        idea={
            "body": "Demand is supported.",
            "citations": [{"url": "https://example.test/for"}],
        },
        counterIdea={
            "body": "Execution risk remains.",
            "citations": [{"url": "https://example.test/against"}],
        },
        update_communities=True,
    ))

    assert result["episode_uuid"] == "episode-one"
    assert calls[0][0] == "add_memory_to_entity"
    arguments = calls[0][1]
    assert arguments["group_id"] == "liquidaity-project-one"
    assert arguments["source"] == "json"
    assert json.loads(arguments["episode_body"]) == {
        "schemaVersion": "know.v1",
        "idea": {
            "body": "Demand is supported.",
            "citations": [{"url": "https://example.test/for"}],
        },
        "counterIdea": {
            "body": "Execution risk remains.",
            "citations": [{"url": "https://example.test/against"}],
        },
    }
    assert json.loads(arguments["source_description"]) == [
        "https://example.test/for", "https://example.test/against",
    ]
    assert "idea" not in arguments
    assert "counterIdea" not in arguments
