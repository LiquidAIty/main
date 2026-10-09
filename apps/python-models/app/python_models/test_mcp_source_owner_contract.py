"""MCP source-owner and removed-path residue contract tests."""

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
    mcp_observability,
    mcp_provider_operations,
)
from app.python_models.mcp_contract_test_support import clear_live_provider_operations
from app.python_models.operation_definition import allowed_operation_keys
from mcp.types import Tool


def test_observability_startup_source_identity_is_the_exact_mcp_host_bytes():
    import hashlib
    from pathlib import Path
    import mcp_host
    from app import mcp_observability

    host_source = Path(mcp_host.__file__).read_bytes()
    observability_source = Path(mcp_observability.__file__).read_bytes()
    assert mcp_observability.STARTUP_SOURCE_SHA256 == hashlib.sha256(
        host_source
    ).hexdigest()
    assert hashlib.sha256(observability_source).hexdigest() != (
        mcp_observability.STARTUP_SOURCE_SHA256
    )
    assert mcp_catalog_runtime._catalog_diagnostics()["currentSourceSha256"] == (
        hashlib.sha256(host_source).hexdigest()
    )

def test_auth_owner_loads_after_dotenv_and_never_imports_the_host():
    from pathlib import Path
    import mcp_host

    host_source = Path(mcp_host.__file__).read_text(encoding="utf-8")
    auth_source = Path(mcp_auth.__file__).read_text(encoding="utf-8")
    assert host_source.index("ensure_env_loaded()") < host_source.index(
        "from app import mcp_auth"
    )
    assert "import mcp_host" not in auth_source
    assert "from app import mcp_host" not in auth_source

def test_provider_operation_policy_has_one_non_circular_owner():
    from pathlib import Path
    import mcp_host

    host_source = Path(mcp_host.__file__).read_text(encoding="utf-8")
    provider_source = Path(mcp_provider_operations.__file__).read_text(
        encoding="utf-8"
    )
    operation_definition_source = Path(
        allowed_operation_keys.__code__.co_filename
    ).read_text(encoding="utf-8")
    assert "def allowed_operation_keys(" not in host_source
    assert "def allowed_operation_keys(" in operation_definition_source
    for definition in (
        "def _register_cbm_catalog(",
        "def _register_graphiti_catalog(",
        "async def _call_cbm(",
        "async def _call_graphiti(",
        "def _bounded_graphiti_episodes(",
        "def _bind_operation_access(",
        "def _cbm_config(",
    ):
        assert definition not in host_source
        assert definition in provider_source
    assert "import mcp_host" not in provider_source
    assert "from app import mcp_host" not in provider_source
    for process_state in (
        "_CBM_CLIENT",
        "_CBM_TOOLS",
        "_GRAPHITI_MODULE",
        "_GRAPHITI_SERVICE_READY",
    ):
        assert process_state not in provider_source

def test_frozen_catalog_runtime_has_one_non_circular_owner_and_host_hash_target():
    from pathlib import Path
    import mcp_host

    host_source = Path(mcp_host.__file__).read_text(encoding="utf-8")
    catalog_source = Path(mcp_catalog_runtime.__file__).read_text(
        encoding="utf-8"
    )
    assert host_source.index("ensure_env_loaded()") < host_source.index(
        "from app import mcp_catalog_runtime"
    )
    assert "import mcp_host" not in catalog_source
    assert "from app import mcp_host" not in catalog_source
    assert 'os.path.join(os.path.dirname(__file__), "mcp_host.py")' in catalog_source
    assert "open(_HOST_SOURCE_PATH, \"rb\")" in catalog_source
    assert "open(__file__, \"rb\")" not in catalog_source
    for definition in (
        "def _catalog_diagnostics(",
        "async def _materialize_complete_catalog(",
        "async def _initialize_catalog_once(",
        "def _start_catalog_initialization(",
        "async def list_tools(",
        "def _bind_authenticated_catalog(",
        "def _listed_tool_input_schema(",
    ):
        assert definition not in host_source
        assert definition in catalog_source
    for state in (
        "_CATALOG_DIAGNOSTIC_LOCK",
        "_LATEST_CATALOG_DIAGNOSTIC",
        "_CATALOG_STATE",
        "_CATALOG_TOOLS",
        "_CATALOG_INITIALIZATION_TASK",
    ):
        assert f"{state} =" not in host_source
        assert state in catalog_source
    assert catalog_source.count("asyncio.create_task(") == 1
    assert catalog_source.count("liquidaity-mcp-catalog-initialization") == 1
    for host_owner in (
        "async def _dispatch_tool(",
        "server = ToolChangeNotificationServer(",
        "async def _run_stdio(",
        "async def _run_streamable_http(",
    ):
        assert host_owner in host_source
        assert host_owner not in catalog_source
    assert host_source.index("await mcp_cbm_provider._start_cbm_client(") < (
        host_source.index("await mcp_catalog_runtime._initialize_catalog_once()")
    )
    http_lifespan = host_source.index("async def lifespan(_app: Starlette):")
    assert host_source.index(
        "await mcp_cbm_provider._start_cbm_client(", http_lifespan
    ) < host_source.index(
        "mcp_catalog_runtime._start_catalog_initialization()", http_lifespan
    )

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
    bound = mcp_provider_operations._namespace_provider_tools("cbm", [providerTool])[0]

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
    namespaced = mcp_provider_operations._namespace_provider_tools("cbm", [providerTool])
    mcp_provider_operations._register_cbm_catalog(namespaced)
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
    monkeypatch.setattr(mcp_auth, "_internal_mcp_principal", lambda: None)

    async def forbidden(*_args, **_kwargs):
        raise AssertionError("hidden provider operation reached dispatch")

    async def forbidden_engraphis(*_args, **_kwargs):
        raise AssertionError("hidden Engraphis operation reached dispatch")

    monkeypatch.setattr(mcp_provider_operations, "_call_cbm", forbidden)
    monkeypatch.setattr(mcp_provider_operations, "_call_graphiti", forbidden)
    monkeypatch.setattr(engraphis_operations, "invoke_tool", forbidden_engraphis)

    for hidden_name in (
        "cbm.index_repository",
        "graphiti.clear_graph",
        "engraphis_update_memory",
    ):
        assert mcp_host._request_tool_is_allowed(hidden_name) is False
        denied = asyncio.run(mcp_host.call_tool(hidden_name, {}))
        assert denied.is_error is True
        assert "unknown_tool" in denied.content[0].text
        direct = asyncio.run(mcp_host._dispatch_tool(hidden_name, {}))
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
    bound = mcp_provider_operations._bind_operation_access(providerTool)
    assert bound.annotations.model_dump(by_alias=True, exclude_none=True) == definition.annotations
    assert bound.meta["liquidaityAccess"] == expected_access
    mismatched = dict(definition.annotations)
    mismatched["readOnlyHint"] = not mismatched["readOnlyHint"]
    with pytest.raises(RuntimeError, match=f"mcp_tool_annotation_mismatch:{name}:readOnlyHint"):
        mcp_provider_operations._bind_operation_access(Tool(
            name=name, inputSchema={"type": "object"}, annotations=mismatched,
        ))

def test_ungranted_and_destructive_tools_are_not_callable(
    monkeypatch, clear_live_provider_operations,
):
    import mcp_host

    mcp_provider_operations._register_cbm_catalog(mcp_provider_operations._namespace_provider_tools("cbm", [
        Tool(
            name="search_graph",
            description="Search the current CBM graph.",
            inputSchema={"type": "object"},
            annotations={"readOnlyHint": True},
        ),
    ]))
    mcp_provider_operations._register_graphiti_catalog(mcp_provider_operations._namespace_provider_tools("graphiti", [
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
    monkeypatch.setattr(mcp_auth, "_internal_mcp_principal", lambda: principal)
    assert mcp_host._request_tool_is_allowed("engraphis_remember") is False
    monkeypatch.setattr(mcp_auth, "_internal_mcp_principal", lambda: principal)
    assert mcp_host._request_tool_is_allowed("cbm.search_graph") is False
    principal["grantedTools"].append("cbm.search_graph")
    assert mcp_host._request_tool_is_allowed("cbm.search_graph") is False
    principal["presentedTools"].extend(["cbm.search_graph", "graphiti.add_memory"])
    assert mcp_host._request_tool_is_allowed("cbm.search_graph") is True
    assert mcp_host._request_tool_is_allowed("graphiti.add_memory") is True
    assert mcp_host._request_tool_is_allowed("graphiti.clear_graph") is False

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
    assert asyncio.run(mcp_provider_operations._call_cbm("search_graph", arguments)) is result
    assert arguments == {"project": "canonical"}
    assert calls == [("search_graph", {"project": "canonical"})]
    asyncio.run(mcp_provider_operations._call_cbm("search_graph", {**arguments, "format": "tree"}))
    assert calls[-1][1]["format"] == "tree"
    advertised = mcp_provider_operations._namespace_provider_tools("cbm", [providerTool])[0]
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
            return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(
        mcp_graphiti_provider, "_GRAPHITI_MODULE", SimpleNamespace(mcp=ProviderMcp())
    )
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_SERVICE_READY", True)
    monkeypatch.setattr(
        mcp_provider_operations, "_PROVIDER_TOOL_TIMEOUT_SECONDS", 0.01,
    )

    async def run():
        with pytest.raises(RuntimeError, match="graphiti_timeout:slow"):
            await mcp_provider_operations._call_graphiti("slow", {})
        return await mcp_provider_operations._call_graphiti("later", {})

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
            return [mcp_host.TextContent(type="text", text="queued")]

    monkeypatch.setattr(
        mcp_graphiti_provider, "_GRAPHITI_MODULE", SimpleNamespace(mcp=ProviderMcp())
    )
    monkeypatch.setattr(mcp_graphiti_provider, "_GRAPHITI_SERVICE_READY", True)
    arguments = {
        "name": "Bounded research packet",
        "episode_body": "Current primary-source evidence.",
        "source": "text",
    }

    result = asyncio.run(mcp_provider_operations._call_graphiti("add_memory", arguments))

    assert result.content[0].text == "queued"
    assert calls == [("add_memory", arguments)]
    assert arguments == {
        "name": "Bounded research packet",
        "episode_body": "Current primary-source evidence.",
        "source": "text",
    }
