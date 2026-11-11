"""Behavioral MCP provider-publication and request-dispatch contracts."""

# Entity: MCP Host
# Relationship: This file verifies provider requests retain protocol-declared schemas, arguments, error state, timeout behavior, and recoverable dispatch through the MCP host.
# Entity: Tool Catalog
# Relationship: This file verifies canonical catalog publication, exact access annotations, hidden-operation refusal, and saved Card grant enforcement.
# Entity: Authentication
# Relationship: This file verifies external Main entry and graph-read requests receive only their authenticated Project and tool authority.
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
        "worldview.read",
        "worldview.action",
        "documents.search",
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
        "kind": "graph-read",
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


def test_card_runtime_bearer_requires_exact_saved_card_context(monkeypatch):
    import jwt

    secret = "s" * 32
    verifier = mcp_auth.McpTokenVerifier()
    monkeypatch.setattr(mcp_auth, "INTERNAL_MCP_SECRET", secret)
    context = {
        "projectId": "project-one",
        "deckId": "deck_builder",
        "conversationId": "project-one",
        "callerCardId": "trading",
        "grantedTools": ["forecast_market_bars"],
        "mainEntryAuthorized": False,
    }
    monkeypatch.setattr(
        mcp_auth, "_resolve_internal_card_context_sync", lambda principal: context,
    )
    principal = {
        "kind": "card-runtime", "ownerUserId": "owner-one",
        "projectId": "project-one", "deckId": "deck_builder", "profile": "trading",
    }
    now = int(__import__("time").time())
    token = jwt.encode({
        "iss": mcp_auth.INTERNAL_MCP_ISSUER,
        "aud": mcp_auth.INTERNAL_MCP_AUDIENCE,
        "sub": "card-runtime",
        "iat": now,
        "scope": "liquidaity.main",
        "principal": principal,
    }, secret, algorithm="HS256")

    profile_context = mcp_auth.set_requested_card_profile("trading")
    try:
        verified = verifier._verify_sync(token)
    finally:
        mcp_auth.reset_requested_card_profile(profile_context)
    assert verified is not None
    assert verified.claims["internal"] == principal
    assert verified.claims["project"] == context
    monkeypatch.setattr(
        mcp_auth, "_resolve_internal_card_context_sync", lambda principal: None,
    )
    profile_context = mcp_auth.set_requested_card_profile("trading")
    try:
        assert verifier._verify_sync(token) is None
    finally:
        mcp_auth.reset_requested_card_profile(profile_context)


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
        "kind": "graph-read",
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


def test_authenticated_operations_do_not_expose_an_unpublished_main_entry(monkeypatch):
    context = {
        "projectId": "project-one",
        "deckId": "deck_builder",
        "conversationId": "project-one",
        "callerCardId": "card_main_chat",
        "grantedTools": ["canvas.inspect"],
        "mainEntryAuthorized": True,
    }
    monkeypatch.setattr(mcp_auth, "access_token_available", lambda: True)
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: None)
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: context)
    monkeypatch.setattr(
        mcp_catalog_runtime,
        "published_mcp_tool_names",
        lambda: frozenset({"canvas.inspect"}),
    )

    assert mcp_request_dispatch.request_tool_is_allowed("canvas.inspect") is True
    import asyncio
    unknown = asyncio.run(mcp_request_dispatch.dispatch_tool("main.context", {}))
    assert unknown.is_error is True
    assert unknown.structured_content["failureCode"] == "tool_not_granted"

    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: None)
    assert mcp_request_dispatch.request_tool_is_allowed("canvas.inspect") is False


def test_authenticated_catalog_keeps_external_main_entries_outside_saved_grants(monkeypatch):
    context = {
        "projectId": "project-one",
        "deckId": "deck_builder",
        "conversationId": "project-one",
        "callerCardId": "card_main_chat",
        "grantedTools": ["canvas.inspect"],
        "mainEntryAuthorized": True,
    }
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: None)
    monkeypatch.setattr(mcp_auth, "access_token_available", lambda: True)
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: context)
    tools = [
        Tool(name=name, inputSchema={"type": "object", "properties": {}})
        for name in ("main.context", "canvas.inspect", "card.create")
    ]

    assert [tool.name for tool in mcp_catalog_projection.catalog_for_request(tools)] == [
        "main.context", "canvas.inspect",
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


def test_know_publication_year_is_not_promoted_to_a_runtime_timestamp():
    import asyncio

    arguments = {"entity_name": "HAR-RV", "citation": {"publishedAt": "2009"}}
    result = asyncio.run(mcp_provider_operations._entity_know_provider_arguments(
        arguments, "cc1deb71-d059-46b8-975d-e2473dacf132",
    ))
    assert result == arguments
    assert "reference_time" not in result


def test_relationship_removal_uses_graphitis_dictionary_response(monkeypatch):
    import asyncio

    calls = []
    async def delete_entity_edge(**arguments):
        calls.append(arguments)
        # Graphiti's SuccessResponse is a TypedDict, not a Pydantic object.
        return {"message": "Entity edge removed"}
    async def notify(project, payload):
        calls.append((project, payload["status"]))
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_MODULE", SimpleNamespace(
        delete_entity_edge=delete_entity_edge,
    ))
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: {"projectId": "project-1"})
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: {})
    monkeypatch.setattr(mcp_graphiti_provider, "_notify_know_change", notify)
    result = asyncio.run(mcp_graphiti_provider.call_graphiti_tool(
        "delete_entity_edge", {"uuid": "edge-one", "group_id": "liquidaity-project-1"},
    ))
    wire = result.model_dump(by_alias=True)
    assert wire["isError"] is False
    assert wire["structuredContent"]["result"]["relationship_uuid"] == "edge-one"
    assert calls == [{"uuid": "edge-one", "group_id": "liquidaity-project-1"}, ("project-1", "completed")]


def test_duplicate_relationship_submission_retries_incomplete_settlement(monkeypatch):
    import asyncio

    settled = []
    know = SimpleNamespace(uuid="same-know", content_hash="same-hash", group_id="liquidaity-project-1",
                           entity_uuid="same-owner", entity_edges=["existing-edge"])
    async def add_know(**arguments):
        return SimpleNamespace(know=know, entity=SimpleNamespace(name="Study"),
                               created=False, entity_created=False, relationships=[])
    async def settle(project, uuid):
        settled.append((project, uuid))
        return {"status": "success", "classified_fact_count": 1}
    async def notify(project, payload):
        pass
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_MODULE", SimpleNamespace(
        graphiti_client=SimpleNamespace(add_know=add_know), _know_result=lambda value: {"uuid": value.uuid},
    ))
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: {"projectId": "project-1"})
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: {})
    monkeypatch.setattr(mcp_graphiti_provider, "_notify_know_change", notify)
    monkeypatch.setattr(mcp_graphiti_provider, "_settle_research_relationships", settle)
    result = asyncio.run(mcp_graphiti_provider.call_graphiti_tool("add_know", {
        "group_id": "liquidaity-project-1",
        "relationships": [{"target_entity_name": "Product", "fact": "Study uses product"}],
    })).model_dump(by_alias=True)
    assert settled == [("project-1", "same-know")]
    assert result["isError"] is False
    assert result["structuredContent"]["result"]["created"] is False
    assert result["structuredContent"]["result"]["relationships"] == ["existing-edge"]


def test_research_completion_recovers_saved_results_without_another_know_write(monkeypatch):
    import asyncio
    from engraphis.service import MemoryService
    from app.python_models import engraphis_operations as operations
    from app import backend_operation_transport
    svc = MemoryService.create(":memory:", extractor="none", graph_extractor="none")
    monkeypatch.setattr(operations, "get_service", lambda _project: svc)
    principal = {"id": "test-owner", "email": "test-owner@example.test"}
    monkeypatch.setattr(operations, "project_principal", lambda _project: principal)
    monkeypatch.setattr(backend_operation_transport, "notify_graph_changed", lambda *_args: None)
    results = []
    async def ready(): pass
    async def read_results(project, origin, version):
        assert (project, origin, version) == ("trading", mid, 1)
        return results
    monkeypatch.setattr(mcp_graphiti_provider, "ensure_graphiti_service", ready)
    monkeypatch.setattr(mcp_graphiti_provider, "research_result_knows", read_results)
    try:
        from engraphis.service_context import bind_service
        with bind_service(svc, principal=principal):
            mid = svc.add_thinks([{"entity_name": "Signal", "content": "An input might help.",
                                  "researchRequested": True, "researchQuestion": "Does it add held-out information?"}],
                                 workspace="trading")["thinks"][0]["id"]
        async def run():
            claimed = await operations.research_request_operation(projectId="trading", action="claim", think_id=mid, request_version=1)
            assert claimed["claimed"]
            with pytest.raises(ValueError, match="No sourced Know"):
                await operations.research_request_operation(projectId="trading", action="complete", think_id=mid, request_version=1)
            with bind_service(svc, principal=principal):
                assert svc.read_think_research(mid, workspace="trading")["researchState"] == "working"
            # A provider write has committed, but no completion acknowledgment did.
            # The adapter's verified-result read is the only provider operation here.
            results.append(SimpleNamespace(uuid="saved-provider-know"))
            done = await operations.research_request_operation(projectId="trading", action="complete", think_id=mid, request_version=1)
            assert done["researchedByKnowIds"] == ["saved-provider-know"]
            assert done["researchRequested"] is False and done["researchState"] == "researched"
            repeated = await operations.research_request_operation(projectId="trading", action="complete", think_id=mid, request_version=1)
            assert repeated["changed"] is False
            with pytest.raises(ValueError):
                await operations.research_request_operation(projectId="other", action="complete", think_id=mid, request_version=1)
        asyncio.run(run())
    finally:
        svc.close()


def test_know_tool_does_not_offer_a_model_authored_timestamp():
    schema = {"inputSchema": {
        "properties": {"reference_time": {"type": "string"}, "citation": {"type": "object"}},
        "required": ["citation", "reference_time"],
    }}
    mcp_provider_operations._inline_graphiti_know_schema(schema)
    assert schema["inputSchema"] == {
        "properties": {"citation": {"type": "object"}}, "required": ["citation"],
    }


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
    assert "update_communities" not in projected.input_schema["properties"]
    assert "reference_time" not in projected.input_schema["properties"]

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
    assert "reference_time" not in arguments
    assert "episode_body" not in arguments
    assert "source_description" not in arguments


@pytest.mark.parametrize("relationships", [
    {"target_entity_name": "Target", "fact": "Owner uses target"},
    [{"target_entity_uuid": "old-id", "fact": "Owner uses target"}],
    [{"target_entity_name": "Target"}],
])
def test_named_relationship_argument_error_is_actionable_before_any_write(monkeypatch, relationships):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from app.application_tool_error import ApplicationToolError
    write = AsyncMock()
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_MODULE",
                        SimpleNamespace(graphiti_client=SimpleNamespace(add_know=write)))
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: {"projectId": "project-one"})
    with pytest.raises(ApplicationToolError, match="relationships must|target_entity_name and fact"):
        asyncio.run(mcp_graphiti_provider.call_graphiti_tool("add_know", {
            "group_id": "liquidaity-project-one", "relationships": relationships,
        }))
    write.assert_not_awaited()


@pytest.mark.parametrize("has_relationship", [False, True])
def test_knowgraph_atomic_know_write_finishes_required_jev_before_return(
    monkeypatch, has_relationship,
):
    import asyncio
    from datetime import datetime, timezone
    from unittest.mock import AsyncMock

    know_payload = {
        "uuid": "know-one",
        "name": "Bounded finding",
        "entity_uuid": "entity-one",
        "observation": "One source-backed observation.",
        "interpretation": "One bounded interpretation.",
        "citation": {"url": "https://example.test/source"},
        "content_hash": "a" * 64,
        "group_id": "liquidaity-project-one",
    }
    know = SimpleNamespace(
        uuid="know-one",
        entity_uuid="entity-one",
        entity_edges=["edge-one"] if has_relationship else [],
        content_hash="a" * 64,
        group_id="liquidaity-project-one",
    )
    graphiti_client = SimpleNamespace(
        add_know=AsyncMock(return_value=SimpleNamespace(
            know=know,
            created=True,
            entity_created=False,
            entity=SimpleNamespace(uuid="entity-one", name="Rocket Lab"),
            relationships=[SimpleNamespace(uuid="edge-one")] if has_relationship else [],
        )),
        get_know=AsyncMock(return_value=know),
    )
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_MODULE", SimpleNamespace(
        graphiti_client=graphiti_client,
        graphiti_service=SimpleNamespace(
            entity_types={}, edge_types={}, edge_type_map={},
        ),
        _know_result=lambda _know: dict(know_payload),
    ))
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: {
        "kind": "card-runtime", "profile": "knowgraph",
    })
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: {
        "projectId": "project-one",
    })
    settle = AsyncMock(return_value={"status": "current"})
    from app import backend_operation_transport
    from app.python_models import engraphis
    from unittest.mock import Mock
    notification = Mock()
    monkeypatch.setattr(backend_operation_transport, "notify_graph_changed", notification)
    monkeypatch.setattr(engraphis, "project_principal", lambda _: {"id": "owner-one"})
    monkeypatch.setattr(
        mcp_graphiti_provider,
        "_settle_research_relationships",
        settle,
    )

    write_started = datetime.now(timezone.utc)
    result = asyncio.run(mcp_graphiti_provider.call_graphiti_tool("add_know", {
        "group_id": "liquidaity-project-one",
        "reference_time": "2009",
        "entity_name": "Rocket Lab",
        "name": "Bounded finding",
        "observation": "One source-backed observation.",
        "interpretation": "One bounded interpretation.",
        **({"relationships": [{"target_entity_name": "Customer", "fact": "Provides launch services to Customer."}]} if has_relationship else {}),
        "citation": {
            "url": "https://example.test/source",
            "title": "Source",
            "publisher": "Publisher",
            "evidence": "One exact source-backed evidence passage.",
            "publishedAt": "2026-10-19",
        },
    }))
    write_finished = datetime.now(timezone.utc)

    assert isinstance(result, CallToolResult)
    assert result.is_error is False
    assert result.structured_content["result"]["status"] == "completed"
    graphiti_client.add_know.assert_awaited_once()
    assert set(graphiti_client.add_know.await_args.kwargs) == {
        "entity_name", "name", "observation", "interpretation", "citation", "group_id", "reference_time",
    } | ({"relationships"} if has_relationship else set())
    assert write_started <= graphiti_client.add_know.await_args.kwargs["reference_time"] <= write_finished
    receipt = result.structured_content["result"]
    assert all(key in receipt for key in (
        "message", "know_uuid", "content_hash", "group_id", "entity_name", "entity_uuid",
    ))
    if has_relationship:
        settle.assert_awaited_once_with("project-one", "know-one")
    else:
        settle.assert_not_awaited()
    notification.assert_called_once_with("project-one", "owner-one", "knowgraph")
    assert receipt["know"] == know_payload
    graphiti_client.get_know.assert_not_awaited()


@pytest.mark.parametrize("operation", ["get_know", "search_knows"])
@pytest.mark.parametrize("profile", ["builder", "knowgraph"])
def test_saved_cards_use_the_existing_graphiti_tool_contract(monkeypatch, operation, profile):
    import asyncio
    from unittest.mock import AsyncMock
    result = CallToolResult(content=[TextContent(type="text", text="provider result")], isError=False)
    provider = AsyncMock(return_value=result)
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_MODULE", SimpleNamespace(
        mcp=SimpleNamespace(call_tool=provider)))
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: {
        "kind": "card-runtime", "profile": profile, "projectId": "project-one"})
    arguments = {"group_id": "liquidaity-project-one", "uuid": "know-one"}
    assert asyncio.run(mcp_graphiti_provider.call_graphiti_tool(operation, arguments)) is result
    provider.assert_awaited_once_with(operation, arguments)
    assert arguments == {"group_id": "liquidaity-project-one", "uuid": "know-one"}


def test_entity_read_exposes_exact_think_research_without_creating_a_know_owner(monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock
    from engraphis.service import MemoryService
    from app.python_models import engraphis
    svc = MemoryService.create(":memory:", extractor="none", graph_extractor="none")
    monkeypatch.setattr(engraphis, "get_service", lambda _project: svc)
    client = SimpleNamespace(driver=SimpleNamespace(execute_query=AsyncMock(return_value=([], None, None))),
                             get_entity_knows=AsyncMock())
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_MODULE", SimpleNamespace(graphiti_client=client))
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: {"projectId": "trading"})
    try:
        mid = svc.add_thinks([{"entity_name": "Signal", "content": "This signal needs evidence.",
                              "researchRequested": True, "researchQuestion": "Does it predict the target?"}],
                             workspace="trading")["thinks"][0]["id"]
        svc.add_thinks([{"entity_name": "Signal", "content": "Other Project reasoning.",
                         "researchRequested": True, "researchQuestion": "A different question?"}], workspace="other")
        result = asyncio.run(mcp_graphiti_provider.call_graphiti_tool("get_entity_knows", {
            "group_id": "liquidaity-trading", "entity_name": "Signal"})).structured_content["result"]
        assert result["knows"] == [] and result["entity_uuid"] is None
        assert [item["memory_id"] for item in result["thinks"]] == [mid]
        assert [item["thinkId"] for item in result["researchRequests"]] == [mid]
        assert result["researchRequests"][0]["researchState"] == "research"
        assert "claimToken" not in json.dumps(result)
        client.get_entity_knows.assert_not_awaited()
        client.driver.execute_query.assert_awaited_once()
        assert "MATCH" in client.driver.execute_query.await_args.args[0]
        with pytest.raises(PermissionError):
            asyncio.run(mcp_graphiti_provider.call_graphiti_tool("get_entity_knows", {
                "group_id": "liquidaity-other", "entity_name": "Signal"}))
    finally:
        svc.close()


def test_research_know_write_refuses_an_unclaimed_or_stale_request(monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock
    from engraphis.service import MemoryService
    from app.python_models import engraphis_operations as operations
    from engraphis.service_context import bind_service
    svc = MemoryService.create(":memory:", extractor="none", graph_extractor="none")
    principal = {"id": "test-owner", "email": "test-owner@example.test"}
    monkeypatch.setattr(operations, "get_service", lambda _project: svc)
    monkeypatch.setattr(operations, "project_principal", lambda _project: principal)
    client = SimpleNamespace(add_know=AsyncMock())
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_MODULE", SimpleNamespace(graphiti_client=client))
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: {"projectId": "trading"})
    try:
        with bind_service(svc, principal=principal):
            mid = svc.add_thinks([{"entity_name": "Signal", "content": "An input might help.",
                "researchRequested": True, "researchQuestion": "Does it predict the target?"}],
                workspace="trading")["thinks"][0]["id"]
        args = {"group_id": "liquidaity-trading", "research_origin_think_id": mid,
                "research_request_version": 1, "research_claim_token": "not-a-claim"}
        with pytest.raises(ValueError, match="research claim is not current"):
            asyncio.run(mcp_graphiti_provider.call_graphiti_tool("add_know", args))
        with bind_service(svc, principal=principal):
            claim = svc.claim_think_research(mid, workspace="trading", version=1)
        args.update(research_claim_token=claim["claimToken"], research_request_version=2)
        with pytest.raises(ValueError, match="research claim is not current"):
            asyncio.run(mcp_graphiti_provider.call_graphiti_tool("add_know", args))
        client.add_know.assert_not_awaited()
    finally:
        svc.close()




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
