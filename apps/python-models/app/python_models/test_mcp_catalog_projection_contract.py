"""MCP catalog projection and authorization contract tests."""

import json
import os
import sys
from types import SimpleNamespace

import pytest

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
)
from app.python_models import tool_catalog
from app.python_models.mcp_contract_test_support import clear_live_provider_operations
from app.python_models.operation_definition import allowed_operation_keys
from mcp.types import Tool


def test_application_catalog_preserves_saved_card_schemas_without_provider_discovery(monkeypatch):
    import asyncio
    import jsonschema
    import mcp_host
    # This checks application schemas, not upstream process initialization.
    # The canonical catalog test supplies provider catalog fixtures.
    async def provider_catalog_fixture():
        return []

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "stdio")
    monkeypatch.setattr(mcp_auth, "OAUTH_ENFORCED", False)
    monkeypatch.setattr(mcp_auth, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(mcp_cbm_provider, "_cbm_tools", provider_catalog_fixture)
    monkeypatch.setattr(
        mcp_graphiti_provider, "_graphiti_tools", provider_catalog_fixture
    )

    async def check():
        tools = await mcp_catalog_runtime._materialize_complete_catalog()
        by_name = {tool.name: tool for tool in tools}
        assert "card.run_assistant_agent" not in by_name
        assert "card.run_agent" not in by_name
        assert by_name["run_mag_one"].input_schema["required"] == ["input"]
        assert set(by_name["run_mag_one"].input_schema["properties"]) == {
            "input", "dataAnchors",
        }
        assert by_name["run_mag_one"].input_schema["properties"]["dataAnchors"]["minItems"] == 0
        assert by_name["worldview.set_capability"].input_schema == {
            "type": "object",
            "properties": {
                "capabilityId": {
                    "type": "string",
                    "pattern": r"^[a-z0-9][a-z0-9._:-]{0,127}$",
                },
                "enabled": {"type": "boolean"},
                "reason": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1000,
                },
            },
            "required": ["capabilityId", "enabled", "reason"],
            "additionalProperties": False,
        }
        assert by_name["card.create"].input_schema["required"] == [
            "expectedRevision",
            "templateId",
            "title",
            "role",
            "prompt",
            "runtime",
            "model",
        ]
        assert by_name["card.create"].input_schema["additionalProperties"] is False
        assert set(by_name["card.create"].input_schema["properties"]) == {
            "expectedRevision", "templateId", "title",
            "role", "prompt", "runtime", "model", "tools", "skills",
            "toolsets", "mcpConnectionIds", "subagentType", "subagentModel",
            "openaiRuntime", "position",
        }
        runtime_schema = by_name["card.create"].input_schema["properties"]["runtime"]
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
        # Transport must not impose a removed runtime-specific creation rule.
        for binding in ({"kind": "hermes", "mode": "delegate"},
                        {"kind": "hermes", "mode": "delegate", "profile": "worker"}):
            jsonschema.validate(binding, runtime_schema)
        for binding in ({"kind": "hermes"}, {"kind": "hermes", "mode": ""},
                        {"kind": "hermes", "mode": "delegate", "override": True}):
            with pytest.raises(jsonschema.ValidationError):
                jsonschema.validate(binding, runtime_schema)
        update_properties = by_name["card.update_configuration"].input_schema[
            "properties"
        ]["updates"]["properties"]
        assert set(update_properties) == {
            "configuration", "prompt", "title", "script", "subsystems", "tools",
            "skills", "toolsets", "mcpConnectionIds", "modelKey", "provider",
            "providerModelId", "accessMode", "subagentType", "subagentModel", "openaiRuntime",
        }
        assert by_name["card.update_configuration"].input_schema["required"] == [
            "cardId", "expectedRevision", "expectedCardRevisionId", "updates",
        ]
        assert by_name["card.update_configuration"].input_schema[
            "properties"
        ]["updates"]["minProperties"] == 1
        assert "main.context" in by_name
        assert "agentgraph.inspect" in by_name
        assert {"engraphis_recall_context", "engraphis_get_memory", "engraphis_remember"}.issubset(by_name)
        assert not any(name.startswith("engraphis.") for name in by_name)
        assert all(
            tool.input_schema.get("additionalProperties") is False
            for name, tool in by_name.items()
            if not name.startswith(("cbm.", "graphiti."))
        )
        assert "worldsignals.package" not in by_name
        assert by_name
        assert len(tools) == len(by_name)
        for name in ("card.create", "card.update_configuration"):
            source = by_name[name].meta["liquidaitySource"]
            assert {"projectId", "deckId"} <= set(
                source["canonicalInputSchema"]["properties"]
            )
            assert source["serverInjectedArguments"] == ["deckId", "projectId"]
        expected = {
            item["canonicalId"]
            for item in tool_catalog.code_owned_tool_projection()
            if "external-mcp" in item["publications"]
        }
        assert set(by_name) == expected
        return {name: tool.model_dump() for name, tool in by_name.items()}

    catalog = asyncio.run(check())
    assert len(catalog) == len(set(catalog))

def test_only_externally_permitted_operations_are_in_the_mcp_catalog(monkeypatch):
    import asyncio
    import mcp_host

    monkeypatch.setattr(
        mcp_cbm_provider,
        "_cbm_tools",
        lambda: asyncio.sleep(0, result=[]),
    )
    monkeypatch.setattr(
        mcp_graphiti_provider,
        "_graphiti_tools",
        lambda: asyncio.sleep(0, result=[]),
    )
    tools = asyncio.run(mcp_catalog_runtime._materialize_complete_catalog())
    names = {tool.name for tool in tools}
    assert names == {
        item["canonicalId"]
        for item in tool_catalog.code_owned_tool_projection()
        if "external-mcp" in item["publications"]
    }
    assert "card.run_assistant_agent" not in names
    assert "card.run_agent" not in names
    assert "calculator" not in names
    assert "delegate_task" not in names
    assert len(tools) == len(names)

def test_saved_specialist_tools_are_card_runtime_only_write_operations():
    import mcp_host
    from app import application_operations

    definitions = {
        item.canonical_id: item
        for item in application_operations.application_operation_definitions()
    }
    expected_titles = {
        "thinkgraph.reason": "Reason with ThinkGraph",
        "knowgraph.research": "Research with KnowGraph",
    }
    for name, title in expected_titles.items():
        definition = definitions[name]
        assert definition.title == title
        assert definition.publishers == frozenset({"internal-plugin"})
        assert definition.access == "write"
        assert definition.grant_eligible is True
        assert set(definition.parameters_schema["properties"]) == {
            "request", "dataAnchors",
        }
        assert definition.parameters_schema["required"] == ["request"]
        assert definition.parameters_schema["properties"]["request"] == {
            "type": "string", "minLength": 1, "maxLength": 20000,
        }
        assert definition.dispatcher_context_arguments == frozenset({
            "projectId", "deckId", "conversationId", "_sourceCardId", "_sourceRunId",
            "_principalKind",
        })

    catalog = {
        item["canonicalId"]: item
        for item in tool_catalog.code_owned_tool_projection()
    }
    for name in expected_titles:
        assert catalog[name]["publications"] == ["card-runtime"]

def test_saved_specialist_dispatch_injects_exact_authenticated_card_scope(monkeypatch):
    import asyncio
    import json
    import mcp_host
    from app import application_operations

    calls = []

    async def bridge(payload):
        calls.append(payload)
        return {
            "ok": True,
            "status": "completed",
            "operation": payload["operation"],
            "targetCardId": "card_thinkgraph",
            "targetRunId": "req_target",
            "targetCardRevisionId": "revision-thinkgraph",
            "result": "grounded result",
        }

    monkeypatch.setattr(
        application_operations, "_saved_specialist_card_bridge", bridge,
    )
    monkeypatch.setattr(mcp_auth, "_authenticated_main_context", lambda: {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "req_source",
        "mainCardId": "builder",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "delegate",
        "principalKind": "card-runtime",
    })

    result = asyncio.run(mcp_host._dispatch_tool("thinkgraph.reason", {
        "request": "How did this design evolve?",
        "dataAnchors": [],
    }))

    assert result.is_error is False
    assert json.loads(result.content[0].text) == {
        "ok": True,
        "status": "completed",
        "operation": "thinkgraph.reason",
        "targetCardId": "card_thinkgraph",
        "targetRunId": "req_target",
        "targetCardRevisionId": "revision-thinkgraph",
        "result": "grounded result",
    }
    assert calls == [{
        "operation": "thinkgraph.reason",
        "request": "How did this design evolve?",
        "dataAnchors": [],
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "sourceCardId": "builder",
        "sourceRunId": "req_source",
    }]

    forged = asyncio.run(mcp_host._dispatch_tool("thinkgraph.reason", {
        "request": "forged",
        "projectId": "other-project",
    }))
    assert json.loads(forged[0].text) == {
        "ok": False,
        "error": "caller_identity_rejected: projectId",
    }

def test_saved_specialist_bridge_cancellation_closes_async_http(monkeypatch):
    import asyncio
    import httpx2
    from app import application_operations

    entered = asyncio.Event()
    closed = []

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            closed.append(True)

        async def post(self, *_args, **_kwargs):
            entered.set()
            await asyncio.Future()

    monkeypatch.setattr(httpx2, "AsyncClient", Client)
    monkeypatch.setenv("LIQUIDAITY_INTERNAL_MCP_SECRET", "s" * 32)

    async def scenario():
        task = asyncio.create_task(application_operations._saved_specialist_card_bridge({
            "operation": "thinkgraph.reason",
        }))
        await asyncio.wait_for(entered.wait(), timeout=1)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            return
        raise AssertionError("specialist bridge ignored cancellation")

    asyncio.run(scenario())
    assert closed == [True]

def test_stale_external_catalog_cannot_invoke_known_internal_only_operation(
    monkeypatch,
):
    import asyncio
    import mcp_host

    published = Tool(
        name="main.context",
        description="Published external operation.",
        inputSchema={"type": "object", "properties": {}},
    )
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", (published,))
    monkeypatch.setattr(mcp_auth, "OAUTH_ENFORCED", True)
    monkeypatch.setattr(
        mcp_catalog_runtime,
        "_CATALOG_COMPLETED_FAMILIES",
        ("liquidaity", "cbm", "graphiti"),
    )
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_UNAVAILABLE_FAMILIES", ())
    monkeypatch.setattr(mcp_auth, "_internal_mcp_principal", lambda: None)

    assert mcp_host._request_tool_is_allowed("main.context") is True
    assert mcp_host._request_tool_is_allowed("calculator") is False
    assert mcp_host._request_tool_is_allowed("not_a_real_tool") is True

    stale = asyncio.run(mcp_host.call_tool("calculator", {"expression": "1+1"}))
    assert stale.is_error is True
    assert json.loads(stale.content[0].text)["error"] == "tool_not_granted"

def test_complete_catalog_is_frozen_before_listing_and_preserves_provider_metadata(
    monkeypatch, clear_live_provider_operations,
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
    from app.python_models.tool_registry import (
        graphiti_operation_policy,
        operation_definitions,
        tool_access,
    )

    declarations = operation_definitions()
    base_expected_names = {
        item["canonicalId"]
        for item in tool_catalog.code_owned_tool_projection()
        if "external-mcp" in item["publications"]
    }
    expected_names = set(base_expected_names)

    def provider_tool(
        canonical_name, provider_tool_name, *, read_only, annotations_override=None,
    ):
        annotations = dict(annotations_override) if annotations_override is not None else {
            "destructiveHint": read_only is not True,
            "idempotentHint": read_only is True,
            "openWorldHint": False,
        }
        if read_only is not None:
            annotations["readOnlyHint"] = read_only
        return Tool.model_validate({
            "name": provider_tool_name,
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
            "annotations": annotations,
            "_meta": {"canonicalFixture": canonical_name},
        })

    by_namespace = {
        "cbm": [],
        "graphiti": [],
    }
    for declaration in declarations:
        namespace = declaration.namespace
        if namespace not in by_namespace:
            continue
        canonical_name = declaration.canonical_id
        provider_tool_name = canonical_name.split(".", 1)[1]
        expected_names.add(canonical_name)
        by_namespace[namespace].append(provider_tool(
            canonical_name,
            provider_tool_name,
            read_only=tool_access(canonical_name) == "read",
        ))
    by_namespace["cbm"] = [
        provider_tool("cbm.search_graph", "search_graph", read_only=True),
        provider_tool("cbm.unfamiliar_current_tool", "unfamiliar_current_tool", read_only=None),
    ]
    expected_names.add("cbm.search_graph")
    for canonical_name in (
        "graphiti.add_memory",
        "graphiti.clear_graph",
        "graphiti.get_status",
        "graphiti.search_nodes",
    ):
        policy = graphiti_operation_policy(canonical_name)
        assert policy is not None
        by_namespace["graphiti"].append(provider_tool(
            canonical_name,
            canonical_name.split(".", 1)[1],
            read_only=policy["access"] == "read",
            annotations_override=policy["annotations"],
        ))
        if canonical_name in {"graphiti.add_memory", "graphiti.search_nodes"}:
            expected_names.add(canonical_name)

    async def cbm_tools():
        return by_namespace["cbm"]

    async def graphiti_tools():
        return by_namespace["graphiti"]

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_auth, "OAUTH_ENFORCED", True)
    monkeypatch.setattr(mcp_auth, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(mcp_auth, "_internal_mcp_principal", lambda: None)
    monkeypatch.setattr(mcp_cbm_provider, "_cbm_tools", cbm_tools)
    monkeypatch.setattr(mcp_graphiti_provider, "_graphiti_tools", graphiti_tools)

    canonical = asyncio.run(mcp_catalog_runtime._materialize_complete_catalog())
    canonical_by_name = {tool.name: tool for tool in canonical}
    assert set(canonical_by_name) == expected_names
    assert len(canonical) == len(canonical_by_name)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", tuple(canonical))
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "ready")
    for transport in ("streamable-http", "stdio"):
        monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", transport)
        for principal, expected in (
            (None, base_expected_names),
            ({"kind": "catalog-reader"}, expected_names),
            ({"kind": "materializer-read", "callerCardId": "builder",
              "grantedTools": ["cbm.search_graph"]}, {"cbm.search_graph"}),
            ({"kind": "materializer-read", "callerCardId": "card_knowgraph",
              "grantedTools": ["graphiti.search_nodes"]}, {"graphiti.search_nodes"}),
            ({"kind": "materializer-read", "callerCardId": "card_main_chat",
              "grantedTools": []}, set()),
            ({"kind": "materializer-read", "callerCardId": "card_thinkgraph",
              "grantedTools": ["engraphis_recall_context"]}, set()),
            ({"kind": "card-runtime", "grantedTools": [], "presentedTools": []}, set()),
            ({"kind": "card-runtime", "grantedTools": ["cbm.search_graph"],
              "presentedTools": []}, set()),
            ({"kind": "card-runtime", "grantedTools": ["cbm.search_graph"],
              "presentedTools": ["cbm.search_graph"]}, {"cbm.search_graph"}),
            ({"kind": "card-runtime", "grantedTools": ["graphiti.search_nodes"],
              "presentedTools": ["graphiti.search_nodes"]}, {"graphiti.search_nodes"}),
        ):
            monkeypatch.setattr(mcp_auth, "_internal_mcp_principal", lambda: principal)
            listed = asyncio.run(mcp_catalog_runtime.list_tools())
            assert {tool.name for tool in listed} == expected
    for tool in canonical:
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        assert payload["_meta"]["securitySchemes"] == [{
            "type": "oauth2", "scopes": [mcp_auth.AUTH0_REQUIRED_SCOPE],
        }]
    for namespace, fixtures in by_namespace.items():
        for fixture in fixtures:
            canonical_name = f"{namespace}.{fixture.name}"
            if canonical_name not in canonical_by_name:
                continue
            tool = canonical_by_name[canonical_name]
            assert tool.title == fixture.title
            assert tool.description == fixture.description
            assert tool.output_schema == fixture.output_schema
            expected_annotations = fixture.annotations.model_dump(by_alias=True, exclude_none=True)
            if namespace == "cbm" and "readOnlyHint" not in expected_annotations:
                expected_annotations["readOnlyHint"] = False
            assert tool.annotations.model_dump(by_alias=True, exclude_none=True) == expected_annotations
            assert tool.meta["canonicalFixture"] == fixture.meta["canonicalFixture"]
            assert tool.input_schema["properties"]["probe"] == {"type": "string"}
    assert "web_search" not in canonical_by_name
    assert canonical_by_name["cbm.search_graph"].meta["liquidaityAccess"] == "read"
    assert "cbm.unfamiliar_current_tool" not in canonical_by_name
    assert "graphiti.clear_graph" not in canonical_by_name
    assert "graphiti.get_status" not in canonical_by_name
    assert "questionEvidence" not in canonical_by_name[
        "graphiti.add_memory"
    ].input_schema["properties"]
    assert {
        "cbm.search_graph",
        "engraphis_recall_context",
        "engraphis_get_memory",
        "engraphis_remember",
        "graphiti.add_memory",
        "graphiti.search_nodes",
    }.issubset({tool.name for tool in canonical})

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

    assert mcp_catalog_runtime._catalog_identity([original])[0] == 1
    assert mcp_catalog_runtime._catalog_identity([original])[1] != mcp_catalog_runtime._catalog_identity([changed])[1]

def test_mag_one_tools_use_direct_transient_input_contract():
    import mcp_host
    from app.python_models.tool_registry import operation_definition

    assert allowed_operation_keys(operation_definition("run_mag_one")) == {
        "projectId", "deckId", "input", "conversationId", "dataAnchors",
    }
