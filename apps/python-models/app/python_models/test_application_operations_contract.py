"""MCP application-operation and provider-configuration contract tests."""

import json
import os
import sys

import pytest
from app import mag_one_operation, mcp_request_dispatch, mcp_transport

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.python_models.provider_config import ensure_env_loaded

ensure_env_loaded()

from mcp.types import TextContent

from app import (
    mcp_auth,
    mcp_catalog_runtime,
    mcp_cbm_provider,
    mcp_graphiti_provider,
)
from app.python_models import engraphis_operations
from app.python_models.test_mcp_contract_support import (
    tool_result_wire_text,
)
from mcp.types import Tool


def test_public_mcp_identity_is_liquidaity():
    import mcp_host

    options = mcp_host.server.create_initialization_options()
    assert options.server_name == "LiquidAIty"
    assert options.server_version == mcp_host._MCP_IMPLEMENTATION_VERSION
    assert options.server_version == "0.21.5"
    assert "source-" not in options.server_version
    assert options.instructions == (
        "Connect ChatGPT to LiquidAIty projects, saved agent cards, CodeGraph, "
        "ThinkGraph, KnowGraph, and supported agent runtimes. "
        "Start with main.context to resolve the authenticated Main conversation and project scope. "
        "Use the currently published tool names and schemas; preserve returned provider IDs and provenance. "
        "Saved Cards own their configuration and granted capabilities. "
        "An accepted operation is not proof of completion; use its returned status and evidence."
    )

def test_catalog_health_reports_resolved_graphiti_packages(monkeypatch):
    import mcp_host

    versions = {"graphiti-core": "0.30.2", "mcp-server": "1.1.0"}
    monkeypatch.setattr(
        mcp_graphiti_provider.importlib_metadata,
        "version",
        lambda distribution: versions[distribution],
    )

    assert mcp_graphiti_provider.graphiti_runtime_versions() == {
        "core": "0.30.2",
        "mcp": "1.1.0",
    }
    assert mcp_catalog_runtime.catalog_diagnostics()["graphitiVersions"] == {
        "core": "0.30.2",
        "mcp": "1.1.0",
    }

def test_canonical_catalog_publishes_engraphis_schemas_with_owned_scope(monkeypatch):
    import asyncio
    import jsonschema
    import mcp_host
    names = {
        "engraphis_recall_context",
        "engraphis_get_memory",
        "engraphis_remember",
        "engraphis_discover_actions",
        "engraphis_execute_read",
        "engraphis_execute_action",
    }
    monkeypatch.setattr(mcp_auth, "OAUTH_ENFORCED", True)
    monkeypatch.setattr(
        mcp_cbm_provider,
        "cbm_tools",
        lambda: asyncio.sleep(0, result=[]),
    )
    monkeypatch.setattr(
        mcp_graphiti_provider,
        "graphiti_tools",
        lambda: asyncio.sleep(0, result=[]),
    )
    catalog = asyncio.run(mcp_catalog_runtime._materialize_complete_catalog())
    tools = [tool for tool in catalog if tool.name.startswith("engraphis_")]
    assert {tool.name for tool in tools} == names
    assert "main.context" in {tool.name for tool in catalog}
    assert "card.run_assistant_agent" not in {tool.name for tool in catalog}
    assert "card.run_agent" not in {tool.name for tool in catalog}
    assert len(tools) == len(names)
    assert not any(tool.name.startswith("constellation.") for tool in catalog)
    for tool in tools:
        schema = tool.input_schema
        jsonschema.Draft202012Validator.check_schema(schema)
        assert schema["additionalProperties"] is False
        assert not ({"projectId", "workspace"} & schema["properties"].keys())
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        assert payload["_meta"]["securitySchemes"] == [{
            "type": "oauth2", "scopes": [mcp_auth.AUTH0_REQUIRED_SCOPE],
        }]
    schemas = {tool.name: tool.input_schema for tool in tools}
    jsonschema.validate({"query": "spacecraft component suppliers", "k": 6,
                         "token_budget": 600}, schemas["engraphis_recall_context"])
    jsonschema.validate({"memory_id": "memory-id"}, schemas["engraphis_get_memory"])
    jsonschema.validate({"content": "A tentative assistant suggestion",
                         "importance": 0.3},
                        schemas["engraphis_remember"])
    assert {
        "engraphis_update_memory",
        "engraphis_conflict_review",
        "engraphis_session",
    }.isdisjoint(schemas)

def test_semantic_write_can_finish_after_the_ordinary_tool_deadline(monkeypatch):
    import asyncio
    import mcp_host

    operation = "engraphis_remember"
    completed = []

    async def dispatch(name, arguments):
        await asyncio.sleep(0.03)
        completed.append(name)
        return [TextContent(type="text", text=json.dumps({"ok": True, "id": "memory-question"}))]

    monkeypatch.setattr(mcp_request_dispatch, "dispatch_tool", dispatch)
    monkeypatch.setattr(mcp_request_dispatch, "request_tool_is_allowed", lambda name: True)
    monkeypatch.setattr(mcp_auth, "authenticated_main_context", lambda: None)
    monkeypatch.setattr(mcp_request_dispatch, "MCP_CALL_TIMEOUT_SECONDS", 0.005)

    result = asyncio.run(mcp_request_dispatch.call_tool(operation, {}))
    assert not getattr(result, "isError", False)
    assert completed == [operation]
    # Ordinary reads keep their short deadline; this is not a global increase.
    result = asyncio.run(mcp_request_dispatch.call_tool("engraphis_recall_context", {}))
    assert result.is_error
    assert completed == [operation]

def test_engraphis_rejection_reaches_agent_without_success_or_retry(monkeypatch):
    import asyncio
    import mcp_host

    requests = []
    context = {"projectId": "project-one", "mainCardId": "thinkgraph"}

    async def reject(project_id, name, arguments):
        requests.append({
            "projectId": project_id, "operation": name, "arguments": arguments,
        })
        return {"ok": False, "error": "thinkgraph_project_id_invalid"}

    monkeypatch.setattr(engraphis_operations, "invoke_tool", reject)
    monkeypatch.setattr(mcp_auth, "authenticated_main_context", lambda: context)
    monkeypatch.setattr(
        mcp_request_dispatch,
        "request_tool_is_allowed",
        lambda name, definition=None: True,
    )
    monkeypatch.setattr(mcp_request_dispatch, "enforce_tool_caller", lambda *args, **kwargs: None)
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", (
        Tool(name="engraphis_remember", inputSchema={"type": "object"}),
    ))
    result = asyncio.run(mcp_request_dispatch.call_tool("engraphis_remember", {
        "content": "A retained thought",
    }))
    assert result.is_error is True
    assert json.loads(result.content[0].text) == {
        "ok": False, "error": "thinkgraph_project_id_invalid",
    }
    assert len(result.content) == 1
    assert "executionReceipt" not in tool_result_wire_text(result)
    assert len(requests) == 1
    assert requests[0]["projectId"] == "project-one"

def test_engraphis_smart_result_preserves_python_rails_payload(monkeypatch):
    import asyncio
    import mcp_host
    from app.python_models import engraphis_operations
    payload = {"id": "mem-one", "content": "Synthetic memory"}
    monkeypatch.setattr(mcp_auth, "authenticated_main_context",
        lambda: {"projectId": "project-one", "mainCardId": "thinkgraph"})
    monkeypatch.setattr(mcp_request_dispatch, "enforce_tool_caller", lambda *a, **k: None)
    async def invoke(*_args):
        return payload
    monkeypatch.setattr(engraphis_operations, "invoke_tool", invoke)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "ready")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", (
        Tool(name="engraphis_get_memory", inputSchema={"type": "object"}),
    ))
    result = asyncio.run(mcp_request_dispatch.dispatch_tool(
        "engraphis_get_memory", {"memory_id": "mem-one"},
    ))
    assert result.structured_content == payload
    assert result.is_error is False

def test_canvas_wire_catalog_preserves_supported_fields_without_provider_discovery(monkeypatch):
    import asyncio
    import jsonschema
    import mcp_host

    monkeypatch.setattr(mcp_auth, 'authenticated_main_context', lambda: None)
    monkeypatch.setattr(mcp_auth, 'OAUTH_ENFORCED', False)
    monkeypatch.setattr(
        mcp_cbm_provider,
        "cbm_tools",
        lambda: asyncio.sleep(0, result=[]),
    )
    monkeypatch.setattr(
        mcp_graphiti_provider,
        "graphiti_tools",
        lambda: asyncio.sleep(0, result=[]),
    )
    tools = asyncio.run(mcp_catalog_runtime._materialize_complete_catalog())
    schema = next(tool.input_schema for tool in tools if tool.name == 'canvas.upsert_wire')
    wire_tool = next(tool for tool in tools if tool.name == 'canvas.upsert_wire')
    assert 'main.context' in {tool.name for tool in tools}
    for edge_type in ('flow', 'magentic_option'):
        value = {'op': 'upsert', 'wire': {
            'id': 'wire', 'source': 'a', 'target': 'b', 'edgeType': edge_type,
            'sourceHandle': None, 'targetHandle': 'port', 'enabled': False,
            'label': 'Existing presentation',
        }}
        jsonschema.validate(value, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({'projectId': 'p', 'deckId': 'd', **value}, schema)
    assert schema['properties']['wire']['properties']['edgeType']['enum'] == [
        'flow', 'magentic_option',
    ]
    assert {'projectId', 'deckId'} <= set(
        wire_tool.meta['liquidaitySource']['canonicalInputSchema']['properties']
    )
    assert wire_tool.meta['liquidaitySource']['serverInjectedArguments'] == [
        'deckId', 'projectId',
    ]

def test_caller_enforcement_reads_explicit_registry_permissions():
    import mcp_host

    allowed = {
        "_callerCardId": "card-main",
        "_callerRuntimeKind": "hermes",
        "_callerRuntimeMode": "main",
    }
    assert mcp_request_dispatch.enforce_tool_caller("run_mag_one", allowed) is None
    denied = {
        "_callerCardId": "card-hermes",
        "_callerRuntimeKind": "hermes",
        "_callerRuntimeMode": "delegate",
    }
    assert mcp_request_dispatch.enforce_tool_caller("run_mag_one", denied) == (
        "tool_caller_not_authorized: run_mag_one requires hermes/main"
    )
    assert mcp_request_dispatch.enforce_tool_caller(
        "worldview.set_capability", {
            "_callerCardId": "card-main",
            "_callerRuntimeKind": "hermes",
            "_callerRuntimeMode": "main",
        },
    ) is None
    assert mcp_request_dispatch.enforce_tool_caller(
        "worldview.set_capability", {
            "_callerCardId": "card-hermes",
            "_callerRuntimeKind": "hermes",
            "_callerRuntimeMode": "delegate",
        },
    ) == (
        "tool_caller_not_authorized: worldview.set_capability requires hermes/main"
    )
    unrestricted: dict[str, str] = {}
    assert mcp_request_dispatch.enforce_tool_caller("cbm.search_graph", unrestricted) is None

def test_worldview_main_write_uses_only_server_owned_project_scope(monkeypatch):
    import asyncio
    import mcp_host
    from app.python_models import project_worldview

    calls = []

    def save(project_id, capability_id, enabled, reason):
        calls.append((project_id, capability_id, enabled, reason))
        return {
            "schemaVersion": "project-worldview.v1",
            "projectId": project_id,
            "capability": {
                "capabilityId": capability_id,
                "enabled": enabled,
                "controlledBy": "main",
                "mainReason": reason,
                "updatedAt": "2026-09-27T00:00:00+00:00",
            },
        }

    monkeypatch.setattr(
        project_worldview, "set_main_project_worldview_capability", save,
    )
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: None)
    monkeypatch.setattr(mcp_auth, "authenticated_main_context", lambda: {
        "projectId": "project-current",
        "deckId": "deck-current",
        "conversationId": "conversation-current",
        "parentRunId": "run-current",
        "mainCardId": "card-main",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "main",
    })

    result = asyncio.run(mcp_request_dispatch.dispatch_tool("worldview.set_capability", {
        "capabilityId": "weather",
        "enabled": False,
        "reason": "The current Project does not need weather data.",
    }))

    assert calls == [(
        "project-current",
        "weather",
        False,
        "The current Project does not need weather data.",
    )]
    assert json.loads(result[0].text)["projectId"] == "project-current"

    forged = asyncio.run(mcp_request_dispatch.dispatch_tool("worldview.set_capability", {
        "projectId": "project-foreign",
        "capabilityId": "weather",
        "enabled": True,
        "reason": "Attempted scope widening.",
    }))
    assert json.loads(forged[0].text) == {
        "ok": False,
        "error": "caller_identity_rejected: projectId",
    }

    monkeypatch.setattr(mcp_auth, "authenticated_main_context", lambda: {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "conversation-1",
        "parentRunId": "req_source",
        "mainCardId": "card_main_chat",
    })
    external_main = asyncio.run(mcp_request_dispatch.dispatch_tool("knowgraph.research", {
        "request": "not a Card-runtime call",
    }))
    assert external_main.is_error is True
    assert json.loads(external_main.content[0].text) == {
        "ok": False,
        "error": "authenticated_card_context_required",
    }
    assert len(calls) == 1

def test_worldview_main_write_rejects_delegate_card_before_storage(monkeypatch):
    import asyncio
    import mcp_host
    from app.python_models import project_worldview

    calls = []
    monkeypatch.setattr(
        project_worldview,
        "set_main_project_worldview_capability",
        lambda *args: calls.append(args),
    )
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: None)
    monkeypatch.setattr(mcp_auth, "authenticated_main_context", lambda: {
        "projectId": "project-current",
        "mainCardId": "card-delegate",
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": "delegate",
    })

    result = asyncio.run(mcp_request_dispatch.dispatch_tool("worldview.set_capability", {
        "capabilityId": "weather",
        "enabled": True,
        "reason": "Relevant.",
    }))

    assert json.loads(result[0].text) == {
        "ok": False,
        "error": (
            "tool_caller_not_authorized: worldview.set_capability "
            "requires hermes/main"
        ),
    }
    assert calls == []

def test_worldview_main_write_requires_authenticated_context(monkeypatch):
    import asyncio
    import mcp_host

    monkeypatch.setattr(mcp_auth, "authenticated_main_context", lambda: None)
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: None)

    result = asyncio.run(mcp_request_dispatch.dispatch_tool("worldview.set_capability", {
        "projectId": "caller-supplied-project",
        "_callerCardId": "caller-supplied-main",
        "_callerRuntimeKind": "hermes",
        "_callerRuntimeMode": "main",
        "capabilityId": "weather",
        "enabled": True,
        "reason": "Attempted unauthenticated write.",
    }))

    assert json.loads(result[0].text) == {
        "ok": False,
        "error": (
            "caller_identity_rejected: "
            "_callerCardId,_callerRuntimeKind,_callerRuntimeMode,projectId"
        ),
    }

def test_worldview_action_catalog_offers_only_spatial_actions():
    from app.application_operation_catalog import application_operation_definitions

    action = next(
        definition
        for definition in application_operation_definitions()
        if definition.canonical_id == "worldview.action"
    )
    assert action.parameters_schema["properties"]["name"]["enum"] == [
        "get_current_view_state",
        "get_entity_context",
        "zoom_to_globe",
        "track_entity",
        "stop_tracking",
        "focus_satellites",
        "set_layer_visibility",
    ]
    assert "explicit request in the current user turn" in action.description
    assert "at most 50 exact NORAD IDs" in action.description
    assert "[] clears transient agent focus" in action.description
    main_choice = next(
        definition
        for definition in application_operation_definitions()
        if definition.canonical_id == "worldview.set_capability"
    )
    assert "current user turn explicitly asks" in main_choice.description

def test_application_and_engraphis_definitions_use_real_non_host_handlers():
    import inspect
    from app.application_operation_catalog import application_operation_definitions
    from app.python_models import engraphis_operations

    definitions = [
        *application_operation_definitions(),
        *engraphis_operations.operation_definitions(),
    ]
    assert definitions
    for definition in definitions:
        assert definition.handler.__module__ != "app.mcp_host"
        assert "dispatch_tool" not in inspect.getsource(definition.handler)
        assert definition.dispatcher_owner != "app.mcp_request_dispatch.dispatch_tool"


def test_application_operation_catalog_preserves_order_and_literal_dispatcher_owners():
    from app.application_operation_catalog import application_operation_definitions

    definitions = application_operation_definitions()
    assert [definition.canonical_id for definition in definitions] == [
        "main.context",
        "worldview.set_capability",
        "worldview.action",
        "agentgraph.inspect",
        "run_mag_one",
        "thinkgraph.reason",
        "knowgraph.research",
        "canvas.inspect",
        "card.create",
        "card.update_configuration",
        "canvas.upsert_wire",
    ]
    assert {
        definition.canonical_id: definition.dispatcher_owner
        for definition in definitions
    } == {
        "main.context": "app.main_worldview_operations.main_context",
        "worldview.set_capability": (
            "app.main_worldview_operations.worldview_set_capability"
        ),
        "worldview.action": "app.main_worldview_operations.worldview_action",
        "agentgraph.inspect": (
            "app.application_operation_handlers.agentgraph_inspect"
        ),
        "run_mag_one": "app.mag_one_operation.run_mag_one",
        "thinkgraph.reason": (
            "app.saved_graph_specialist_operations.thinkgraph_reason"
        ),
        "knowgraph.research": (
            "app.saved_graph_specialist_operations.knowgraph_research"
        ),
        "canvas.inspect": (
            "app.application_operation_handlers.canvas_inspect_operation"
        ),
        "card.create": (
            "app.application_operation_handlers.card_create_operation"
        ),
        "card.update_configuration": (
            "app.application_operation_handlers.card_update_configuration_operation"
        ),
        "canvas.upsert_wire": (
            "app.application_operation_handlers.canvas_upsert_wire_operation"
        ),
    }

def test_worldsignals_package_dispatch_uses_authenticated_card_run_scope(monkeypatch):
    import asyncio
    import mcp_host
    from app.python_models import worldsignals_tool_operations

    captured = {}

    class _Package:
        def model_dump(self, **_kwargs):
            return {
                "schemaVersion": "signal.package.v1",
                "packageId": "signal-package:test",
                "candidates": [],
            }

    def collect(**kwargs):
        captured.update(kwargs)
        return _Package()

    monkeypatch.setattr(
        worldsignals_tool_operations,
        "collect_worldsignals_signal_package",
        collect,
    )
    monkeypatch.setattr(mcp_auth, "authenticated_main_context", lambda: {
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
    result = asyncio.run(mcp_request_dispatch.dispatch_tool("worldsignals.package", {
        "command": "get_summary",
        "reason": "Inspect one bounded source result.",
        "limit": 4,
    }))

    payload = json.loads(result.content[0].text)
    assert payload["packageId"] == "signal-package:test"
    assert captured["project_id"] == "project-1"
    assert captured["deck_id"] == "deck-1"
    assert captured["requesting_card_id"] == "card-signal-analyst"
    assert captured["requesting_run_id"] == "run-1"
    assert captured["producer_card_id"] == "card-signal-analyst"
    assert captured["producer_run_id"] == "run-1"

def test_worldsignals_package_rejects_model_supplied_scope(monkeypatch):
    import asyncio
    import mcp_host

    monkeypatch.setattr(mcp_auth, "authenticated_main_context", lambda: {
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
    result = asyncio.run(mcp_request_dispatch.dispatch_tool("worldsignals.package", {
        "command": "get_summary",
        "reason": "Inspect one bounded source result.",
        "projectId": "other-project",
    }))

    assert json.loads(result[0].text)["error"] == "caller_identity_rejected: projectId"

def test_graphiti_uses_knowgraph_openrouter_embedding_configuration(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "router-key")
    monkeypatch.setenv("OPENROUTER_OPENAI_BASE_URL", "https://router.example/v1")
    monkeypatch.setenv("KNOWGRAPH_OPENROUTER_EMBEDDING_MODEL", "openai/test-embedder")
    monkeypatch.setenv("KNOWGRAPH_OPENROUTER_EMBEDDING_DIM", "1024")
    monkeypatch.setenv("NEO4J_DATABASE", "knowgraph")
    monkeypatch.delenv("GRAPHITI_EMBEDDER_MODEL", raising=False)

    config = mcp_graphiti_provider._graphiti_config()

    assert config.database.providers.neo4j.database == "knowgraph"
    assert config.embedder.provider == "openai"
    assert config.embedder.model == "openai/test-embedder"
    assert config.embedder.dimensions == 1024
    assert config.embedder.providers.openai.api_key == "router-key"
    assert config.embedder.providers.openai.api_url == "https://router.example/v1"

def test_graphiti_preserves_explicit_embedder_model_override(monkeypatch):
    monkeypatch.setenv("GRAPHITI_EMBEDDER_MODEL", "local/embeddinggemma")
    monkeypatch.setenv("KNOWGRAPH_OPENROUTER_EMBEDDING_MODEL", "openai/ignored")

    assert mcp_graphiti_provider._graphiti_config().embedder.model == "local/embeddinggemma"

def test_graphiti_is_optional_when_provider_credentials_are_absent(monkeypatch):
    import asyncio
    import mcp_host

    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_MODULE", None)
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_TOOLS", None)
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_UNAVAILABLE", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_COMPLETED_FAMILIES", ())
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_UNAVAILABLE_FAMILIES", ())
    provider_initialization = []
    monkeypatch.setattr(
        mcp_graphiti_provider,
        "_graphiti_config",
        lambda: provider_initialization.append("called"),
    )

    assert asyncio.run(mcp_graphiti_provider.graphiti_tools()) == []
    assert provider_initialization == []
    assert mcp_graphiti_provider._GRAPHITI_UNAVAILABLE == {
        "ok": False,
        "failureCode": "optional_capability_unavailable",
        "errorCategory": "DEPENDENCY_UNAVAILABLE",
        "retryable": False,
        "dependency": "graphiti",
        "detail": "Graphiti provider credentials are not configured.",
    }
    assert asyncio.run(
        mcp_catalog_runtime._materialize_requested_provider_catalog(("graphiti",))
    ) == []
    assert mcp_catalog_runtime._CATALOG_UNAVAILABLE_FAMILIES == ("graphiti",)

def test_graphiti_initialization_failure_never_leaks_secrets_or_kills_mcp(monkeypatch):
    import asyncio
    import builtins
    import mcp_host

    secret = "sk-sensitive-provider-value"
    monkeypatch.setenv("OPENROUTER_API_KEY", secret)
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_MODULE", None)
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_TOOLS", None)
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_UNAVAILABLE", None)
    real_import = builtins.__import__

    def failing_import(name, *args, **kwargs):
        if name == "graphiti_mcp_server":
            raise RuntimeError(f"provider rejected {secret}")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", failing_import)

    assert asyncio.run(mcp_graphiti_provider.graphiti_tools()) == []
    failure_text = json.dumps(mcp_graphiti_provider._GRAPHITI_UNAVAILABLE)
    assert secret not in failure_text
    assert "RuntimeError" in failure_text

    later = asyncio.run(mcp_request_dispatch.call_tool("main.context", {}))
    assert later.is_error is True
    later_payload = json.loads(later.content[0].text)
    assert later_payload["error"] == "main_context_unavailable"
    assert secret not in json.dumps(later_payload)

def test_graphiti_catalog_discovery_does_not_open_provider_connections(monkeypatch):
    import asyncio
    import sys
    # The installed Graphiti package owns a top-level `utils` package. Other
    # focused suites may import an unrelated module with that name first, so
    # isolate this dependency import without changing application behavior.
    for module_name in list(sys.modules):
        if module_name == "utils" or module_name.startswith("utils."):
            monkeypatch.delitem(sys.modules, module_name, raising=False)
    import graphiti_mcp_server as graphiti_provider

    monkeypatch.setenv("OPENROUTER_API_KEY", "configured")
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_MODULE", None)
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_TOOLS", None)
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_UNAVAILABLE", None)
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_SERVICE_READY", False)
    monkeypatch.setattr(
        graphiti_provider,
        "GraphitiService",
        lambda *_args, **_kwargs: pytest.fail("catalog opened Graphiti providers"),
    )

    tools = asyncio.run(mcp_graphiti_provider.graphiti_tools())

    assert tools
    assert mcp_graphiti_provider._GRAPHITI_SERVICE_READY is False


def test_mag_one_invocation_waits_and_records_progress_before_terminal_result(monkeypatch):
    observations = iter([
        {
            "ok": True,
            "hermesRootId": "root-one",
            "hermesRunId": "attempt-one",
            "hermesStatus": "running",
            "state": "running",
            "hermesTasks": [
                {"taskId": "root-one", "status": "running"},
                {"taskId": "worker-one", "status": "running"},
            ],
        },
        {
            "ok": True,
            "hermesRootId": "root-one",
            "hermesRunId": "attempt-two",
            "hermesStatus": "done",
            "state": "completed",
            "finalResult": "Exact Hermes synthesis.",
            "hermesTasks": [
                {"taskId": "root-one", "status": "done"},
                {"taskId": "worker-one", "status": "done"},
            ],
        },
    ])
    progress: list[dict] = []
    monkeypatch.setattr(
        "app.python_models.magnetic_taskgraph_readback.read_magnetic_taskgraph",
        lambda _payload: next(observations),
    )
    monkeypatch.setattr(
        "app.python_models.card_run_execution.update_run_progress",
        lambda payload: progress.append(payload) or {
            "ok": True,
            "runId": payload["runId"],
            "hermesRootId": payload["hermesRootId"],
            "updated": True,
        },
    )
    monkeypatch.setattr(mag_one_operation.time, "sleep", lambda _seconds: None)

    result, metrics = mag_one_operation._wait_for_completion(
        "run-one", "root-one", timeout_seconds=10, poll_seconds=0.01,
    )

    assert result["state"] == "completed"
    assert metrics == {"tasksCompleted": 2, "tasksTotal": 2, "activeWorkers": 0}
    assert progress == [{
        "runId": "run-one",
        "hermesRootId": "root-one",
        "hermesRunId": "attempt-one",
        "hermesStatus": "running",
        "tasksCompleted": 0,
        "tasksTotal": 2,
        "activeWorkers": 1,
    }]


def test_mag_one_completion_timeout_keeps_the_outer_run_open(monkeypatch):
    monkeypatch.setattr(
        "app.python_models.magnetic_taskgraph_readback.read_magnetic_taskgraph",
        lambda _payload: {
            "ok": True,
            "hermesRootId": "root-one",
            "hermesRunId": "attempt-one",
            "hermesStatus": "running",
            "state": "running",
            "hermesTasks": [{"taskId": "root-one", "status": "running"}],
        },
    )
    monkeypatch.setattr(
        "app.python_models.card_run_execution.update_run_progress",
        lambda payload: {
            "ok": True,
            "runId": payload["runId"],
            "hermesRootId": payload["hermesRootId"],
            "updated": True,
        },
    )

    result, _metrics = mag_one_operation._wait_for_completion(
        "run-one", "root-one", timeout_seconds=0,
    )

    assert result == {
        "ok": False,
        "hermesRootId": "root-one",
        "hermesRunId": "attempt-one",
        "hermesStatus": "running",
        "state": "running",
        "hermesTasks": [{"taskId": "root-one", "status": "running"}],
        "runId": "run-one",
        "completionPending": True,
        "outerRunSettled": False,
        "error": "magnetic_taskgraph_completion_timeout",
    }


def test_mag_one_terminal_settlement_uses_the_exact_root_and_attempt(monkeypatch):
    captured: list[dict] = []
    monkeypatch.setattr(
        "app.python_models.card_run_settlement.finish_run",
        lambda payload: captured.append(payload) or {
            "ok": True,
            "runId": payload["runId"],
            "state": payload["state"],
        },
    )
    terminal = {
        "ok": True,
        "hermesRootId": "root-one",
        "hermesRunId": "attempt-final",
        "hermesStatus": "done",
        "state": "completed",
        "configuredProvider": "openai-codex",
        "configuredProviderApiMode": "codex_app_server",
        "finalResult": "Exact Hermes synthesis.",
    }

    result = mag_one_operation._settle_terminal_result(
        "run-one",
        terminal,
        {"tasksCompleted": 2, "tasksTotal": 2, "activeWorkers": 0},
    )

    assert result == {
        **terminal,
        "runId": "run-one",
        "outerRunSettled": True,
    }
    assert captured == [{
        "runId": "run-one",
        "state": "completed",
        "finalResult": "Exact Hermes synthesis.",
        "effectiveProvider": "openai-codex",
        "providerApiMode": "codex_app_server",
        "providerThreadRef": "root-one",
        "providerTurnRef": "attempt-final",
        "hermesStatus": "done",
        "tasksCompleted": 2,
        "tasksTotal": 2,
        "activeWorkers": 0,
    }]
