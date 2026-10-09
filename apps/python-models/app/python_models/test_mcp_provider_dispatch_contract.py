"""Behavioral MCP provider-publication and request-dispatch contracts."""

import json
import os
import sys
from types import SimpleNamespace

import pytest
from app import mcp_request_dispatch, mcp_transport
from mcp.types import TextContent

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
from app.python_models.test_mcp_contract_support import clear_live_provider_operations
from mcp.types import Tool


def test_catalog_preserves_provider_annotations_and_adds_only_source_identity():
    import mcp_host

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
    import mcp_host

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
    import mcp_host
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
        assert json.loads(direct[0].text) == {
            "ok": False,
            "error": f"unknown_tool: {hidden_name}",
        }

@pytest.mark.parametrize("name,expected_access", [
    ("engraphis_recall_context", "write"),
    ("engraphis_get_memory", "read"),
])
def test_operation_access_requires_exact_canonical_annotations(name, expected_access):
    import mcp_host
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
    import mcp_host

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
        "kind": "card-runtime",
        "grantedTools": ["graphiti.add_memory"],
        "presentedTools": [],
    }
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: principal)
    assert mcp_request_dispatch.request_tool_is_allowed("engraphis_remember") is False
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: principal)
    assert mcp_request_dispatch.request_tool_is_allowed("cbm.search_graph") is False
    principal["grantedTools"].append("cbm.search_graph")
    assert mcp_request_dispatch.request_tool_is_allowed("cbm.search_graph") is False
    principal["presentedTools"].extend(["cbm.search_graph", "graphiti.add_memory"])
    assert mcp_request_dispatch.request_tool_is_allowed("cbm.search_graph") is True
    assert mcp_request_dispatch.request_tool_is_allowed("graphiti.add_memory") is True
    assert mcp_request_dispatch.request_tool_is_allowed("graphiti.clear_graph") is False

def test_cbm_dispatch_preserves_provider_arguments_schema_and_description(monkeypatch):
    import asyncio
    import mcp_host

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

def test_graphiti_timeout_cancels_work_and_later_dispatch_recovers(monkeypatch):
    import asyncio
    import mcp_host

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
    import mcp_host

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
